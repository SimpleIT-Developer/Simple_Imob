import { pool } from "../db";
import { storage } from "../storage";
import {
  classifySicoobPixEstado,
  getSicoobPixEstado,
  sicoobProvider,
  type SicoobPixOutcome,
} from "../providers/SicoobProvider";
import {
  type PixTransferAttempt,
  updatePixTransferAttempt,
} from "./pixTransferProtection";

/**
 * Regra única para decidir se um repasse via PIX foi pago.
 *
 * A confirmação do Sicoob devolve "EM_PROCESSAMENTO" — isso NÃO significa que o
 * dinheiro saiu. Só marcamos o repasse como pago quando o Sicoob devolve
 * "FINALIZADO"; "REJEITADO" libera o repasse para reenvio. Antes desta regra o
 * sistema tratava EM_PROCESSAMENTO como pago, e PIX rejeitados depois (ex.: lote
 * de 24/11/2026, "Timeout do participante emissor") ficavam como pagos.
 */

export const PIX_PROCESSING_MESSAGE =
  "PIX enviado e em processamento no Sicoob. O sistema confirma automaticamente em alguns minutos.";

export type PixOutcomeResult = {
  type: "confirmed" | "rejected" | "processing" | "released" | "blocked";
  statusCode: number;
  payload: Record<string, unknown>;
};

function safeJsonStringify(value: unknown) {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ value: String(value) });
  }
}

/**
 * Marca o repasse como pago e lança a saída no caixa. A atualização é
 * condicional (status <> 'paid') para que duas finalizações simultâneas
 * (envio, consulta manual e verificação automática) não lancem o caixa duas vezes.
 * Retorna false se o repasse já estava pago.
 */
export async function finalizeSuccessfulPixTransfer(params: {
  transfer: { id: string };
  receipt?: any;
  landlord: { name: string };
  providerTransferId: string | null;
}): Promise<boolean> {
  const claimed = await pool.query(
    `UPDATE landlord_transfers
        SET status = 'paid',
            paid_at = now(),
            payment_method = 'pix',
            provider_transfer_id = COALESCE($2, provider_transfer_id),
            error_message = NULL
      WHERE id = $1 AND status <> 'paid'
      RETURNING id, amount, receipt_id`,
    [params.transfer.id, params.providerTransferId],
  );
  if (claimed.rowCount === 0) return false;

  const transfer = claimed.rows[0];

  if (params.receipt?.id && params.receipt.status !== "transferred") {
    await storage.updateReceipt(params.receipt.id, { status: "transferred" });
  }

  await storage.createCashTransaction({
    type: "OUT",
    date: new Date().toISOString().split("T")[0],
    category: "Repasse ao Proprietário",
    description: `Repasse PIX para ${params.landlord.name}`,
    amount: String(transfer.amount),
    receiptId: transfer.receipt_id,
  });

  return true;
}

/** Grava o resultado do Sicoob na tentativa e no repasse. */
export async function applySicoobPixOutcome(params: {
  attemptId: string;
  transfer: { id: string; status?: string };
  receipt?: any;
  landlord: { name: string };
  providerTransferId: string | null;
  outcome: SicoobPixOutcome;
  providerStatus: string | null;
  rejectionReason?: string | null;
  responseData?: unknown;
  /** "send": resposta do envio; "reconcile": reconsulta de uma tentativa anterior. */
  context: "send" | "reconcile";
}): Promise<PixOutcomeResult> {
  const responseReceived = params.responseData === undefined ? undefined : safeJsonStringify(params.responseData);

  if (params.outcome === "finalizado") {
    await updatePixTransferAttempt(params.attemptId, {
      status: "CONFIRMADO",
      providerTransferId: params.providerTransferId,
      providerStatus: params.providerStatus || "FINALIZADO",
      ...(responseReceived !== undefined ? { responseReceived } : {}),
      responseReceivedAt: new Date(),
      errorMessage: null,
    });

    const wasPending = params.transfer.status !== "paid";
    const finalized = await finalizeSuccessfulPixTransfer({
      transfer: params.transfer,
      receipt: params.receipt,
      landlord: params.landlord,
      providerTransferId: params.providerTransferId,
    });

    const message =
      params.context === "send"
        ? `PIX para ${params.landlord.name} finalizado no Sicoob. Pagamento confirmado.`
        : finalized && wasPending
          ? `Este PIX já tinha sido FINALIZADO no Sicoob (${params.providerTransferId}), ou seja, o dinheiro já saiu. O repasse foi marcado como pago e nenhum PIX novo foi enviado, para evitar pagamento em dobro.`
          : `PIX finalizado no Sicoob (${params.providerTransferId}). Repasse pago.`;

    return {
      type: "confirmed",
      statusCode: 200,
      payload: { success: true, providerTransferId: params.providerTransferId, message },
    };
  }

  if (params.outcome === "rejeitado") {
    const reason = params.rejectionReason || params.providerStatus || "motivo não informado";
    const message = `PIX rejeitado pelo Sicoob: ${reason}. Nenhum valor saiu da conta; o repasse pode ser reenviado.`;

    await updatePixTransferAttempt(params.attemptId, {
      status: "ERRO",
      providerTransferId: params.providerTransferId,
      providerStatus: params.providerStatus || "REJEITADO",
      ...(responseReceived !== undefined ? { responseReceived } : {}),
      responseReceivedAt: new Date(),
      errorMessage: message,
    });

    // Só mexe no repasse se ele não foi pago por outro meio (ex.: pagamento manual).
    await pool.query(
      `UPDATE landlord_transfers SET status = 'failed', error_message = $2 WHERE id = $1 AND status <> 'paid'`,
      [params.transfer.id, message],
    );

    return {
      type: "rejected",
      statusCode: 409,
      payload: { error: message, attemptStatus: "ERRO", providerStatus: params.providerStatus, canRetry: true },
    };
  }

  await updatePixTransferAttempt(params.attemptId, {
    status: "ENVIADO",
    providerTransferId: params.providerTransferId,
    providerStatus: params.providerStatus || "EM_PROCESSAMENTO",
    ...(responseReceived !== undefined ? { responseReceived } : {}),
    responseReceivedAt: new Date(),
    errorMessage: null,
  });

  await pool.query(
    `UPDATE landlord_transfers SET status = 'pending', error_message = $2 WHERE id = $1 AND status <> 'paid'`,
    [params.transfer.id, PIX_PROCESSING_MESSAGE],
  );

  return {
    type: "processing",
    statusCode: 202,
    payload: {
      success: true,
      processing: true,
      providerTransferId: params.providerTransferId,
      attemptStatus: "ENVIADO",
      message: PIX_PROCESSING_MESSAGE,
    },
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Logo após a confirmação o PIX costuma finalizar em poucos segundos. Reconsulta
 * algumas vezes antes de devolver a resposta ao usuário; erros de consulta
 * (ex.: limite de requisições) contam como "ainda processando".
 */
export async function waitForPixFinalOutcome(
  providerTransferId: string,
  initialResponse: unknown,
  options: { attempts?: number; delayMs?: number } = {},
): Promise<{
  outcome: SicoobPixOutcome;
  providerStatus: string | null;
  rejectionReason: string | null;
  responseData: unknown;
}> {
  let providerStatus = getSicoobPixEstado(initialResponse);
  let outcome = classifySicoobPixEstado(providerStatus);
  let rejectionReason: string | null = (initialResponse as any)?.detalheRejeicao ?? null;
  let responseData: unknown = initialResponse;

  const attempts = options.attempts ?? 4;
  const delayMs = options.delayMs ?? 2500;

  for (let i = 0; i < attempts && outcome === "processando"; i++) {
    await sleep(delayMs);
    try {
      const consult = await sicoobProvider.consultPixPayment(providerTransferId);
      if (!consult.found) continue;
      providerStatus = consult.providerStatus;
      outcome = consult.outcome;
      rejectionReason = consult.rejectionReason;
      responseData = consult.responseData;
    } catch (error) {
      console.warn(`[PIX] Falha ao reconsultar ${providerTransferId} logo após o envio:`, (error as Error)?.message);
    }
  }

  return { outcome, providerStatus, rejectionReason, responseData };
}

/**
 * Decide o que fazer com uma tentativa que bloqueia novo envio (reenvio,
 * botão "consultar status" e verificação automática). Sempre consulta o
 * Sicoob quando há identificador — inclusive para tentativas "CONFIRMADO"
 * antigas, que podem ter sido rejeitadas depois.
 */
export async function handlePixAttemptReconciliation(params: {
  blockingAttempt: PixTransferAttempt;
  transfer: any;
  receipt?: any;
  landlord: any;
}): Promise<PixOutcomeResult> {
  const attempt = params.blockingAttempt;

  if (!attempt.providerTransferId) {
    return {
      type: "blocked",
      statusCode: 409,
      payload: {
        error: "Este repasse possui uma tentativa de PIX pendente de confirmação. Não foi possível reconsultar automaticamente no SICOOB porque a tentativa não retornou identificador externo.",
        attemptStatus: attempt.status,
      },
    };
  }

  let consult: Awaited<ReturnType<typeof sicoobProvider.consultPixPayment>>;
  try {
    consult = await sicoobProvider.consultPixPayment(attempt.providerTransferId);
  } catch (error: any) {
    return {
      type: "blocked",
      statusCode: 409,
      payload: {
        error: `Não foi possível consultar o PIX no Sicoob agora (${error?.message || "erro desconhecido"}). Tente novamente em alguns instantes.`,
        attemptStatus: attempt.status,
        providerTransferId: attempt.providerTransferId,
      },
    };
  }

  if (!consult.found) {
    await updatePixTransferAttempt(attempt.id, {
      status: "ERRO",
      providerStatus: consult.providerStatus,
      responseReceived: safeJsonStringify(consult.responseData),
      responseReceivedAt: new Date(),
      errorMessage: "Reconsulta no SICOOB não localizou o PIX. Nova tentativa manual liberada.",
    });

    await pool.query(
      `UPDATE landlord_transfers SET status = 'failed', error_message = $2 WHERE id = $1 AND status <> 'paid'`,
      [params.transfer.id, "Tentativa anterior não foi localizada no SICOOB. Agora é seguro tentar novamente manualmente."],
    );

    return {
      type: "released",
      statusCode: 409,
      payload: {
        error: "Tentativa anterior não foi localizada no SICOOB. Agora é seguro tentar novamente manualmente.",
        attemptStatus: "ERRO",
        canRetry: true,
      },
    };
  }

  return applySicoobPixOutcome({
    attemptId: attempt.id,
    transfer: params.transfer,
    receipt: params.receipt,
    landlord: params.landlord,
    providerTransferId: attempt.providerTransferId,
    outcome: consult.outcome,
    providerStatus: consult.providerStatus,
    rejectionReason: consult.rejectionReason,
    responseData: consult.responseData,
    context: "reconcile",
  });
}

/**
 * Verificação automática: reconsulta no Sicoob os PIX que ficaram em
 * processamento (ENVIADO) ou com confirmação ambígua (ERRO_CONFIRMAR) e
 * fecha cada um como pago ou rejeitado.
 */
const RECONCILE_INTERVAL_MS = 2 * 60 * 1000;
const RECONCILE_BATCH = 15;
const RECONCILE_GAP_MS = 3000;
let reconcileTimer: NodeJS.Timeout | null = null;
let reconcileRunning = false;

export async function reconcilePendingPixAttempts(): Promise<void> {
  if (reconcileRunning) return;
  reconcileRunning = true;
  try {
    const { rows } = await pool.query(
      `SELECT id FROM pix_transfer_attempts
        WHERE status IN ('ENVIADO', 'ERRO_CONFIRMAR')
          AND provider_transfer_id IS NOT NULL
          AND updated_at < now() - interval '1 minute'
          AND created_at > now() - interval '15 days'
        ORDER BY updated_at ASC
        LIMIT $1`,
      [RECONCILE_BATCH],
    );

    for (const row of rows) {
      try {
        const attemptRow = (await pool.query(`SELECT * FROM pix_transfer_attempts WHERE id = $1`, [row.id])).rows[0];
        if (!attemptRow || !["ENVIADO", "ERRO_CONFIRMAR"].includes(attemptRow.status)) continue;

        const transfer = await storage.getLandlordTransfer(attemptRow.transfer_id);
        if (!transfer) continue;
        const landlord = await storage.getLandlord(transfer.landlordId);
        if (!landlord) continue;
        const receipt = transfer.receiptId ? await storage.getReceipt(transfer.receiptId) : null;

        const result = await handlePixAttemptReconciliation({
          blockingAttempt: {
            id: attemptRow.id,
            transferId: attemptRow.transfer_id,
            status: attemptRow.status,
            providerTransferId: attemptRow.provider_transfer_id,
          } as PixTransferAttempt,
          transfer,
          receipt,
          landlord,
        });

        if (result.type !== "processing" && result.type !== "blocked") {
          console.log(`[PIX] Verificação automática: ${landlord.name} -> ${result.type}`);
        }
      } catch (error) {
        console.error(`[PIX] Erro na verificação automática da tentativa ${row.id}:`, error);
      }
      await sleep(RECONCILE_GAP_MS);
    }
  } catch (error) {
    console.error("[PIX] Erro na verificação automática de PIX pendentes:", error);
  } finally {
    reconcileRunning = false;
  }
}

export function startPixReconciler() {
  if (reconcileTimer) return;
  reconcileTimer = setInterval(() => {
    void reconcilePendingPixAttempts();
  }, RECONCILE_INTERVAL_MS);
  console.log("[PIX] Verificação automática de PIX em processamento iniciada (a cada 2 min).");
}

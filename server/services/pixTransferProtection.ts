import crypto from "crypto";
import { pool } from "../db";

export const PIX_ATTEMPT_BLOCKING_STATUSES = [
  "PENDENTE",
  "ENVIANDO",
  "ENVIADO",
  "CONFIRMADO",
  "ERRO_CONFIRMAR",
] as const;

export type PixAttemptStatus =
  | "PENDENTE"
  | "ENVIANDO"
  | "ENVIADO"
  | "CONFIRMADO"
  | "ERRO"
  | "ERRO_CONFIRMAR";

export type PixTransferAttempt = {
  id: string;
  transferId: string;
  receiptId: string | null;
  contractId: string | null;
  propertyId: string | null;
  landlordId: string | null;
  amount: string;
  pixKey: string;
  pixKeyType: string | null;
  bankApi: string;
  requestId: string;
  dedupeKey: string;
  status: PixAttemptStatus;
  reference: string | null;
  payloadSent: string | null;
  responseReceived: string | null;
  errorMessage: string | null;
  providerTransferId: string | null;
  providerStatus: string | null;
  requestSentAt: Date | null;
  responseReceivedAt: Date | null;
  createdByUserId: string | null;
  requestIp: string | null;
  userAgent: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CreatePixTransferAttemptInput = {
  transferId: string;
  receiptId?: string | null;
  contractId?: string | null;
  propertyId?: string | null;
  landlordId?: string | null;
  amount: string;
  pixKey: string;
  pixKeyType?: string | null;
  bankApi: string;
  requestId: string;
  dedupeKey: string;
  status: PixAttemptStatus;
  reference?: string | null;
  payloadSent?: string | null;
  responseReceived?: string | null;
  errorMessage?: string | null;
  providerTransferId?: string | null;
  providerStatus?: string | null;
  requestSentAt?: Date | null;
  responseReceivedAt?: Date | null;
  createdByUserId?: string | null;
  requestIp?: string | null;
  userAgent?: string | null;
};

export type UpdatePixTransferAttemptInput = Partial<
  Omit<CreatePixTransferAttemptInput, "transferId" | "requestId" | "dedupeKey" | "amount" | "bankApi" | "pixKey">
> & {
  status?: PixAttemptStatus;
};

function mapRow(row: any): PixTransferAttempt {
  return {
    id: String(row.id),
    transferId: String(row.transfer_id),
    receiptId: row.receipt_id ?? null,
    contractId: row.contract_id ?? null,
    propertyId: row.property_id ?? null,
    landlordId: row.landlord_id ?? null,
    amount: String(row.amount),
    pixKey: String(row.pix_key),
    pixKeyType: row.pix_key_type ?? null,
    bankApi: String(row.bank_api),
    requestId: String(row.request_id),
    dedupeKey: String(row.dedupe_key),
    status: row.status as PixAttemptStatus,
    reference: row.reference ?? null,
    payloadSent: row.payload_sent ?? null,
    responseReceived: row.response_received ?? null,
    errorMessage: row.error_message ?? null,
    providerTransferId: row.provider_transfer_id ?? null,
    providerStatus: row.provider_status ?? null,
    requestSentAt: row.request_sent_at ? new Date(row.request_sent_at) : null,
    responseReceivedAt: row.response_received_at ? new Date(row.response_received_at) : null,
    createdByUserId: row.created_by_user_id ?? null,
    requestIp: row.request_ip ?? null,
    userAgent: row.user_agent ?? null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export function buildPixDedupeKey(input: {
  transferId: string;
  amount: string;
  pixKey: string;
  reference: string;
}) {
  const raw = [
    input.transferId.trim(),
    input.amount.trim(),
    input.pixKey.trim().toLowerCase(),
    input.reference.trim().toLowerCase(),
  ].join("|");
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export function createPixRequestId(transferId: string) {
  return `pix-${transferId}-${crypto.randomUUID()}`;
}

export async function createPixTransferAttempt(input: CreatePixTransferAttemptInput): Promise<PixTransferAttempt> {
  const result = await pool.query(
    `
      INSERT INTO pix_transfer_attempts (
        transfer_id, receipt_id, contract_id, property_id, landlord_id,
        amount, pix_key, pix_key_type, bank_api, request_id, dedupe_key, status,
        reference, payload_sent, response_received, error_message,
        provider_transfer_id, provider_status, request_sent_at, response_received_at,
        created_by_user_id, request_ip, user_agent
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10, $11, $12,
        $13, $14, $15, $16,
        $17, $18, $19, $20,
        $21, $22, $23
      )
      RETURNING *
    `,
    [
      input.transferId,
      input.receiptId ?? null,
      input.contractId ?? null,
      input.propertyId ?? null,
      input.landlordId ?? null,
      input.amount,
      input.pixKey,
      input.pixKeyType ?? null,
      input.bankApi,
      input.requestId,
      input.dedupeKey,
      input.status,
      input.reference ?? null,
      input.payloadSent ?? null,
      input.responseReceived ?? null,
      input.errorMessage ?? null,
      input.providerTransferId ?? null,
      input.providerStatus ?? null,
      input.requestSentAt ?? null,
      input.responseReceivedAt ?? null,
      input.createdByUserId ?? null,
      input.requestIp ?? null,
      input.userAgent ?? null,
    ],
  );

  return mapRow(result.rows[0]);
}

export async function updatePixTransferAttempt(
  id: string,
  patch: UpdatePixTransferAttemptInput,
): Promise<PixTransferAttempt | undefined> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let index = 1;

  const addField = (column: string, value: unknown) => {
    fields.push(`${column} = $${index++}`);
    values.push(value);
  };

  if (patch.receiptId !== undefined) addField("receipt_id", patch.receiptId);
  if (patch.contractId !== undefined) addField("contract_id", patch.contractId);
  if (patch.propertyId !== undefined) addField("property_id", patch.propertyId);
  if (patch.landlordId !== undefined) addField("landlord_id", patch.landlordId);
  if (patch.pixKeyType !== undefined) addField("pix_key_type", patch.pixKeyType);
  if (patch.status !== undefined) addField("status", patch.status);
  if (patch.reference !== undefined) addField("reference", patch.reference);
  if (patch.payloadSent !== undefined) addField("payload_sent", patch.payloadSent);
  if (patch.responseReceived !== undefined) addField("response_received", patch.responseReceived);
  if (patch.errorMessage !== undefined) addField("error_message", patch.errorMessage);
  if (patch.providerTransferId !== undefined) addField("provider_transfer_id", patch.providerTransferId);
  if (patch.providerStatus !== undefined) addField("provider_status", patch.providerStatus);
  if (patch.requestSentAt !== undefined) addField("request_sent_at", patch.requestSentAt);
  if (patch.responseReceivedAt !== undefined) addField("response_received_at", patch.responseReceivedAt);
  if (patch.createdByUserId !== undefined) addField("created_by_user_id", patch.createdByUserId);
  if (patch.requestIp !== undefined) addField("request_ip", patch.requestIp);
  if (patch.userAgent !== undefined) addField("user_agent", patch.userAgent);

  if (fields.length === 0) {
    return getPixTransferAttempt(id);
  }

  fields.push(`updated_at = now()`);
  values.push(id);

  const result = await pool.query(
    `UPDATE pix_transfer_attempts SET ${fields.join(", ")} WHERE id = $${index} RETURNING *`,
    values,
  );

  return result.rows[0] ? mapRow(result.rows[0]) : undefined;
}

export async function getPixTransferAttempt(id: string): Promise<PixTransferAttempt | undefined> {
  const result = await pool.query(`SELECT * FROM pix_transfer_attempts WHERE id = $1`, [id]);
  return result.rows[0] ? mapRow(result.rows[0]) : undefined;
}

export async function getLatestPixTransferAttemptByTransfer(
  transferId: string,
): Promise<PixTransferAttempt | undefined> {
  const result = await pool.query(
    `
      SELECT *
      FROM pix_transfer_attempts
      WHERE transfer_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [transferId],
  );
  return result.rows[0] ? mapRow(result.rows[0]) : undefined;
}

export async function getBlockingPixTransferAttemptByDedupeKey(
  dedupeKey: string,
): Promise<PixTransferAttempt | undefined> {
  const result = await pool.query(
    `
      SELECT *
      FROM pix_transfer_attempts
      WHERE dedupe_key = $1
        AND status = ANY($2::text[])
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [dedupeKey, [...PIX_ATTEMPT_BLOCKING_STATUSES]],
  );
  return result.rows[0] ? mapRow(result.rows[0]) : undefined;
}

export async function getBlockingPixTransferAttemptByTransfer(
  transferId: string,
): Promise<PixTransferAttempt | undefined> {
  const result = await pool.query(
    `
      SELECT *
      FROM pix_transfer_attempts
      WHERE transfer_id = $1
        AND status = ANY($2::text[])
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [transferId, [...PIX_ATTEMPT_BLOCKING_STATUSES]],
  );
  return result.rows[0] ? mapRow(result.rows[0]) : undefined;
}


import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import session from "express-session";
import bcrypt from "bcrypt";
import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import { storage } from "./storage";
import { pixProvider } from "./providers/MockPixProvider";
import { nfProvider } from "./providers/MockNfProvider";
import { NfseNationalProvider } from "./providers/NfseNationalProvider";
import { SicoobPixError, sicoobProvider } from "./providers/SicoobProvider";
import {
  buildPixDedupeKey,
  createPixRequestId,
  getBlockingPixTransferAttemptByTransfer,
  createPixTransferAttempt,
  getBlockingPixTransferAttemptByDedupeKey,
  type PixTransferAttempt,
  updatePixTransferAttempt,
} from "./services/pixTransferProtection";
import { nfseWorker } from "./services/nfseWorker";
import {
  getDimobReport,
  buildDimobReportCsv,
  buildDimobReportHtml,
} from "./services/dimobReport";
import { 
  loginSchema, 
  insertFinancialRecordSchema 
} from "@shared/schema";
import {
  getEditableFieldKeys,
  getFieldPermissionState,
  type EditableActionId,
} from "@shared/field-permissions";
import { z } from "zod";
import speakeasy from "speakeasy";
import QRCode from "qrcode";
import axios from "axios";
import JSZip from "jszip";

const execFileAsync = promisify(execFile);

// Helper function to convert Digitable Line to Barcode
function digitableToBarcode(line: string): string | null {
  if (!line) return null;
  const d = line.replace(/\D/g, '');
  if (d.length !== 47) return null;
  const bank = d.substring(0, 3);
  const currency = d.substring(3, 4);
  const dv = d.substring(32, 33);
  const factor = d.substring(33, 37);
  const value = d.substring(37, 47);
  const freeField1 = d.substring(4, 9);
  const freeField2 = d.substring(10, 20);
  const freeField3 = d.substring(21, 31);
  return bank + currency + dv + factor + value + freeField1 + freeField2 + freeField3;
}

declare module "express-session" {
  interface SessionData {
    userId: string;
    temp2faUserId?: string;
  }
}

const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Não autenticado" });
  }
  next();
};

function getSingleParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}

function getRequestIp(req: Request) {
  const forwarded = req.headers["x-forwarded-for"];
  if (Array.isArray(forwarded)) return forwarded[0] || req.ip || null;
  if (typeof forwarded === "string") return forwarded.split(",")[0]?.trim() || req.ip || null;
  return req.ip || null;
}

function safeJsonStringify(value: unknown) {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ value: String(value) });
  }
}

function maskAuditValue(value: string | null | undefined, keepStart = 3, keepEnd = 2) {
  const raw = String(value || "");
  if (!raw) return "";
  if (raw.length <= keepStart + keepEnd) return raw;
  return `${raw.slice(0, keepStart)}***${raw.slice(-keepEnd)}`;
}

function buildTransferPixReference(transfer: { id: string }, receipt?: { refYear?: number | null; refMonth?: number | null } | null) {
  if (!receipt?.refYear || !receipt?.refMonth) return transfer.id;
  return `${receipt.refYear}-${String(receipt.refMonth).padStart(2, "0")}:${transfer.id}`;
}

function getPixAuditKey(landlord: any) {
  if (landlord.pixKeyType === "agencia_conta") {
    return `ag:${maskAuditValue(landlord.branch, 2, 1)}|cc:${maskAuditValue(landlord.account, 2, 2)}|doc:${maskAuditValue(landlord.doc, 4, 2)}`;
  }
  return maskAuditValue(landlord.pixKey, 4, 3);
}

async function finalizeSuccessfulPixTransfer(params: {
  transfer: any;
  receipt?: any;
  landlord: any;
  providerTransferId: string | null;
}) {
  const currentTransfer = await storage.getLandlordTransfer(params.transfer.id);
  if (!currentTransfer) {
    throw new Error("Repasse não encontrado durante a finalização do PIX");
  }

  if (currentTransfer.status !== "paid") {
    await storage.updateLandlordTransfer(currentTransfer.id, {
      status: "paid",
      paidAt: new Date(),
      paymentMethod: "pix",
      providerTransferId: params.providerTransferId || currentTransfer.providerTransferId || null,
      errorMessage: null,
    });

    if (params.receipt?.id && params.receipt.status !== "transferred") {
      await storage.updateReceipt(params.receipt.id, { status: "transferred" });
    }

    await storage.createCashTransaction({
      type: "OUT",
      date: new Date().toISOString().split("T")[0],
      category: "Repasse ao Proprietário",
      description: `Repasse PIX para ${params.landlord.name}`,
      amount: currentTransfer.amount,
      receiptId: currentTransfer.receiptId,
    });
  }
}

async function handlePixAttemptReconciliation(params: {
  blockingAttempt: PixTransferAttempt;
  transfer: any;
  receipt?: any;
  landlord: any;
}) {
  const blockingAttempt = params.blockingAttempt;

  if (blockingAttempt.status === "CONFIRMADO") {
    await finalizeSuccessfulPixTransfer({
      transfer: params.transfer,
      receipt: params.receipt,
      landlord: params.landlord,
      providerTransferId: blockingAttempt.providerTransferId,
    });

    return {
      type: "confirmed" as const,
      statusCode: 200,
      payload: {
        success: true,
        providerTransferId: blockingAttempt.providerTransferId,
        message: "PIX já constava confirmado e o repasse foi reconciliado no sistema.",
      },
    };
  }

  if (blockingAttempt.status !== "ERRO_CONFIRMAR") {
    return {
      type: "blocked" as const,
      statusCode: 409,
      payload: {
        error: "Este repasse possui uma tentativa de PIX pendente de confirmação. Verifique o status antes de reenviar.",
        attemptStatus: blockingAttempt.status,
        providerTransferId: blockingAttempt.providerTransferId,
      },
    };
  }

  if (!blockingAttempt.providerTransferId) {
    return {
      type: "blocked" as const,
      statusCode: 409,
      payload: {
        error: "Este repasse possui uma tentativa de PIX pendente de confirmação. Não foi possível reconsultar automaticamente no SICOOB porque a tentativa não retornou identificador externo.",
        attemptStatus: blockingAttempt.status,
      },
    };
  }

  const consult = await sicoobProvider.consultPixPayment(blockingAttempt.providerTransferId);

  if (consult.confirmed) {
    await updatePixTransferAttempt(blockingAttempt.id, {
      status: "CONFIRMADO",
      providerStatus: consult.providerStatus,
      responseReceived: safeJsonStringify(consult.responseData),
      responseReceivedAt: new Date(),
      errorMessage: null,
    });

    await finalizeSuccessfulPixTransfer({
      transfer: params.transfer,
      receipt: params.receipt,
      landlord: params.landlord,
      providerTransferId: blockingAttempt.providerTransferId,
    });

    return {
      type: "confirmed" as const,
      statusCode: 200,
      payload: {
        success: true,
        providerTransferId: blockingAttempt.providerTransferId,
        message: "PIX confirmado no SICOOB durante a reconsulta. O repasse foi reconciliado no sistema.",
      },
    };
  }

  if (!consult.found) {
    await updatePixTransferAttempt(blockingAttempt.id, {
      status: "ERRO",
      providerStatus: consult.providerStatus,
      responseReceived: safeJsonStringify(consult.responseData),
      responseReceivedAt: new Date(),
      errorMessage: "Reconsulta no SICOOB não localizou o PIX. Nova tentativa manual liberada.",
    });

    await storage.updateLandlordTransfer(params.transfer.id, {
      status: "failed",
      errorMessage: "Tentativa anterior não foi localizada no SICOOB. Agora é seguro tentar novamente manualmente.",
    });

    return {
      type: "released" as const,
      statusCode: 409,
      payload: {
        error: "Tentativa anterior não foi localizada no SICOOB. Agora é seguro tentar novamente manualmente.",
        attemptStatus: "ERRO",
        canRetry: true,
      },
    };
  }

  await updatePixTransferAttempt(blockingAttempt.id, {
    status: "ERRO_CONFIRMAR",
    providerStatus: consult.providerStatus,
    responseReceived: safeJsonStringify(consult.responseData),
    responseReceivedAt: new Date(),
    errorMessage: "Tentativa ainda pendente de confirmação no SICOOB.",
  });

  return {
    type: "blocked" as const,
    statusCode: 409,
    payload: {
      error: "Este repasse possui uma tentativa de PIX pendente de confirmação. Verifique o status antes de reenviar.",
      attemptStatus: "ERRO_CONFIRMAR",
      providerTransferId: blockingAttempt.providerTransferId,
      providerStatus: consult.providerStatus,
    },
  };
}

const requirePermission = (permission: string) => async (req: Request, res: Response, next: NextFunction) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Não autenticado" });
  }
  
  try {
    const user = await storage.getUser(req.session.userId);
    if (!user) {
      return res.status(401).json({ error: "Usuário não encontrado" });
    }
    
    if (user.role === 'admin') {
      return next();
    }

    const userPermissions = (user.permissions as string[]) || [];
    if (!userPermissions.includes(permission)) {
      return res.status(403).json({ error: "Acesso negado: permissão insuficiente" });
    }
    
    next();
  } catch (error) {
    console.error("Permission check error:", error);
    res.status(500).json({ error: "Erro ao verificar permissões" });
  }
};

async function getNfseXmlContent(emissaoId: string) {
  return new NfseNationalProvider().baixarXml(emissaoId);
}

async function getNfseDanfseUrl(chaveAcesso: string) {
  const provider = new NfseNationalProvider();
  await provider.initialize({ chaveAcesso });
  return provider.getDanfseUrl(chaveAcesso);
}

async function getNfseDanfsePdfBufferOnce(chaveAcesso: string) {
  return new NfseNationalProvider().baixarDanfsePdf(chaveAcesso);
}

function sanitizeExportFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, "_").trim();
}

function extractNfseNumberFromXml(xml: string) {
  const match = xml.match(/<nNFSe>\s*([^<]+?)\s*<\/nNFSe>/i);
  const value = match?.[1]?.trim();
  return value || null;
}

function debugUpdateNfseNumber(
  runId: "pre-fix" | "post-fix",
  hypothesisId: "A" | "B" | "C" | "D" | "E",
  location: string,
  msg: string,
  data: Record<string, unknown>
) {
  fetch("http://127.0.0.1:7777/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: "update-nfse-number-json-error",
      runId,
      hypothesisId,
      location,
      msg: `[DEBUG] ${msg}`,
      data,
      ts: Date.now(),
    }),
  }).catch(() => {});
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const normalizedConcurrency = Math.max(1, Math.floor(concurrency) || 1);
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) {
        return;
      }

      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from(
    { length: Math.min(normalizedConcurrency, items.length) },
    () => runWorker()
  );

  await Promise.all(workers);
  return results;
}

function isRetryableDanfseError(error: any) {
  const status = error?.response?.status;
  const code = String(error?.code || "").toUpperCase();
  const message = String(error?.message || "");

  if (status === 429) return true;
  if (typeof status === "number" && status >= 500) return true;
  if (code === "ECONNRESET" || code === "ETIMEDOUT" || code === "ECONNABORTED" || code === "EAI_AGAIN") return true;
  if (message.includes("Resposta DANFSE nao retornou PDF")) return true;

  return false;
}

async function baixarDanfseComRetry(params: {
  chaveAcesso: string;
  emissaoId?: string;
  month?: number;
  year?: number;
  context: "accounting-export" | "danfse-download";
}) {
  const baseDelayMs = Number(process.env.DANFSE_RETRY_BASE_MS || process.env.ACCOUNTING_DANFSE_RETRY_BASE_MS || 1500);
  const maxDelayMs = Number(process.env.DANFSE_RETRY_MAX_MS || process.env.ACCOUNTING_DANFSE_RETRY_MAX_MS || 20000);
  const maxAttempts = Number(process.env.DANFSE_RETRY_MAX_ATTEMPTS || process.env.ACCOUNTING_DANFSE_RETRY_MAX_ATTEMPTS || 0);

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt += 1;
    try {
      if (attempt <= 3 || attempt % 10 === 0) {
        // #region debug-point C:danfse-attempt
        debugAccountingExport("pre-fix", "C", "server/routes.ts:baixarDanfseComRetry:attempt", "Tentando baixar DANFSE (com retry)", {
          context: params.context,
          month: params.month ?? null,
          year: params.year ?? null,
          emissaoId: params.emissaoId ?? null,
          chaveAcesso: params.chaveAcesso,
          attempt,
        });
        // #endregion
      }
      const pdfBuffer = await getNfseDanfsePdfBufferOnce(params.chaveAcesso);
      return pdfBuffer;
    } catch (error: any) {
      const status = error?.response?.status ?? null;
      const code = error?.code ?? null;
      const message = error?.message || String(error);

      const retryable = isRetryableDanfseError(error);
      if (attempt <= 3 || attempt % 10 === 0) {
        // #region debug-point C:danfse-error
        debugAccountingExport("pre-fix", "C", "server/routes.ts:baixarDanfseComRetry:error", "Falha ao baixar DANFSE (com retry)", {
          context: params.context,
          month: params.month ?? null,
          year: params.year ?? null,
          emissaoId: params.emissaoId ?? null,
          chaveAcesso: params.chaveAcesso,
          attempt,
          retryable,
          status,
          code,
          message,
        });
        // #endregion
      }

      if (!retryable) {
        throw error;
      }

      if (maxAttempts > 0 && attempt >= maxAttempts) {
        throw error;
      }

      const rawDelay = Math.min(maxDelayMs, Math.max(0, baseDelayMs) * Math.pow(1.6, attempt - 1));
      const jitter = 0.85 + Math.random() * 0.3;
      const delayMs = Math.max(0, Math.floor(rawDelay * jitter));
      await sleep(delayMs);
    }
  }
}

async function getNfseDanfsePdfBuffer(chaveAcesso: string, options?: { emissaoId?: string; month?: number; year?: number; context?: "accounting-export" | "danfse-download" }) {
  return baixarDanfseComRetry({
    chaveAcesso,
    emissaoId: options?.emissaoId,
    month: options?.month,
    year: options?.year,
    context: options?.context || "danfse-download",
  });
}

// #region debug-point A:accounting-export-log
function debugAccountingExport(runId: "pre-fix" | "post-fix", hypothesisId: "A" | "B" | "C" | "D" | "E", location: string, msg: string, data: Record<string, unknown>) {
  (() => {
    const envPath = ".dbg/accounting-export-zip.env";
    let url = "http://127.0.0.1:7777/event";
    let sessionId = "accounting-export-zip";
    try {
      const envContent = fs.readFileSync(envPath, "utf8");
      url = envContent.match(/DEBUG_SERVER_URL=(.+)/)?.[1] || url;
      sessionId = envContent.match(/DEBUG_SESSION_ID=(.+)/)?.[1] || sessionId;
    } catch {}
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, runId, hypothesisId, location, msg: `[DEBUG] ${msg}`, data, ts: Date.now() }),
    }).catch(() => {});

    if (process.env.NODE_ENV === "production" || process.env.LOG_ACCOUNTING_EXPORT_TO_DB === "1") {
      const level = msg.toLowerCase().includes("erro") || msg.toLowerCase().includes("falha") ? "ERROR" : "INFO";
      storage
        .createSystemLog({
          level,
          category: "NFSE",
          message: msg,
          details: JSON.stringify({ sessionId, runId, hypothesisId, location, data }),
        })
        .catch(() => {});
    }
  })();
}
// #endregion

// #region debug-point A:issued-invoices-report-log
function debugIssuedInvoicesReport(runId: "pre-fix" | "post-fix", hypothesisId: "A" | "B" | "C" | "D" | "E", location: string, msg: string, data: Record<string, unknown>) {
  (() => {
    const envPath = ".dbg/issued-invoices-regression.env";
    let url = "http://127.0.0.1:7777/event";
    let sessionId = "issued-invoices-regression";
    try {
      const envContent = fs.readFileSync(envPath, "utf8");
      url = envContent.match(/DEBUG_SERVER_URL=(.+)/)?.[1] || url;
      sessionId = envContent.match(/DEBUG_SESSION_ID=(.+)/)?.[1] || sessionId;
    } catch {}
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, runId, hypothesisId, location, msg: `[DEBUG] ${msg}`, data, ts: Date.now() }),
    }).catch(() => {});
  })();
}
// #endregion

// #region debug-point A:nfse-reprocess-log
function debugNfseReprocess(runId: "pre-fix" | "post-fix", hypothesisId: "A" | "B" | "C" | "D" | "E", location: string, msg: string, data: Record<string, unknown>) {
  (() => {
    const envPath = ".dbg/nfse-reprocess-lock.env";
    let url = "http://127.0.0.1:7777/event";
    let sessionId = "nfse-reprocess-lock";
    try {
      const envContent = fs.readFileSync(envPath, "utf8");
      url = envContent.match(/DEBUG_SERVER_URL=(.+)/)?.[1] || url;
      sessionId = envContent.match(/DEBUG_SESSION_ID=(.+)/)?.[1] || sessionId;
    } catch {}
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, runId, hypothesisId, location, msg: `[DEBUG] ${msg}`, data, ts: Date.now() }),
    }).catch(() => {});
  })();
}
// #endregion

function getHeadlessBrowserPath() {
  const pathParts = String(process.env.PATH || "")
    .split(path.delimiter)
    .map((value) => value.trim())
    .filter(Boolean);

  const findInPath = (names: string[]) => {
    for (const baseDir of pathParts) {
      for (const name of names) {
        const candidate = path.join(baseDir, name);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
    return null as string | null;
  };

  const envCandidates = [
    process.env.HEADLESS_BROWSER_PATH,
    process.env.BROWSER_PATH,
    process.env.CHROME_BIN,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.PLAYWRIGHT_BROWSERS_PATH,
  ].filter((value): value is string => Boolean(value && String(value).trim()));

  for (const candidate of envCandidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  const candidates: string[] = [];

  if (process.platform === "win32") {
    candidates.push(
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    );
  } else if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    );
  } else {
    candidates.push(
      "/usr/bin/google-chrome-stable",
      "/usr/bin/google-chrome",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/snap/bin/chromium",
      "/usr/bin/microsoft-edge",
      "/usr/bin/microsoft-edge-stable",
    );
  }

  const absoluteMatch = candidates.find((candidate) => fs.existsSync(candidate));
  if (absoluteMatch) return absoluteMatch;

  const pathMatch = findInPath(
    process.platform === "win32"
      ? ["msedge.exe", "chrome.exe", "chromium.exe"]
      : ["chromium", "chromium-browser", "google-chrome-stable", "google-chrome", "microsoft-edge", "microsoft-edge-stable"],
  );
  return pathMatch;
}

async function renderHtmlToPdfBuffer(htmlContent: string) {
  const browserPath = getHeadlessBrowserPath();
  // #region debug-point P:pdf-render-env
  debugIssuedInvoicesReport("pre-fix", "D", "server/routes.ts:renderHtmlToPdfBuffer:env", "Preparando renderizacao HTML->PDF", {
    platform: process.platform,
    nodeEnv: process.env.NODE_ENV || null,
    browserPath,
    cwd: process.cwd(),
  });
  // #endregion
  if (!browserPath) {
    // #region debug-point P:pdf-render-no-browser
    debugIssuedInvoicesReport("pre-fix", "D", "server/routes.ts:renderHtmlToPdfBuffer:no-browser", "Browser headless nao encontrado", {
      platform: process.platform,
      nodeEnv: process.env.NODE_ENV || null,
    });
    // #endregion
    throw new Error(
      "Navegador headless não encontrado para gerar o PDF do relatório. Configure HEADLESS_BROWSER_PATH (ou CHROME_BIN) no ambiente publicado.",
    );
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "imob-report-"));
  const htmlPath = path.join(tempDir, "report.html");
  const pdfPath = path.join(tempDir, "report.pdf");

  try {
    await fs.promises.writeFile(htmlPath, htmlContent, "utf8");

    const args = [
      "--headless",
      "--disable-gpu",
      "--allow-file-access-from-files",
      "--no-pdf-header-footer",
      `--print-to-pdf=${pdfPath}`,
      htmlPath,
    ];

    if (process.platform !== "win32") {
      args.splice(1, 0, "--no-sandbox", "--disable-dev-shm-usage");
    }

    try {
      await execFileAsync(
        browserPath,
        args,
        {
          windowsHide: true,
          timeout: 120000,
        },
      );
    } catch (error: any) {
      // #region debug-point P:pdf-render-exec-error
      debugIssuedInvoicesReport("pre-fix", "D", "server/routes.ts:renderHtmlToPdfBuffer:exec-error", "Falha ao executar browser headless", {
        message: error?.message || String(error),
        code: error?.code || null,
        killed: error?.killed ?? null,
        signal: error?.signal ?? null,
        stdout: error?.stdout ? String(error.stdout).slice(0, 500) : null,
        stderr: error?.stderr ? String(error.stderr).slice(0, 500) : null,
        browserPath,
      });
      // #endregion
      throw error;
    }

    return await fs.promises.readFile(pdfPath);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDateTime(value: Date | string | null | undefined) {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR");
}

function formatDateOnly(value: string | Date | null | undefined) {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("pt-BR");
}

function getPeriodBounds(startDate?: string, endDate?: string) {
  const start = startDate ? new Date(`${startDate}T00:00:00`) : null;
  const end = endDate ? new Date(`${endDate}T23:59:59.999`) : null;

  if (start && Number.isNaN(start.getTime())) {
    throw new Error("Data inicial inválida.");
  }

  if (end && Number.isNaN(end.getTime())) {
    throw new Error("Data final inválida.");
  }

  return { start, end };
}

function parseRefFromDescription(value?: string | null) {
  const text = String(value || "");
  const match = text.match(/(\d{2})\/(\d{4})/);
  if (!match) return { refMonth: null as number | null, refYear: null as number | null };
  return { refMonth: Number(match[1]), refYear: Number(match[2]) };
}

function parsePropertyFromDescription(value?: string | null) {
  const text = String(value || "").trim();
  if (!text) return null as string | null;
  const match = text.match(/\d{2}\/\d{4}\s*-\s*(.+)$/i);
  return match?.[1]?.trim() || null;
}

function pickFirstStringValue(value: unknown) {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function deepPickFirst(obj: any, paths: string[]) {
  for (const pathKey of paths) {
    const parts = pathKey.split(".");
    let current: any = obj;
    for (const part of parts) {
      if (!current || typeof current !== "object") {
        current = null;
        break;
      }
      current = current[part];
    }
    const picked = pickFirstStringValue(current);
    if (picked) return picked;
  }
  return null;
}

function extractNumeroNfseFromApiResponseRaw(apiResponseRaw: unknown) {
  const raw = pickFirstStringValue(apiResponseRaw);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return deepPickFirst(parsed, [
      "numeroNfse",
      "numeroNFSe",
      "nNFSe",
      "nfse.numeroNfse",
      "nfse.numeroNFSe",
      "nfse.nNFSe",
      "data.numeroNfse",
      "data.numeroNFSe",
      "data.nNFSe",
      "raw.numeroNfse",
      "raw.numeroNFSe",
      "raw.nNFSe",
      "raw.nfse.numeroNfse",
      "raw.nfse.numeroNFSe",
      "raw.nfse.nNFSe",
    ]);
  } catch {
    return null;
  }
}

function extractNumeroNfseFromChaveAcesso(chaveAcesso: unknown, dateHint?: unknown) {
  const chave = pickFirstStringValue(chaveAcesso)?.replace(/\D/g, "") || "";
  if (!chave || chave.length < 20) return null;

  const hintDate = dateHint ? new Date(String(dateHint)) : null;
  if (hintDate && !Number.isNaN(hintDate.getTime())) {
    const competencia = `${String(hintDate.getUTCFullYear() % 100).padStart(2, "0")}${String(hintDate.getUTCMonth() + 1).padStart(2, "0")}`;
    const exactMatch = chave.match(new RegExp(`0+(\\d{1,15})${competencia}\\d{8,}$`));
    if (exactMatch?.[1]) {
      return exactMatch[1].replace(/^0+/, "") || "0";
    }
  }

  const genericMatch = chave.match(/0+(\d{1,15})\d{12}$/);
  if (genericMatch?.[1]) {
    return genericMatch[1].replace(/^0+/, "") || "0";
  }

  return null;
}

function getNormalizedNumeroNfse(emissao: any) {
  return (
    extractNumeroNfseFromApiResponseRaw(emissao?.apiResponseRaw) ||
    extractNumeroNfseFromChaveAcesso(emissao?.chaveAcesso, emissao?.updatedAt || emissao?.createdAt) ||
    pickFirstStringValue(emissao?.numeroNfse) ||
    "-"
  );
}

function getNormalizedEmissaoStatus(emissao: any) {
  const status = pickFirstStringValue(emissao?.status) || "PENDENTE";
  const hasError = Boolean(
    pickFirstStringValue(emissao?.erroCodigo) ||
    pickFirstStringValue(emissao?.erroMensagem)
  );

  if (status === "ENVIANDO" && hasError) {
    return "FALHOU";
  }

  return status;
}

function shouldReleaseSendingEmission(emissao: any) {
  const hasPersistedError = Boolean(
    pickFirstStringValue(emissao?.erroCodigo) ||
    pickFirstStringValue(emissao?.erroMensagem)
  );

  if (hasPersistedError) {
    return true;
  }

  const updatedAt = emissao?.updatedAt ? new Date(String(emissao.updatedAt)) : null;
  if (!updatedAt || Number.isNaN(updatedAt.getTime())) {
    return false;
  }

  const staleMs = 2 * 60 * 1000;
  return Date.now() - updatedAt.getTime() > staleMs;
}

function normalizeEmissaoNumeroNfse<T extends Record<string, any>>(emissao: T): T {
  return {
    ...emissao,
    status: getNormalizedEmissaoStatus(emissao),
    numeroNfse: getNormalizedNumeroNfse(emissao),
  };
}

function getNumeroNfseForReport(emissao: any) {
  return getNormalizedNumeroNfse(emissao);
}

type IssuedInvoiceReportItem = {
  emissaoId: string;
  invoiceId: string | null;
  emissionDate: string;
  numeroNfse: string;
  codigoVerificacao: string;
  chaveAcesso: string;
  landlordName: string;
  landlordDoc: string;
  propertyTitle: string;
  propertyAddress: string;
  reference: string;
  description: string;
  valorServico: number;
  valorIss: number;
  valorLiquido: number;
};

type IssuedInvoicesReportTypeFilter = "IMOBILIARIA" | "PROPRIETARIO" | "TODAS";

async function getIssuedInvoicesReport(
  startDate?: string,
  endDate?: string,
  typeFilter: IssuedInvoicesReportTypeFilter = "IMOBILIARIA",
) {
  const { start, end } = getPeriodBounds(startDate, endDate);
  const filterStats = {
    total: 0,
    nonEmitida: 0,
    filteredByType: 0,
    orphanLandlordEmission: 0,
    missingDate: 0,
    invalidDate: 0,
    beforeStart: 0,
    afterEnd: 0,
    included: 0,
  };
  const sampleSkipped: Array<{ emissaoId: string; status: string; reason: string; rawDate: string | null }> = [];
  // #region debug-point A:report-entry
  debugIssuedInvoicesReport("post-fix", "A", "server/routes.ts:getIssuedInvoicesReport:start", "Entrou no gerador do relatorio", {
    startDate: startDate || null,
    endDate: endDate || null,
    typeFilter,
    parsedStart: start ? start.toISOString() : null,
    parsedEnd: end ? end.toISOString() : null,
  });
  // #endregion

  const [emissoes, invoices, landlords, receipts, contracts, properties] = await Promise.all([
    storage.getNfseEmissoes(),
    storage.getInvoices(),
    storage.getLandlords(),
    storage.getReceipts(),
    storage.getContracts(),
    storage.getProperties(),
  ]);

  const invoiceById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const landlordById = new Map(landlords.map((landlord) => [landlord.id, landlord]));
  const receiptById = new Map(receipts.map((receipt) => [receipt.id, receipt]));
  const contractById = new Map(contracts.map((contract) => [contract.id, contract]));
  const propertyById = new Map(properties.map((property) => [property.id, property]));

  const items: IssuedInvoiceReportItem[] = [];
  // #region debug-point B:loaded-collections
  debugIssuedInvoicesReport("post-fix", "B", "server/routes.ts:getIssuedInvoicesReport:collections", "Colecoes carregadas para o relatorio", {
    emissoes: emissoes.length,
    invoices: invoices.length,
    landlords: landlords.length,
    receipts: receipts.length,
    contracts: contracts.length,
    properties: properties.length,
    emittedStatuses: emissoes.reduce<Record<string, number>>((acc, emissao) => {
      acc[emissao.status] = (acc[emissao.status] || 0) + 1;
      return acc;
    }, {}),
  });
  // #endregion

  for (const emissao of emissoes) {
    filterStats.total += 1;
    if (emissao.status !== "EMITIDA") {
      filterStats.nonEmitida += 1;
      if (sampleSkipped.length < 5) {
        sampleSkipped.push({
          emissaoId: emissao.id,
          status: emissao.status,
          reason: "status",
          rawDate: emissao.updatedAt ? new Date(emissao.updatedAt).toISOString() : emissao.createdAt ? new Date(emissao.createdAt).toISOString() : null,
        });
      }
      continue;
    }

    const isLandlordEmission = emissao.origemTipo === LANDLORD_NFSE_ORIGIN_TYPE;
    if (
      (typeFilter === "IMOBILIARIA" && isLandlordEmission) ||
      (typeFilter === "PROPRIETARIO" && !isLandlordEmission)
    ) {
      filterStats.filteredByType += 1;
      if (sampleSkipped.length < 5) {
        sampleSkipped.push({
          emissaoId: emissao.id,
          status: emissao.status,
          reason: "type-filter",
          rawDate: emissao.updatedAt ? new Date(emissao.updatedAt).toISOString() : emissao.createdAt ? new Date(emissao.createdAt).toISOString() : null,
        });
      }
      continue;
    }

    const emissionDate = emissao.updatedAt || emissao.createdAt;
    if (!emissionDate) {
      filterStats.missingDate += 1;
      if (sampleSkipped.length < 5) {
        sampleSkipped.push({
          emissaoId: emissao.id,
          status: emissao.status,
          reason: "missing-date",
          rawDate: null,
        });
      }
      continue;
    }

    const emissionDateObj = emissionDate instanceof Date ? emissionDate : new Date(emissionDate);
    if (Number.isNaN(emissionDateObj.getTime())) {
      filterStats.invalidDate += 1;
      if (sampleSkipped.length < 5) {
        sampleSkipped.push({
          emissaoId: emissao.id,
          status: emissao.status,
          reason: "invalid-date",
          rawDate: String(emissionDate),
        });
      }
      continue;
    }
    if (start && emissionDateObj < start) {
      filterStats.beforeStart += 1;
      if (sampleSkipped.length < 5) {
        sampleSkipped.push({
          emissaoId: emissao.id,
          status: emissao.status,
          reason: "before-start",
          rawDate: emissionDateObj.toISOString(),
        });
      }
      continue;
    }
    if (end && emissionDateObj > end) {
      filterStats.afterEnd += 1;
      if (sampleSkipped.length < 5) {
        sampleSkipped.push({
          emissaoId: emissao.id,
          status: emissao.status,
          reason: "after-end",
          rawDate: emissionDateObj.toISOString(),
        });
      }
      continue;
    }
    const invoice =
      emissao.origemTipo === "INVOICE" || emissao.origemTipo === LANDLORD_NFSE_ORIGIN_TYPE
        ? invoiceById.get(emissao.origemId)
        : undefined;
    if (isLandlordEmission && !invoice) {
      filterStats.orphanLandlordEmission += 1;
      if (sampleSkipped.length < 5) {
        sampleSkipped.push({
          emissaoId: emissao.id,
          status: emissao.status,
          reason: "orphan-landlord-emission",
          rawDate: emissionDateObj.toISOString(),
        });
      }
      continue;
    }

    filterStats.included += 1;

    const landlord = invoice ? landlordById.get(invoice.landlordId) : undefined;
    const receipt = invoice ? receiptById.get(invoice.receiptId) : undefined;
    const contract = receipt ? contractById.get(receipt.contractId) : undefined;
    const property = contract ? propertyById.get(contract.propertyId) : undefined;
    const parsedRef = parseRefFromDescription(emissao.descricaoServico);
    const refMonth = receipt?.refMonth ?? parsedRef.refMonth ?? null;
    const refYear = receipt?.refYear ?? parsedRef.refYear ?? null;
    const reference = refMonth && refYear ? `${String(refMonth).padStart(2, "0")}/${refYear}` : "-";
    const valorServico = Number(emissao.valorServico || 0);
    const valorIss = Number(emissao.valorIss || 0);

    items.push({
      emissaoId: emissao.id,
      invoiceId: invoice?.id || null,
      emissionDate: emissionDateObj.toISOString(),
      numeroNfse: getNumeroNfseForReport(emissao),
      codigoVerificacao: emissao.codigoVerificacao || "-",
      chaveAcesso: emissao.chaveAcesso || "-",
      landlordName: landlord?.name || emissao.tomadorNome || "-",
      landlordDoc: landlord?.doc || emissao.tomadorCpfCnpj || "-",
      propertyTitle: property?.title || parsePropertyFromDescription(emissao.descricaoServico) || "-",
      propertyAddress: property?.address || "-",
      reference,
      description: emissao.descricaoServico || "-",
      valorServico,
      valorIss,
      valorLiquido: valorServico - valorIss,
    });
  }

  items.sort((a, b) => new Date(a.emissionDate).getTime() - new Date(b.emissionDate).getTime());

  const totalValorServico = items.reduce((sum, item) => sum + item.valorServico, 0);
  const totalValorIss = items.reduce((sum, item) => sum + item.valorIss, 0);
  const totalValorLiquido = items.reduce((sum, item) => sum + item.valorLiquido, 0);
  // #region debug-point C:report-result
  debugIssuedInvoicesReport("post-fix", "C", "server/routes.ts:getIssuedInvoicesReport:result", "Relatorio montado", {
    startDate: start ? start.toISOString() : null,
    endDate: end ? end.toISOString() : null,
    items: items.length,
    filterStats,
    sampleSkipped,
    sample: items.slice(0, 3).map((item) => ({
      emissaoId: item.emissaoId,
      numeroNfse: item.numeroNfse,
      reference: item.reference,
      propertyTitle: item.propertyTitle,
      landlordName: item.landlordName,
    })),
  });
  // #endregion

  return {
    startDate: start ? start.toISOString().split("T")[0] : null,
    endDate: end ? end.toISOString().split("T")[0] : null,
    typeFilter,
    items,
    summary: {
      totalNotas: items.length,
      totalValorServico,
      totalValorIss,
      totalValorLiquido,
    },
  };
}

const DIMOB_MONTH_LABELS = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"] as const;

type DimobMonthValue = {
  rendaBruta: number;
  comissao: number;
  impostoRetido: number;
};

type DimobContractSheet = {
  contractId: string;
  contractCode: string | null;
  contractStartDate: string | null;
  contractEndDate: string | null;
  propertyType: string | null;

  landlord: { id: string; name: string; doc: string };
  tenant: { id: string; name: string; doc: string };
  property: {
    id: string;
    code: string | null;
    title: string;
    address: string;
    neighborhood: string | null;
    city: string;
    state: string;
    zipCode: string | null;
  };

  months: DimobMonthValue[]; // length 12, index 0 = JAN
  totals: { rendaBruta: number; comissao: number; impostoRetido: number };
};

type DimobLandlordReport = {
  year: number;
  landlordId: string | null;
  sheets: DimobContractSheet[];
  summary: {
    totalContratos: number;
    totalRendaBruta: number;
    totalComissao: number;
    totalImpostoRetido: number;
  };
};

function formatDimobCurrency(value: number) {
  return (Number(value) || 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDatePtBr(value: string | null | undefined) {
  if (!value) return "";
  const iso = String(value).split("T")[0];
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return String(value);
  return `${d}/${m}/${y}`;
}

function formatCpfCnpj(value: string | null | undefined) {
  const raw = String(value || "").replace(/\D/g, "");
  if (raw.length === 11) return `${raw.slice(0, 3)}.${raw.slice(3, 6)}.${raw.slice(6, 9)}-${raw.slice(9)}`;
  if (raw.length === 14) return `${raw.slice(0, 2)}.${raw.slice(2, 5)}.${raw.slice(5, 8)}/${raw.slice(8, 12)}-${raw.slice(12)}`;
  return raw;
}

function escapeDimobText(value: unknown) {
  const str = String(value ?? "");
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function getDimobLandlordReport(
  yearInput: number | undefined,
  landlordIdInput: string | undefined,
): Promise<DimobLandlordReport> {
  const year = Number(yearInput) || new Date().getFullYear();
  const landlordId = landlordIdInput ? String(landlordIdInput).trim() : undefined;

  const [allLandlords, allTenants, allProperties, allContracts] = await Promise.all([
    storage.getLandlords(),
    storage.getTenants(),
    storage.getProperties(),
    storage.getContracts(),
  ]);

  const landlordById = new Map<string, (typeof allLandlords)[number]>();
  const tenantById = new Map<string, (typeof allTenants)[number]>();
  const propertyById = new Map<string, (typeof allProperties)[number]>();
  allLandlords.forEach((l) => landlordById.set(l.id, l));
  allTenants.forEach((t) => tenantById.set(t.id, t));
  allProperties.forEach((p) => propertyById.set(p.id, p));

  let receiptsOfYear = (await storage.getReceipts()).filter((r) => Number(r.refYear) === year);
  if (landlordId) {
    const contractsOfLandlord = new Set(allContracts.filter((c: any) => String((c as any).landlordId) === landlordId).map((c: any) => String((c as any).id)));
    receiptsOfYear = receiptsOfYear.filter((r) => contractsOfLandlord.has(String(r.contractId)));
  }

  const contractsByReceipt = [...new Set(receiptsOfYear.map((r) => String(r.contractId)))];
  const relevantContractIds =
    landlordId
      ? allContracts.filter((c: any) => String((c as any).landlordId) === landlordId).map((c: any) => String((c as any).id))
      : contractsByReceipt;

  const uniqueContractIds = [...new Set(relevantContractIds)];
  const contractsForReport = allContracts.filter((c: any) => uniqueContractIds.includes(String((c as any).id)));

  const zeroMonth = (): DimobMonthValue => ({ rendaBruta: 0, comissao: 0, impostoRetido: 0 });

  const sheets: DimobContractSheet[] = contractsForReport
    .map((contractRaw) => {
      const c = contractRaw as any;
      const landlord = landlordById.get(String(c.landlordId));
      const tenant = tenantById.get(String(c.tenantId));
      const property = propertyById.get(String(c.propertyId));
      if (!landlord || !tenant || !property) return null;

      const months: DimobMonthValue[] = Array.from({ length: 12 }, () => zeroMonth());
      for (let m = 0; m < 12; m += 1) {
        const rec = receiptsOfYear.find(
          (r) => String(r.contractId) === String(c.id) && Number(r.refMonth) === m + 1,
        );
        if (rec) {
          months[m] = {
            rendaBruta: Number(rec.rentAmount) || 0,
            comissao: Number(rec.adminFeeAmount) || 0,
            impostoRetido: 0,
          };
        }
      }

      const totals = months.reduce(
        (acc, mv) => {
          acc.rendaBruta += mv.rendaBruta;
          acc.comissao += mv.comissao;
          acc.impostoRetido += mv.impostoRetido;
          return acc;
        },
        { rendaBruta: 0, comissao: 0, impostoRetido: 0 },
      );

      return {
        contractId: String(c.id),
        contractCode: c.code || null,
        contractStartDate: c.startDate || null,
        contractEndDate: c.endDate || null,
        propertyType: (property as any).type || null,
        landlord: {
          id: String(landlord.id),
          name: String(landlord.name),
          doc: String(landlord.doc),
        },
        tenant: {
          id: String(tenant.id),
          name: String(tenant.name),
          doc: String(tenant.doc),
        },
        property: {
          id: String(property.id),
          code: (property as any).code || null,
          title: String((property as any).title),
          address: String((property as any).address),
          neighborhood: (property as any).neighborhood || null,
          city: String((property as any).city),
          state: String((property as any).state),
          zipCode: (property as any).zipCode || null,
        },
        months,
        totals,
      } as DimobContractSheet;
    })
    .filter((s): s is DimobContractSheet => !!s)
    .sort((a, b) => {
      const nameDiff = a.landlord.name.localeCompare(b.landlord.name, "pt-BR");
      if (nameDiff !== 0) return nameDiff;
      return a.property.address.localeCompare(b.property.address, "pt-BR");
    });

  const summary = sheets.reduce(
    (acc, s) => {
      acc.totalContratos += 1;
      acc.totalRendaBruta += s.totals.rendaBruta;
      acc.totalComissao += s.totals.comissao;
      acc.totalImpostoRetido += s.totals.impostoRetido;
      return acc;
    },
    { totalContratos: 0, totalRendaBruta: 0, totalComissao: 0, totalImpostoRetido: 0 },
  );

  return {
    year,
    landlordId: landlordId || null,
    sheets,
    summary,
  };
}

function buildDimobLandlordSingleSheetHtml(sheet: DimobContractSheet, year: number) {
  const propertyAddressLine = [
    sheet.property.address,
    sheet.property.neighborhood,
    sheet.property.city,
    sheet.property.state,
    sheet.property.zipCode,
  ]
    .filter(Boolean)
    .join(" - ");

  const monthRows = DIMOB_MONTH_LABELS.map((label, idx) => {
    const m = sheet.months[idx] || { rendaBruta: 0, comissao: 0, impostoRetido: 0 };
    return `
      <tr>
        <td class="month-cell">${escapeDimobText(label)}</td>
        <td class="money">${formatDimobCurrency(m.rendaBruta)}</td>
        <td class="money">${formatDimobCurrency(m.comissao)}</td>
        <td class="money">${formatDimobCurrency(m.impostoRetido)}</td>
      </tr>
    `;
  }).join("");

  return `
    <section class="sheet page">
      <div class="sheet-title">
        <div>FICHA DE INFORMA&Ccedil;&Otilde;ES ${escapeDimobText(year)} &mdash; IMPOSTO DE RENDA / DIMOB</div>
        <div class="subtitle">Uma ficha por contrato conforme modelo de preenchimento da Receita Federal</div>
      </div>
      <table class="header-table">
        <tbody>
          <tr>
            <td class="label">CPF DO LOCADOR:</td>
            <td class="value strong">${escapeDimobText(formatCpfCnpj(sheet.landlord.doc))}</td>
          </tr>
          <tr>
            <td class="label">NOME DO LOCADOR:</td>
            <td class="value">${escapeDimobText(sheet.landlord.name)}</td>
          </tr>
          <tr>
            <td class="label">CPF / CNPJ DO LOCAT&Aacute;RIO:</td>
            <td class="value strong">${escapeDimobText(formatCpfCnpj(sheet.tenant.doc))}</td>
          </tr>
          <tr>
            <td class="label">NOME DO LOCAT&Aacute;RIO:</td>
            <td class="value">${escapeDimobText(sheet.tenant.name)}</td>
          </tr>
          <tr>
            <td class="label">N&Uacute;MERO DO CONTRATO:</td>
            <td class="value">${escapeDimobText(sheet.contractCode || sheet.contractId)} &nbsp;&nbsp; <span class="muted">DATA: ${escapeDimobText(formatDatePtBr(sheet.contractStartDate))} &mdash; ${escapeDimobText(formatDatePtBr(sheet.contractEndDate))}</span></td>
          </tr>
          <tr>
            <td class="label">TIPO DO IM&Oacute;VEL:</td>
            <td class="value">${escapeDimobText(sheet.propertyType || "")}</td>
          </tr>
          <tr>
            <td class="label">ENDERE&Ccedil;O:</td>
            <td class="value">${escapeDimobText(propertyAddressLine)}</td>
          </tr>
          <tr>
            <td class="label">MUNIC&Iacute;PIO / UF / CEP:</td>
            <td class="value">${escapeDimobText(sheet.property.city)} / ${escapeDimobText(sheet.property.state)} / ${escapeDimobText(sheet.property.zipCode || "")}</td>
          </tr>
        </tbody>
      </table>

      <table class="matrix">
        <thead>
          <tr>
            <th class="month-cell">M&Ecirc;S</th>
            <th>RENDA BRUTA (R$)</th>
            <th>COMISS&Atilde;O (R$)</th>
            <th>IMPOSTO RETIDO (R$)</th>
          </tr>
        </thead>
        <tbody>
          ${monthRows}
          <tr class="total-row">
            <td class="month-cell strong">TOTAL ${escapeDimobText(String(year))}</td>
            <td class="money strong">${formatDimobCurrency(sheet.totals.rendaBruta)}</td>
            <td class="money strong">${formatDimobCurrency(sheet.totals.comissao)}</td>
            <td class="money strong">${formatDimobCurrency(sheet.totals.impostoRetido)}</td>
          </tr>
        </tbody>
      </table>

      <div class="legend">
        Imposto Retido permanece zerado conforme orienta&ccedil;&atilde;o. Ser&aacute; preenchido posteriormente quando a regra de c&aacute;lculo ou importa&ccedil;&atilde;o for definida.
      </div>
    </section>
  `;
}

function buildDimobLandlordReportHtml(report: DimobLandlordReport) {
  const summaryLine = `
    <section class="summary">
      <div><strong>Ano base:</strong> ${escapeDimobText(String(report.year))}</div>
      <div><strong>Total de contratos (fichas):</strong> ${report.summary.totalContratos}</div>
      <div><strong>Renda bruta acumulada:</strong> R$ ${formatDimobCurrency(report.summary.totalRendaBruta)}</div>
      <div><strong>Comiss&atilde;o acumulada:</strong> R$ ${formatDimobCurrency(report.summary.totalComissao)}</div>
      <div><strong>Imposto retido acumulado:</strong> R$ ${formatDimobCurrency(report.summary.totalImpostoRetido)}</div>
    </section>
  `;
  const sheetsHtml = report.sheets.map((s) => buildDimobLandlordSingleSheetHtml(s, report.year)).join("");
  const generatedAt = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

  const styles = `
    @page { size: A4; margin: 1.2cm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 11px; line-height: 1.35; }
    h1 { font-size: 14px; margin: 0 0 10px 0; }
    .summary { border: 1px solid #999; padding: 8px 12px; background: #f4f4f4; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; margin-bottom: 16px; }
    .page { break-after: page; page-break-after: always; }
    .sheet-title { text-align: center; border: 1px solid #222; padding: 8px 10px; margin-bottom: 10px; font-weight: 700; font-size: 13px; background: #fafafa; }
    .sheet-title .subtitle { font-weight: 400; font-size: 10px; color: #333; margin-top: 2px; }
    .header-table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
    .header-table td { border: 1px solid #666; padding: 4px 6px; vertical-align: top; }
    .header-table .label { width: 32%; background: #f4f4f4; font-weight: 700; }
    .header-table .value { width: 68%; }
    .muted { color: #555; font-size: 10px; }
    .strong { font-weight: 700; }
    .matrix { width: 100%; border-collapse: collapse; }
    .matrix th, .matrix td { border: 1px solid #222; padding: 5px 6px; }
    .matrix thead th { background: #f4f4f4; text-align: center; }
    .matrix .month-cell { width: 18%; text-align: center; font-weight: 700; background: #f9f9f9; }
    .matrix .money { text-align: right; font-variant-numeric: tabular-nums; }
    .matrix .total-row td { background: #eaeaea; }
    .legend { margin-top: 10px; font-size: 10px; color: #444; border-top: 1px dashed #888; padding-top: 6px; }
    .footer { margin-top: 16px; font-size: 9px; color: #666; display: flex; justify-content: space-between; }
  `;

  return `<!DOCTYPE html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <style>${styles}</style>
    <title>Relat&oacute;rio Imposto de Renda / DIMOB ${escapeDimobText(String(report.year))}</title>
  </head>
  <body>
    ${summaryLine}
    ${sheetsHtml}
    <div class="footer">
      <div>Imobili&aacute;ria Simples</div>
      <div>Relat&oacute;rio gerado em ${escapeDimobText(generatedAt)}</div>
    </div>
  </body>
</html>`;
}

function buildDimobLandlordCsv(report: DimobLandlordReport) {
  const bom = "\uFEFF";
  const lines: string[] = [];
  const esc = (value: unknown) => {
    const str = String(value ?? "");
    if (/[;,\n\r"]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
    return str;
  };
  lines.push([
    "ANO",
    "CPF_LOCADOR",
    "NOME_LOCADOR",
    "CPF_CNPJ_LOCATARIO",
    "NOME_LOCATARIO",
    "CONTRATO",
    "DATA_INICIO_CONTRATO",
    "DATA_FIM_CONTRATO",
    "TIPO_IMOVEL",
    "ENDERECO_IMOVEL",
    "BAIRRO_IMOVEL",
    "MUNICIPIO_IMOVEL",
    "UF_IMOVEL",
    "CEP_IMOVEL",
    "MES",
    "MES_LABEL",
    "RENDA_BRUTA",
    "COMISSAO",
    "IMPOSTO_RETIDO",
  ].join(";"));

  for (const sheet of report.sheets) {
    for (let m = 0; m < 12; m += 1) {
      const mv = sheet.months[m];
      lines.push([
        String(report.year),
        esc(formatCpfCnpj(sheet.landlord.doc)),
        esc(sheet.landlord.name),
        esc(formatCpfCnpj(sheet.tenant.doc)),
        esc(sheet.tenant.name),
        esc(sheet.contractCode || sheet.contractId),
        esc(formatDatePtBr(sheet.contractStartDate)),
        esc(formatDatePtBr(sheet.contractEndDate)),
        esc(sheet.propertyType || ""),
        esc(sheet.property.address),
        esc(sheet.property.neighborhood || ""),
        esc(sheet.property.city),
        esc(sheet.property.state),
        esc(sheet.property.zipCode || ""),
        String(m + 1).padStart(2, "0"),
        esc(DIMOB_MONTH_LABELS[m]),
        esc(formatDimobCurrency(mv.rendaBruta)),
        esc(formatDimobCurrency(mv.comissao)),
        esc(formatDimobCurrency(mv.impostoRetido)),
      ].join(";"));
    }
  }

  return bom + lines.join("\r\n");
}

function buildIssuedInvoicesReportHtml(report: Awaited<ReturnType<typeof getIssuedInvoicesReport>>) {
  const orderedItems = [...report.items].sort(
    (a, b) => new Date(a.emissionDate).getTime() - new Date(b.emissionDate).getTime(),
  );

  const rows = orderedItems.map((item) => `
    <tr>
      <td>${escapeHtml(formatDateTime(item.emissionDate))}</td>
      <td>${escapeHtml(item.numeroNfse)}</td>
      <td>${escapeHtml(item.reference)}</td>
      <td>
        <div class="primary">${escapeHtml(item.propertyTitle)}</div>
        <div class="secondary">${escapeHtml(item.propertyAddress)}</div>
      </td>
      <td>
        <div class="primary">${escapeHtml(item.landlordName)}</div>
        <div class="secondary">${escapeHtml(item.landlordDoc)}</div>
      </td>
      <td>${escapeHtml(item.codigoVerificacao)}</td>
      <td class="money">R$ ${escapeHtml(formatCurrency(item.valorServico))}</td>
      <td class="money">R$ ${escapeHtml(formatCurrency(item.valorIss))}</td>
      <td class="money strong">R$ ${escapeHtml(formatCurrency(item.valorLiquido))}</td>
    </tr>
  `).join("");

  return `<!DOCTYPE html>
  <html lang="pt-BR">
    <head>
      <meta charset="UTF-8" />
      <title>Relatório de Notas Fiscais Emitidas</title>
      <style>
        @page { size: A4 landscape; margin: 14mm; }
        * { box-sizing: border-box; }
        body {
          margin: 0;
          font-family: Arial, Helvetica, sans-serif;
          color: #0f172a;
          background: #ffffff;
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 18px;
          padding-bottom: 14px;
          border-bottom: 2px solid #e2e8f0;
        }
        .brand h1 {
          margin: 0 0 6px 0;
          font-size: 24px;
          line-height: 1.2;
        }
        .brand p,
        .meta p {
          margin: 0;
          color: #475569;
          font-size: 12px;
          line-height: 1.5;
        }
        .meta {
          text-align: right;
        }
        .cards {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 12px;
          margin-bottom: 18px;
        }
        .card {
          border: 1px solid #dbe4f0;
          border-radius: 12px;
          padding: 14px 16px;
          background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
        }
        .card .label {
          margin: 0 0 8px 0;
          color: #64748b;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-weight: 700;
        }
        .card .value {
          margin: 0;
          font-size: 22px;
          font-weight: 700;
          color: #0f172a;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
        }
        thead th {
          background: #0f172a;
          color: #ffffff;
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          padding: 10px 8px;
          text-align: left;
        }
        tbody td {
          padding: 10px 8px;
          border-bottom: 1px solid #e2e8f0;
          font-size: 11px;
          vertical-align: top;
          color: #1e293b;
          word-break: break-word;
        }
        tbody tr:nth-child(even) {
          background: #f8fafc;
        }
        .primary {
          font-weight: 700;
          color: #0f172a;
          margin-bottom: 3px;
        }
        .secondary {
          color: #64748b;
          font-size: 10px;
          line-height: 1.35;
        }
        .money {
          text-align: right;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .strong {
          font-weight: 700;
        }
        .empty {
          padding: 32px;
          text-align: center;
          border: 1px dashed #cbd5e1;
          border-radius: 12px;
          color: #64748b;
          font-size: 13px;
        }
        .footer {
          margin-top: 16px;
          display: flex;
          justify-content: space-between;
          color: #64748b;
          font-size: 10px;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="brand">
          <h1>Relatório de Notas Fiscais Emitidas</h1>
          <p>Período: ${report.startDate || report.endDate
            ? `${escapeHtml(formatDateOnly(report.startDate))} a ${escapeHtml(formatDateOnly(report.endDate))}`
            : "Todos os períodos"}</p>
          <p>Tipo: ${escapeHtml(
            report.typeFilter === "IMOBILIARIA"
              ? "Imobiliária"
              : report.typeFilter === "PROPRIETARIO"
                ? "Proprietário"
                : "Todas",
          )}</p>
          <p>Resumo financeiro e detalhamento das NFS-e emitidas no período selecionado.</p>
        </div>
        <div class="meta">
          <p><strong>Emitido em:</strong> ${escapeHtml(formatDateTime(new Date()))}</p>
          <p><strong>Status considerado:</strong> NFS-e emitidas</p>
        </div>
      </div>

      <div class="cards">
        <div class="card">
          <p class="label">Total de Notas</p>
          <p class="value">${escapeHtml(String(report.summary.totalNotas))}</p>
        </div>
        <div class="card">
          <p class="label">Valor de Serviço</p>
          <p class="value">R$ ${escapeHtml(formatCurrency(report.summary.totalValorServico))}</p>
        </div>
        <div class="card">
          <p class="label">ISS</p>
          <p class="value">R$ ${escapeHtml(formatCurrency(report.summary.totalValorIss))}</p>
        </div>
        <div class="card">
          <p class="label">Valor Líquido</p>
          <p class="value">R$ ${escapeHtml(formatCurrency(report.summary.totalValorLiquido))}</p>
        </div>
      </div>

      ${report.items.length === 0 ? `
        <div class="empty">Nenhuma NFS-e emitida encontrada para o período informado.</div>
      ` : `
        <table>
          <thead>
            <tr>
              <th style="width: 12%">Emissão</th>
              <th style="width: 8%">NFS-e</th>
              <th style="width: 8%">Referência</th>
              <th style="width: 22%">Imóvel</th>
              <th style="width: 18%">Proprietário</th>
              <th style="width: 12%">Verificação</th>
              <th style="width: 7%">Serviço</th>
              <th style="width: 6%">ISS</th>
              <th style="width: 7%">Líquido</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      `}

      <div class="footer">
        <div>Imobiliária Simples</div>
        <div>Relatório gerado automaticamente pelo sistema</div>
      </div>
    </body>
  </html>`;
}

async function assertSensitiveActionCredentials(
  req: Request,
  params: { password: string; totpToken?: string },
): Promise<void> {
  const userId = req.session?.userId;
  if (!userId) {
    const error = new Error("Não autenticado");
    (error as any).statusCode = 401;
    throw error;
  }

  const user = await storage.getUser(userId);
  if (!user) {
    const error = new Error("Usuário não encontrado");
    (error as any).statusCode = 404;
    throw error;
  }

  if (!params.password) {
    const error = new Error("Senha é obrigatória para esta operação");
    (error as any).statusCode = 400;
    throw error;
  }

  const validPassword = await bcrypt.compare(params.password, user.passwordHash);
  if (!validPassword) {
    const error = new Error("Senha inválida");
    (error as any).statusCode = 403;
    throw error;
  }

  if (user.isTwoFactorEnabled) {
    if (!params.totpToken) {
      const error = new Error("Código do autenticador é obrigatório para esta operação");
      (error as any).statusCode = 400;
      throw error;
    }
    const validToken = speakeasy.totp.verify({
      secret: user.twoFactorSecret!,
      encoding: "base32",
      token: params.totpToken,
      window: 1,
    });
    if (!validToken) {
      const error = new Error("Código do autenticador inválido");
      (error as any).statusCode = 403;
      throw error;
    }
  }
}

// Helper to safely calculate Due Date (clamping to end of month)
function calculateReceiptDueDate(year: number, month: number, dueDay: number): string {
  // month is 1-12
  // Date constructor uses 0-11 for month
  const targetMonthIndex = month - 1;
  const date = new Date(year, targetMonthIndex, dueDay);
  
  // Check if month rolled over (e.g. Feb 30 -> Mar 2)
  if (date.getMonth() !== targetMonthIndex) {
    // Clamp to last day of the intended month
    const lastDayOfMonth = new Date(year, month, 0); // Day 0 of next month is last day of current
    return lastDayOfMonth.toISOString().split('T')[0];
  }
  
  return date.toISOString().split('T')[0];
}

function getFirstDueYearMonth(firstDueDate: unknown) {
  if (!firstDueDate) return { year: 0, month: 0 };

  let firstY = 0;
  let firstM = 0;
  const str = String(firstDueDate);

  if (str.includes("-")) {
    const parts = str.split("-");
    if (parts[0].length === 4) {
      firstY = parseInt(parts[0]);
      firstM = parseInt(parts[1]);
    } else {
      firstY = parseInt(parts[2]);
      firstM = parseInt(parts[1]);
    }
  } else if (str.includes("/")) {
    const parts = str.split("/");
    firstY = parseInt(parts[2]);
    firstM = parseInt(parts[1]);
  }

  return { year: firstY, month: firstM };
}

async function generateReceiptForContract(contract: any, year: number, month: number) {
  if (contract.firstDueDate) {
    const firstDue = getFirstDueYearMonth(contract.firstDueDate);
    if (firstDue.year > 0 && firstDue.month > 0) {
      const target = year * 100 + month;
      const min = firstDue.year * 100 + firstDue.month;

      if (target < min) {
        const existingReceipt = await storage.getReceiptByContractAndRef(contract.id, year, month);
        if (existingReceipt && existingReceipt.status === "draft") {
          await storage.deleteReceipt(existingReceipt.id);
          console.log(`[Generate] Deleted invalid draft receipt ${existingReceipt.id} for contract ${contract.id}`);
        }
        return { created: false as const, reason: "before_first_due_date" as const };
      }
    }
  }

  const existingReceipt = await storage.getReceiptByContractAndRef(contract.id, year, month);
  if (existingReceipt) {
    return { created: false as const, reason: "already_exists" as const, receipt: existingReceipt };
  }

  let currentServices = await storage.getServicesByContractAndRef(contract.id, year, month);

  const recurringItems = await storage.getContractRecurringItems(contract.id);
  for (const item of recurringItems) {
    const existingService = currentServices.find((s) => s.description === item.description);
    if (!existingService) {
      await storage.createService({
        contractId: contract.id,
        refYear: year,
        refMonth: month,
        description: item.description,
        amount: String(item.amount),
        chargedTo: item.chargedTo,
        discountFrom: item.discountFrom,
        passThrough: item.passThrough,
      });
    } else {
      await storage.updateService(existingService.id, {
        amount: String(item.amount),
        chargedTo: item.chargedTo,
        discountFrom: item.discountFrom,
        passThrough: item.passThrough,
      });
    }
  }

  if (contract.guaranteeType === "insurance" && Number(contract.insuranceValue) > 0) {
    currentServices = await storage.getServicesByContractAndRef(contract.id, year, month);
    const hasInsurance = currentServices.some((s) => s.description === "Seguro Fiança");

    if (!hasInsurance) {
      await storage.createService({
        contractId: contract.id,
        refYear: year,
        refMonth: month,
        description: "Seguro Fiança",
        amount: String(contract.insuranceValue),
        chargedTo: "TENANT",
        passThrough: false,
      });
    }
  }

  const contractServices = await storage.getServicesByContractAndRef(contract.id, year, month);

  const tributeTotal = contractServices
    .filter((s: any) => (s as any).isTribute)
    .reduce((sum, s) => sum + Number(s.amount), 0);

  const receiptDiscountTenantTotal = contractServices
    .filter((s: any) => (s as any).receiptDiscountTo === "TENANT" || (s as any).receiptDiscountTo === "BOTH")
    .reduce((sum, s) => sum + Number(s.amount), 0);

  const receiptDiscountLandlordTotal = contractServices
    .filter((s: any) => (s as any).receiptDiscountTo === "LANDLORD" || (s as any).receiptDiscountTo === "BOTH")
    .reduce((sum, s) => sum + Number(s.amount), 0);

  const tenantDiscountFromRent = contractServices
    .filter((s: any) => (s as any).discountFrom === "TENANT" || (s as any).isTribute)
    .reduce((sum, s) => sum + Number(s.amount), 0);

  const landlordDiscountFromRent = contractServices
    .filter((s: any) => (s as any).discountFrom === "LANDLORD" && !(s as any).isTribute)
    .reduce((sum, s) => sum + Number(s.amount), 0);

  const servicesTenantTotal = contractServices
    .filter((s: any) => s.chargedTo === "TENANT" && !(s as any).receiptDiscountTo)
    .reduce((sum, s) => sum + Number(s.amount), 0);

  const servicesLandlordTotal = contractServices
    .filter(
      (s: any) =>
        s.chargedTo === "LANDLORD" &&
        (s as any).discountFrom !== "LANDLORD" &&
        (s as any).discountFrom !== "TENANT" &&
        !(s as any).receiptDiscountTo &&
        !(s as any).isTribute
    )
    .reduce((sum, s) => sum + Number(s.amount), 0);

  const servicesPassThroughTotal = contractServices
    .filter((s: any) => s.passThrough && !(s as any).receiptDiscountTo)
    .reduce((sum, s) => sum + Number(s.amount), 0);

  const rentAmount = Number(contract.rentAmount);
  const adjustedRentLandlord = Math.max(0, rentAmount - landlordDiscountFromRent);
  const adminFeePercent = Number(contract.adminFeePercent);
  const adminFeeAmount = (adjustedRentLandlord * adminFeePercent) / 100;
  const tenantTotalDue =
    rentAmount +
    servicesTenantTotal -
    tenantDiscountFromRent -
    receiptDiscountTenantTotal;
  const landlordTotalDue =
    adjustedRentLandlord -
    adminFeeAmount -
    servicesLandlordTotal +
    servicesPassThroughTotal -
    tributeTotal -
    receiptDiscountLandlordTotal;

  let dueDate: string;
  if (contract.firstDueDate) {
    const firstDueStr = String(contract.firstDueDate).split("T")[0];
    const [fYearStr, fMonthStr] = firstDueStr.split("-");
    const fYear = parseInt(fYearStr);
    const fMonth = parseInt(fMonthStr);

    if (year === fYear && month === fMonth) {
      dueDate = firstDueStr;
    } else {
      dueDate = calculateReceiptDueDate(year, month, contract.dueDay);
    }
  } else {
    dueDate = calculateReceiptDueDate(year, month, contract.dueDay);
  }

  const receipt = await storage.createReceipt({
    contractId: contract.id,
    refYear: year,
    refMonth: month,
    rentAmount: String(rentAmount),
    adminFeePercent: String(adminFeePercent),
    adminFeeAmount: String(adminFeeAmount),
    servicesTenantTotal: String(servicesTenantTotal),
    servicesLandlordTotal: String(servicesLandlordTotal),
    tenantTotalDue: String(tenantTotalDue),
    landlordTotalDue: String(landlordTotalDue),
    dueDate,
    status: "draft",
  });

  return { created: true as const, receipt };
}

// Helper to normalize data (uppercase strings, lowercase emails)
function normalizeInputData(data: any) {
  if (!data || typeof data !== 'object') return data;
  
  const newData = { ...data };
  
  // Fields to always lowercase
  const lowerCaseFields = ['email', 'tomadorEmail', 'email_corporativo'];
  
  // Fields to preserve (do not change case)
  const preserveFields = [
    'id', 'password', 'passwordHash', 'pixKey', 'pixKeyType', 'status',
    'slipPdfUrl', 'slipOurNumber', 'slipDigitableLine', 'slipBarcode',
    'xmlUrl', 'pdfUrl', 'chaveAcesso', 'codigoVerificacao',
    'details', 'tomadorEnderecoJson', 'apiRequestRaw', 'apiResponseRaw',
    'certificatePassword', 'certificadoSenha',
    'nfseCertificatePassword', 'nfseCertificatePfxBase64', 'nfseCertificateFileName',
    'nfseMunicipioIbge', 'nfseServiceItem', 'nfseNationalTaxCode', 'nfseIssRate',
    'nfseIbsCbsCst', 'nfseIbsCbsClassTrib', 'nfseIbsCbsIndOp', 'nfseOpSimpNac', 'nfseEnvironment',
    'nfseSeries', 'nfseLastNumber', 'invoiceCategory'
  ];

  for (const key of Object.keys(newData)) {
    if (typeof newData[key] === 'string') {
      if (lowerCaseFields.includes(key)) {
        newData[key] = newData[key].toLowerCase();
      } else if (!preserveFields.includes(key) && !key.endsWith('Url') && !key.endsWith('Id') && !key.startsWith('url')) {
        newData[key] = newData[key].toUpperCase();
      }
    }
  }
  return newData;
}

function sanitizeLandlordForResponse(landlord: any) {
  if (!landlord) return landlord;
  const {
    nfseCertificatePassword,
    nfseCertificatePfxBase64,
    ...safeLandlord
  } = landlord;
  return safeLandlord;
}

const AUDIT_IGNORED_FIELDS = new Set([
  "createdAt",
  "updatedAt",
]);

function isAuditSensitiveField(fieldName: string) {
  const normalized = fieldName.toLowerCase();
  if (normalized === "pixkey") return true;
  if (normalized.includes("password")) return true;
  if (normalized.includes("secret")) return true;
  if (normalized.includes("token")) return true;
  if (normalized.includes("certificatepfx")) return true;
  if (normalized.includes("certificadopfx")) return true;
  return false;
}

function formatAuditValue(fieldName: string, value: unknown): string | null {
  if (value === undefined || value === null) return null;

  let stringValue: string;
  if (value instanceof Date) {
    stringValue = value.toISOString();
  } else if (typeof value === "string") {
    stringValue = value;
  } else if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    stringValue = String(value);
  } else {
    stringValue = safeJsonStringify(value) || String(value);
  }

  if (!stringValue) return null;

  if (isAuditSensitiveField(fieldName)) {
    if (fieldName.toLowerCase() === "pixkey") {
      return maskAuditValue(stringValue, 4, 3);
    }
    return "[OCULTO]";
  }

  if (stringValue.length > 800) {
    return `${stringValue.slice(0, 797)}...`;
  }

  return stringValue;
}

function buildAuditEntityLabel(entityType: string, entity: any) {
  if (!entity) return null;

  switch (entityType) {
    case "USUARIO":
      return entity.name || entity.email || entity.id || null;
    case "PROPRIETARIO":
    case "LOCATARIO":
    case "FIADOR":
    case "PRESTADOR":
      return entity.code ? `[${entity.code}] ${entity.name || entity.id}` : entity.name || entity.id || null;
    case "IMOVEL":
      return entity.code ? `[${entity.code}] ${entity.title || entity.address || entity.id}` : entity.title || entity.address || entity.id || null;
    case "CONTRATO":
      return entity.id ? `Contrato ${String(entity.id).slice(0, 8)}` : "Contrato";
    case "RECIBO":
      return entity.refMonth && entity.refYear
        ? `Recibo ${String(entity.refMonth).padStart(2, "0")}/${entity.refYear}`
        : entity.id ? `Recibo ${String(entity.id).slice(0, 8)}` : "Recibo";
    case "SERVICO":
      return entity.description || (entity.id ? `Serviço ${String(entity.id).slice(0, 8)}` : "Serviço");
    case "CAIXA":
      return entity.description || entity.category || (entity.id ? `Caixa ${String(entity.id).slice(0, 8)}` : "Caixa");
    case "LANCAMENTO_FINANCEIRO":
      return entity.description || `${entity.type || "Lançamento"} ${String(entity.refMonth || "").padStart(2, "0")}/${entity.refYear || ""}`.trim();
    default:
      return entity.name || entity.title || entity.description || entity.id || null;
  }
}

async function writeAuditEntries(params: {
  req: Request;
  action: "CREATE" | "UPDATE" | "DELETE";
  entityType: string;
  entityId: string;
  before?: any;
  after?: any;
}) {
  try {
    const { req, action, entityType, entityId, before, after } = params;
    const fields = new Set<string>();

    for (const key of Object.keys(before || {})) fields.add(key);
    for (const key of Object.keys(after || {})) fields.add(key);

    const entries = Array.from(fields)
      .filter((fieldName) => !AUDIT_IGNORED_FIELDS.has(fieldName))
      .map((fieldName) => {
        const oldValue = action === "CREATE" ? null : formatAuditValue(fieldName, before?.[fieldName]);
        const newValue = action === "DELETE" ? null : formatAuditValue(fieldName, after?.[fieldName]);

        if (action === "UPDATE" && oldValue === newValue) {
          return null;
        }

        if (action === "CREATE" && newValue === null) {
          return null;
        }

        if (action === "DELETE" && oldValue === null) {
          return null;
        }

        return {
          userId: req.session.userId || null,
          action,
          entityType,
          entityId,
          entityLabel: buildAuditEntityLabel(entityType, after || before),
          fieldName,
          oldValue,
          newValue,
          route: req.originalUrl || req.path,
          requestIp: getRequestIp(req),
        };
      })
      .filter(Boolean);

    if (entries.length === 0) {
      await storage.createAuditLog({
        userId: req.session.userId || null,
        action,
        entityType,
        entityId,
        entityLabel: buildAuditEntityLabel(entityType, after || before),
        fieldName: null,
        oldValue: null,
        newValue: null,
        route: req.originalUrl || req.path,
        requestIp: getRequestIp(req),
      });
      return;
    }

    await Promise.all(entries.map((entry) => storage.createAuditLog(entry!)));
  } catch (error) {
    console.error("Audit log write error:", error);
  }
}

async function getRequestUser(req: Request) {
  if (!req.session.userId) return null;
  return storage.getUser(req.session.userId);
}

async function assertEditableFieldsAllowed<T extends Record<string, any>>(
  req: Request,
  actionId: EditableActionId,
  payload: T,
) {
  const user = await getRequestUser(req);
  if (!user) {
    const error = new Error("Não autenticado");
    (error as any).statusCode = 401;
    throw error;
  }

  if (user.role === "admin") {
    return payload;
  }

  const state = getFieldPermissionState(actionId, user.permissions);
  const allowedFields = new Set(state.mode === "all" ? getEditableFieldKeys(actionId) : state.fields);
  const submittedFields = Object.keys(payload).filter((key) => payload[key] !== undefined);
  const blockedFields = submittedFields.filter((field) => !allowedFields.has(field as any));

  if (state.mode === "none" || blockedFields.length > 0) {
    const error = new Error(
      blockedFields.length > 0
        ? `Você não tem permissão para editar os campos: ${blockedFields.join(", ")}`
        : "Você não tem permissão para editar campos deste cadastro.",
    );
    (error as any).statusCode = 403;
    throw error;
  }

  return payload;
}

const ADMINISTRACAO_INVOICE_CATEGORY = "ADMINISTRACAO";
const LANDLORD_NFSE_INVOICE_CATEGORY = "PROPRIETARIO_NFSE";
const LANDLORD_NFSE_ORIGIN_TYPE = "LANDLORD_NFSE";

function getInvoiceCategory(invoice: any) {
  return invoice?.invoiceCategory || ADMINISTRACAO_INVOICE_CATEGORY;
}

function isAdministracaoInvoice(invoice: any) {
  return getInvoiceCategory(invoice) === ADMINISTRACAO_INVOICE_CATEGORY;
}

function isLandlordNfseInvoice(invoice: any) {
  return getInvoiceCategory(invoice) === LANDLORD_NFSE_INVOICE_CATEGORY;
}

function normalizeSearchText(value: string | null | undefined) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function isCondominiumOrIptuService(description: string | null | undefined) {
  const normalized = normalizeSearchText(description);
  if (!normalized) return false;
  if (normalized.includes("seguro")) return false;
  return normalized.includes("iptu") || normalized.includes("condominio");
}

function buildLandlordNfseDescription(params: {
  receipt?: any;
  property?: any;
  contract?: any;
}) {
  const { receipt, property } = params;
  const month = receipt?.refMonth ? String(receipt.refMonth).padStart(2, "0") : "";
  const year = receipt?.refYear ? String(receipt.refYear) : "";
  const competence = month && year ? `${month}.${year}` : "";
  const addressParts = [
    property?.address,
    property?.neighborhood,
    property?.city && property?.state ? `${property.city} - ${property.state}` : property?.city || property?.state,
  ].filter(Boolean);
  const addressText = addressParts.join(", ");

  const subjectText = addressText
    ? `Recebimento de aluguel e encargos locatícios do imóvel situado à ${addressText}`
    : "Recebimento de aluguel e encargos locatícios do imóvel";
  const competenceText = competence ? `, referente à competência ${competence}` : "";

  return `${subjectText}${competenceText}, conforme contrato de locação.`;
}

type LandlordNfseTomadorAddress = {
  xLgr: string;
  nro: string;
  xBairro: string;
  xMun: string;
  UF: string;
  CEP: string;
  cMun: string;
};

const municipioIbgeByAddressCache = new Map<string, string>();

function normalizeZipCode(value: string | null | undefined) {
  return String(value || "").replace(/\D/g, "");
}

async function resolveMunicipioIbgeForAddress(params: {
  zipCode?: string | null;
  city?: string | null;
  state?: string | null;
}) {
  const zipCode = normalizeZipCode(params.zipCode);
  const city = String(params.city || "").trim();
  const state = String(params.state || "").trim().toUpperCase();
  const cacheKey = `${zipCode}|${city}|${state}`;

  if (municipioIbgeByAddressCache.has(cacheKey)) {
    return municipioIbgeByAddressCache.get(cacheKey) || null;
  }

  if (zipCode.length === 8) {
    try {
      const response = await fetch(`https://viacep.com.br/ws/${zipCode}/json/`);
      if (response.ok) {
        const data = await response.json();
        const ibge = String(data?.ibge || "").replace(/\D/g, "");
        if (ibge.length >= 6) {
          municipioIbgeByAddressCache.set(cacheKey, ibge);
          return ibge;
        }
      }
    } catch {}
  }

  if (city && state) {
    try {
      const response = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${encodeURIComponent(state)}/municipios`);
      if (response.ok) {
        const data = await response.json();
        const normalizedCity = normalizeSearchText(city);
        const match = Array.isArray(data)
          ? data.find((item: any) => normalizeSearchText(item?.nome) === normalizedCity)
          : null;
        const ibge = String(match?.id || "").replace(/\D/g, "");
        if (ibge.length >= 6) {
          municipioIbgeByAddressCache.set(cacheKey, ibge);
          return ibge;
        }
      }
    } catch {}
  }

  return null;
}

async function buildLandlordNfseTomadorPayloadByInvoiceId(invoiceId: string) {
  const invoice = await storage.getInvoice(invoiceId);
  if (!invoice) {
    throw new Error("Invoice da NFS-e do proprietário não encontrada.");
  }

  const receipt = invoice.receiptId ? await storage.getReceipt(invoice.receiptId) : undefined;
  const contract = receipt ? await storage.getContract(receipt.contractId) : undefined;
  const tenant = contract ? await storage.getTenant(contract.tenantId) : undefined;

  if (!tenant) {
    throw new Error("Locatário não encontrado para a NFS-e do proprietário.");
  }

  const municipioIbge = await resolveMunicipioIbgeForAddress({
    zipCode: tenant.zipCode,
    city: tenant.city,
    state: tenant.state,
  });

  const addressFields = {
    xLgr: String(tenant.address || "").trim(),
    nro: "S/N",
    xBairro: String(tenant.neighborhood || "").trim(),
    xMun: String(tenant.city || "").trim(),
    UF: String(tenant.state || "").trim().toUpperCase(),
    CEP: normalizeZipCode(tenant.zipCode),
    cMun: String(municipioIbge || "").trim(),
  };

  const missingAddressLabels = Object.entries(addressFields)
    .filter(([, value]) => !String(value || "").trim())
    .map(([key]) => {
      switch (key) {
        case "xLgr":
          return "logradouro";
        case "xBairro":
          return "bairro";
        case "xMun":
          return "cidade";
        case "UF":
          return "UF";
        case "CEP":
          return "CEP";
        case "cMun":
          return "código IBGE do município";
        default:
          return key;
      }
    });

  if (missingAddressLabels.length > 0) {
    throw new Error(`Cadastro do locatário incompleto para emissão com CBS/IBS: ${missingAddressLabels.join(", ")}.`);
  }

  const tomadorEndereco: LandlordNfseTomadorAddress = {
    ...addressFields,
    nro: String(addressFields.nro || "S/N"),
  };

  return {
    tomadorNome: tenant.name || "Locatário",
    tomadorCpfCnpj: tenant.doc || "",
    tomadorEmail: tenant.email || null,
    tomadorEnderecoJson: JSON.stringify(tomadorEndereco),
  };
}

async function buildLandlordNfsePropertyPayloadByInvoiceId(invoiceId: string) {
  const invoice = await storage.getInvoice(invoiceId);
  if (!invoice) {
    throw new Error("Invoice da NFS-e do proprietário não encontrada.");
  }

  const receipt = invoice.receiptId ? await storage.getReceipt(invoice.receiptId) : undefined;
  const contract = receipt ? await storage.getContract(receipt.contractId) : undefined;
  const property = contract ? await storage.getProperty(contract.propertyId) : undefined;

  if (!property) {
    throw new Error("Imóvel não encontrado para a NFS-e do proprietário.");
  }

  const municipioIbge = await resolveMunicipioIbgeForAddress({
    zipCode: property.zipCode,
    city: property.city,
    state: property.state,
  });

  const addressRaw = String(property.address || "").trim();
  const numberMatch = addressRaw.match(/,\s*(\d[\w\-\/]*)\b/) || addressRaw.match(/\s(\d{1,5}[\w\-\/]*)(?:\s|$)/);
  const nro = numberMatch ? numberMatch[1] : "S/N";

  const addressFields = {
    xLgr: addressRaw,
    nro,
    xBairro: String(property.neighborhood || "").trim(),
    xMun: String(property.city || "").trim(),
    UF: String(property.state || "").trim().toUpperCase(),
    CEP: normalizeZipCode(property.zipCode),
    cMun: String(municipioIbge || "").trim(),
  };

  const missingAddressLabels = Object.entries(addressFields)
    .filter(([, value]) => !String(value || "").trim())
    .map(([key]) => {
      switch (key) {
        case "xLgr":
          return "logradouro do imóvel";
        case "xBairro":
          return "bairro do imóvel";
        case "xMun":
          return "cidade do imóvel";
        case "UF":
          return "UF do imóvel";
        case "CEP":
          return "CEP do imóvel";
        case "cMun":
          return "código IBGE do município do imóvel";
        default:
          return key;
      }
    });

  if (missingAddressLabels.length > 0) {
    throw new Error(`Cadastro do imóvel incompleto para emissão com CBS/IBS: ${missingAddressLabels.join(", ")}.`);
  }

  const imovelEndereco = {
    ...addressFields,
    nro: String(addressFields.nro || "S/N"),
  };

  return {
    imovelEnderecoJson: JSON.stringify(imovelEndereco),
  };
}

function validateLandlordNfseProfile(landlord: any) {
  if (!landlord?.nfseEnabled) return null;

  const requiredFields: Array<[string, string]> = [
    ["nfseCertificatePassword", "senha do certificado"],
    ["nfseCertificatePfxBase64", "certificado digital"],
  ];

  const missing = requiredFields
    .filter(([field]) => !String(landlord?.[field] ?? "").trim())
    .map(([, label]) => label);

  if (missing.length > 0) {
    return `Cadastro fiscal do proprietário incompleto: ${missing.join(", ")}.`;
  }

  return null;
}

async function seedAdminUser() {
  const existingAdmin = await storage.getUserByEmail("admin@admin.com");
  if (!existingAdmin) {
    const passwordHash = await bcrypt.hash("Admin@123", 10);
    await storage.createUser({
      name: "Administrador",
      email: "admin@admin.com",
      passwordHash,
      role: "admin",
    });
    console.log("Admin user created: admin@admin.com / Admin@123");
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.use(
    session({
      secret: process.env.SESSION_SECRET || "imobiliaria-simples-secret-key",
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: false,
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000,
      },
    })
  );

  await seedAdminUser();

  app.post("/webhook/sicoob", async (req, res) => {
    const body = req.body;

    const nossoNumero =
      body?.nossoNumero ??
      body?.nosso_numero ??
      body?.seuNumero ??
      body?.seu_numero ??
      body?.titulo?.nossoNumero ??
      body?.titulo?.seuNumero ??
      null;

    const tipoEvento =
      body?.tipoEvento ??
      body?.tipo_evento ??
      body?.evento ??
      body?.event ??
      body?.tipo ??
      null;

    const valorPago =
      body?.valorPago ??
      body?.valor_pago ??
      body?.valor ??
      body?.amount ??
      body?.pagamento?.valorPago ??
      body?.pagamento?.valor ??
      null;

    const dataPagamento =
      body?.dataPagamento ??
      body?.data_pagamento ??
      body?.pagamento?.dataPagamento ??
      body?.pagamento?.data ??
      body?.paymentDate ??
      body?.paidAt ??
      null;

    try {
      const logPath = path.join(process.cwd(), "webhook_sicoob.log");
      const line =
        JSON.stringify({
          receivedAt: new Date().toISOString(),
          nossoNumero,
          tipoEvento,
          valorPago,
          dataPagamento,
          body,
        }) + "\n";
      fs.appendFileSync(logPath, line, { encoding: "utf8" });
    } catch (e) {
      console.error("Webhook Sicoob log error:", e);
    }

    res.status(200).json({ ok: true });
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const data = loginSchema.parse(req.body);
      const user = await storage.getUserByEmail(data.email);
      if (!user) {
        return res.status(401).json({ error: "Email ou senha inválidos" });
      }
      const validPassword = await bcrypt.compare(data.password, user.passwordHash);
      if (!validPassword) {
        return res.status(401).json({ error: "Email ou senha inválidos" });
      }

      // Check for 2FA
      if (user.isTwoFactorEnabled) {
        req.session.temp2faUserId = user.id;
        return res.json({ requireTwoFactor: true });
      }

      req.session.userId = user.id;
      res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, permissions: user.permissions, isTwoFactorEnabled: user.isTwoFactorEnabled } });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Dados inválidos" });
      }
      console.error("Login error:", error);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.json({ success: true });
    });
  });

  // 2FA Routes
  app.post("/api/auth/2fa/setup", requireAuth, async (req, res) => {
    try {
      const secret = speakeasy.generateSecret({ name: "Imobiliaria Simples" });
      const url = await QRCode.toDataURL(secret.otpauth_url!);
      
      // Save secret temporarily (not enabled yet)
      await storage.updateUser(req.session.userId!, {
        twoFactorSecret: secret.base32
      });

      res.json({ secret: secret.base32, qrCode: url });
    } catch (error) {
      console.error("2FA Setup error:", error);
      res.status(500).json({ error: "Erro ao configurar 2FA" });
    }
  });

  app.post("/api/auth/2fa/verify", requireAuth, async (req, res) => {
    try {
      const { token } = req.body;
      const user = await storage.getUser(req.session.userId!);
      
      if (!user || !user.twoFactorSecret) {
        return res.status(400).json({ error: "Configuração de 2FA não iniciada" });
      }

      const verified = speakeasy.totp.verify({
        secret: user.twoFactorSecret,
        encoding: "base32",
        token: token
      });

      if (verified) {
        await storage.updateUser(user.id, { isTwoFactorEnabled: true });
        res.json({ success: true });
      } else {
        res.status(400).json({ error: "Código inválido" });
      }
    } catch (error) {
      console.error("2FA Verify error:", error);
      res.status(500).json({ error: "Erro ao verificar 2FA" });
    }
  });

  app.post("/api/auth/2fa/disable", requireAuth, async (req, res) => {
    try {
      await storage.updateUser(req.session.userId!, {
        isTwoFactorEnabled: false,
        twoFactorSecret: null
      });
      res.json({ success: true });
    } catch (error) {
      console.error("2FA Disable error:", error);
      res.status(500).json({ error: "Erro ao desativar 2FA" });
    }
  });

  app.post("/api/auth/2fa/login", async (req, res) => {
    try {
      const { token } = req.body;
      const userId = req.session.temp2faUserId;

      if (!userId) {
        return res.status(401).json({ error: "Sessão de login expirada ou inválida" });
      }

      const user = await storage.getUser(userId);
      if (!user || !user.twoFactorSecret) {
        return res.status(400).json({ error: "Usuário inválido" });
      }

      const verified = speakeasy.totp.verify({
        secret: user.twoFactorSecret,
        encoding: "base32",
        token: token
      });

      if (verified) {
        req.session.userId = userId;
        delete req.session.temp2faUserId;
        res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, permissions: user.permissions, isTwoFactorEnabled: user.isTwoFactorEnabled } });
      } else {
        res.status(400).json({ error: "Código inválido" });
      }
    } catch (error) {
      console.error("2FA Login error:", error);
      res.status(500).json({ error: "Erro ao validar 2FA" });
    }
  });

  app.get("/api/auth/me", async (req, res) => {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Não autenticado" });
    }
    const user = await storage.getUser(req.session.userId);
    if (!user) {
      return res.status(401).json({ error: "Usuário não encontrado" });
    }
    res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, permissions: user.permissions, isTwoFactorEnabled: user.isTwoFactorEnabled } });
  });

  app.get("/api/system-logs", requirePermission("menu_logs"), async (_req, res) => {
    try {
      const logs = await storage.getSystemLogs(200);
      res.json(logs);
    } catch (error) {
      res.status(500).json({ error: "Erro ao buscar logs do sistema" });
    }
  });

  app.delete("/api/system-logs", requirePermission("menu_logs"), async (_req, res) => {
    try {
      await storage.clearSystemLogs();
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Erro ao limpar logs do sistema" });
    }
  });

  app.get("/api/audit-logs", requirePermission("menu_audit"), async (req, res) => {
    try {
      const limit = Number.parseInt(String(req.query.limit || "300"), 10);
      const logs = await storage.getAuditLogs({
        limit: Number.isFinite(limit) ? limit : 300,
        startDate: typeof req.query.startDate === "string" ? req.query.startDate : undefined,
        endDate: typeof req.query.endDate === "string" ? req.query.endDate : undefined,
        entityType: typeof req.query.entityType === "string" && req.query.entityType !== "ALL" ? req.query.entityType : undefined,
        action: typeof req.query.action === "string" && req.query.action !== "ALL" ? req.query.action : undefined,
        userId: typeof req.query.userId === "string" && req.query.userId !== "ALL" ? req.query.userId : undefined,
        search: typeof req.query.search === "string" ? req.query.search : undefined,
      });
      res.json(logs);
    } catch (error) {
      console.error("Get audit logs error:", error);
      res.status(500).json({ error: "Erro ao buscar auditoria" });
    }
  });

  // User Management Routes
  app.get("/api/users", requireAuth, async (req, res) => {
    try {
      const users = await storage.getUsers();
      res.json(users);
    } catch (error) {
      console.error("Get users error:", error);
      res.status(500).json({ error: "Erro ao buscar usuários" });
    }
  });

  app.post("/api/users", requireAuth, async (req, res) => {
    try {
      const data = req.body;
      const existingUser = await storage.getUserByEmail(data.email);
      if (existingUser) {
        return res.status(400).json({ error: "Email já cadastrado" });
      }

      const passwordHash = await bcrypt.hash(data.password, 10);
      // Remove password from data before creating
      const { password, ...userData } = data;
      
      const user = await storage.createUser({
        ...userData,
        passwordHash,
        permissions: data.permissions || [],
        role: data.role || "user",
        isTwoFactorEnabled: false
      });
      await writeAuditEntries({
        req,
        action: "CREATE",
        entityType: "USUARIO",
        entityId: user.id,
        after: user,
      });
      res.status(201).json(user);
    } catch (error) {
      console.error("Create user error:", error);
      res.status(500).json({ error: "Erro ao criar usuário" });
    }
  });

  app.patch("/api/users/:id", requireAuth, async (req, res) => {
    try {
      const userId = getSingleParam(req.params.id);
      const existingUser = await storage.getUser(userId);
      if (!existingUser) return res.status(404).json({ error: "Usuário não encontrado" });

      const { password, ...updateData } = req.body;
      
      if (password) {
        updateData.passwordHash = await bcrypt.hash(password, 10);
      }

      const user = await storage.updateUser(userId, updateData);
      if (!user) return res.status(404).json({ error: "Usuário não encontrado" });
      await writeAuditEntries({
        req,
        action: "UPDATE",
        entityType: "USUARIO",
        entityId: user.id,
        before: existingUser,
        after: user,
      });
      res.json(user);
    } catch (error) {
      console.error("Update user error:", error);
      res.status(500).json({ error: "Erro ao atualizar usuário" });
    }
  });

  app.post("/api/users/:id/reset-2fa", requireAuth, async (req, res) => {
    try {
      const requestUser = await getRequestUser(req);
      if (!requestUser) {
        return res.status(401).json({ error: "Não autenticado" });
      }

      if (requestUser.role !== "admin") {
        return res.status(403).json({ error: "Apenas administradores podem resetar o MFA de usuários." });
      }

      const userId = getSingleParam(req.params.id);
      const existingUser = await storage.getUser(userId);
      if (!existingUser) return res.status(404).json({ error: "Usuário não encontrado" });

      const user = await storage.updateUser(userId, {
        isTwoFactorEnabled: false,
        twoFactorSecret: null,
      });

      if (!user) return res.status(404).json({ error: "Usuário não encontrado" });

      await writeAuditEntries({
        req,
        action: "UPDATE",
        entityType: "USUARIO",
        entityId: user.id,
        before: existingUser,
        after: user,
      });

      res.json({
        success: true,
        message: "MFA resetado com sucesso. O usuário poderá configurar um novo código no perfil.",
      });
    } catch (error) {
      console.error("Reset user 2FA error:", error);
      res.status(500).json({ error: "Erro ao resetar MFA do usuário" });
    }
  });

  app.delete("/api/users/:id", requireAuth, async (req, res) => {
    try {
      const userIdToDelete = getSingleParam(req.params.id);
      if (userIdToDelete === req.session.userId) {
        return res.status(400).json({ error: "Não é possível excluir o próprio usuário logado" });
      }
      const existingUser = await storage.getUser(userIdToDelete);
      await storage.deleteUser(userIdToDelete);
      if (existingUser) {
        await writeAuditEntries({
          req,
          action: "DELETE",
          entityType: "USUARIO",
          entityId: existingUser.id,
          before: existingUser,
        });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Delete user error:", error);
      res.status(500).json({ error: "Erro ao excluir usuário" });
    }
  });

  app.get("/api/dashboard/stats", requireAuth, async (req, res) => {
    try {
      const [contracts, properties, landlords, tenants, receipts, transfers, cashTransactions] = await Promise.all([
        storage.getContracts(),
        storage.getProperties(),
        storage.getLandlords(),
        storage.getTenants(),
        storage.getReceipts(),
        storage.getLandlordTransfers(),
        storage.getCashTransactions(),
      ]);

      const activeContracts = contracts.filter((c) => c.status === "active");
      const currentMonth = new Date().getMonth() + 1;
      const currentYear = new Date().getFullYear();
      
      const startDate = `${currentYear}-${String(currentMonth).padStart(2, "0")}-01`;
      const lastDay = new Date(currentYear, currentMonth, 0).getDate();
      const endDate = `${currentYear}-${String(currentMonth).padStart(2, "0")}-${lastDay}`;

      const openReceipts = receipts.filter((r) => r.refYear === currentYear && r.refMonth === currentMonth && r.status === "draft");
      
      // Calculate paid receipts based on payment date (Cash Transactions)
      const paidReceiptIds = new Set(
        cashTransactions
          .filter(t => t.type === "IN" && t.date >= startDate && t.date <= endDate && t.receiptId)
          .map(t => t.receiptId)
      );
      const paidReceiptsCount = paidReceiptIds.size;

      const pendingPayments = receipts.filter((r) => r.status === "closed");
      const pendingTransfers = transfers.filter((t) => t.status === "pending");
      const monthlyRevenue = pendingPayments.reduce((sum, r) => sum + Number(r.tenantTotalDue), 0);

      res.json({
        activeContracts: activeContracts.length,
        totalProperties: properties.length,
        totalLandlords: landlords.length,
        totalTenants: tenants.length,
        openReceipts: openReceipts.length,
        paidReceipts: paidReceiptsCount,
        pendingPayments: pendingPayments.length,
        pendingTransfers: pendingTransfers.length,
        monthlyRevenue: monthlyRevenue.toLocaleString("pt-BR", { minimumFractionDigits: 2 }),
      });
    } catch (error) {
      console.error("Dashboard stats error:", error);
      res.status(500).json({ error: "Erro ao buscar estatísticas" });
    }
  });

  app.get("/api/landlords", requirePermission("menu_landlords"), async (req, res) => {
    try {
      const landlords = await storage.getLandlords();
      res.json(landlords.map(sanitizeLandlordForResponse));
    } catch (error) {
      console.error("Get landlords error:", error);
      res.status(500).json({ error: "Erro ao buscar proprietários" });
    }
  });

  app.get("/api/landlords/next-code", requirePermission("menu_landlords"), async (req, res) => {
    try {
      const code = await storage.getNextLandlordCode();
      res.json({ code });
    } catch (error) {
      console.error("Get next landlord code error:", error);
      res.status(500).json({ error: "Erro ao gerar próximo código de proprietário" });
    }
  });

  app.post("/api/landlords", requirePermission("menu_landlords"), async (req, res) => {
    try {
      const data = normalizeInputData({ ...req.body });
      if (!data.code) {
        const landlords = await storage.getLandlords();
        let maxCode = 0;
        for (const l of landlords) {
          if (l.code && !isNaN(parseInt(l.code))) {
            const c = parseInt(l.code);
            if (c > maxCode) maxCode = c;
          }
        }
        data.code = (maxCode + 1).toString();
      }

      if (!data.name) {
        return res.status(400).json({ error: "O campo Nome é obrigatório." });
      }
      if (!data.doc) {
        return res.status(400).json({ error: "O campo CPF é obrigatório." });
      }

      if (data.nfseCertificatePfxBase64) {
        data.nfseCertificateUpdatedAt = new Date();
      }

      const landlord = await storage.createLandlord(data);
      await writeAuditEntries({
        req,
        action: "CREATE",
        entityType: "PROPRIETARIO",
        entityId: landlord.id,
        after: landlord,
      });
      res.status(201).json(sanitizeLandlordForResponse(landlord));
    } catch (error: any) {
      console.error("Create landlord error:", error);
      if (error?.code === "23505") {
        return res.status(400).json({ error: "Já existe um proprietário com este código." });
      }
      res.status(500).json({ error: "Erro ao criar proprietário." });
    }
  });

  app.patch("/api/landlords/:id", requirePermission("edit_landlord"), async (req, res) => {
    try {
      const landlordId = getSingleParam(req.params.id);
      const currentLandlord = await storage.getLandlord(landlordId);
      if (!currentLandlord) return res.status(404).json({ error: "Proprietário não encontrado" });

      const data = normalizeInputData(req.body);
      await assertEditableFieldsAllowed(req, "edit_landlord", data);

      if (data.nfseCertificatePfxBase64) {
        data.nfseCertificateUpdatedAt = new Date();
      }

      const landlord = await storage.updateLandlord(landlordId, data);
      if (!landlord) return res.status(404).json({ error: "Proprietário não encontrado" });
      await writeAuditEntries({
        req,
        action: "UPDATE",
        entityType: "PROPRIETARIO",
        entityId: landlord.id,
        before: currentLandlord,
        after: landlord,
      });
      res.json(sanitizeLandlordForResponse(landlord));
    } catch (error: any) {
      if (error?.statusCode) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      console.error("Update landlord error:", error);
      res.status(500).json({ error: "Erro ao atualizar proprietário" });
    }
  });

  app.delete("/api/landlords/:id", requirePermission("menu_landlords"), async (req, res) => {
    try {
      const landlordId = getSingleParam(req.params.id);
      const currentLandlord = await storage.getLandlord(landlordId);
      await storage.deleteLandlord(landlordId);
      if (currentLandlord) {
        await writeAuditEntries({
          req,
          action: "DELETE",
          entityType: "PROPRIETARIO",
          entityId: currentLandlord.id,
          before: currentLandlord,
        });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Delete landlord error:", error);
      res.status(500).json({ error: "Erro ao excluir proprietário" });
    }
  });

  app.get("/api/tenants", requirePermission("menu_tenants"), async (req, res) => {
    try {
      const tenants = await storage.getTenants();
      res.json(tenants);
    } catch (error) {
      console.error("Get tenants error:", error);
      res.status(500).json({ error: "Erro ao buscar locatários" });
    }
  });

  app.get("/api/tenants/next-code", requirePermission("menu_tenants"), async (req, res) => {
    try {
      const code = await storage.getNextTenantCode();
      res.json({ code });
    } catch (error) {
      console.error("Get next tenant code error:", error);
      res.status(500).json({ error: "Erro ao gerar próximo código de locatário" });
    }
  });

  app.post("/api/tenants", requirePermission("menu_tenants"), async (req, res) => {
    try {
      const data = normalizeInputData({ ...req.body });
      if (!data.code) {
        const tenants = await storage.getTenants();
        let maxCode = 0;
        for (const t of tenants) {
          if (t.code && !isNaN(parseInt(t.code))) {
            const c = parseInt(t.code);
            if (c > maxCode) maxCode = c;
          }
        }
        data.code = (maxCode + 1).toString();
      }

      if (!data.name) {
        return res.status(400).json({ error: "O campo Nome é obrigatório." });
      }
      if (!data.doc) {
        return res.status(400).json({ error: "O campo CPF é obrigatório." });
      }

      const tenant = await storage.createTenant(data);
      await writeAuditEntries({
        req,
        action: "CREATE",
        entityType: "LOCATARIO",
        entityId: tenant.id,
        after: tenant,
      });
      res.status(201).json(tenant);
    } catch (error: any) {
      console.error("Create tenant error:", error);
      if (error?.code === "23505") {
        return res.status(400).json({ error: "Já existe um locatário com este código." });
      }
      res.status(500).json({ error: "Erro ao criar locatário." });
    }
  });

  app.patch("/api/tenants/:id", requirePermission("edit_tenant"), async (req, res) => {
    try {
      const tenantId = getSingleParam(req.params.id);
      const currentTenant = await storage.getTenant(tenantId);
      if (!currentTenant) return res.status(404).json({ error: "Locatário não encontrado" });

      const data = normalizeInputData(req.body);
      await assertEditableFieldsAllowed(req, "edit_tenant", data);
      const tenant = await storage.updateTenant(tenantId, data);
      if (!tenant) return res.status(404).json({ error: "Locatário não encontrado" });
      await writeAuditEntries({
        req,
        action: "UPDATE",
        entityType: "LOCATARIO",
        entityId: tenant.id,
        before: currentTenant,
        after: tenant,
      });
      res.json(tenant);
    } catch (error: any) {
      if (error?.statusCode) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      console.error("Update tenant error:", error);
      res.status(500).json({ error: "Erro ao atualizar locatário" });
    }
  });

  app.delete("/api/tenants/:id", requirePermission("menu_tenants"), async (req, res) => {
    try {
      const tenantId = getSingleParam(req.params.id);
      const currentTenant = await storage.getTenant(tenantId);
      await storage.deleteTenant(tenantId);
      if (currentTenant) {
        await writeAuditEntries({
          req,
          action: "DELETE",
          entityType: "LOCATARIO",
          entityId: currentTenant.id,
          before: currentTenant,
        });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Delete tenant error:", error);
      res.status(500).json({ error: "Erro ao excluir locatário" });
    }
  });

  app.get("/api/guarantors", requirePermission("menu_guarantors"), async (req, res) => {
    try {
      const guarantors = await storage.getGuarantors();
      res.json(guarantors);
    } catch (error) {
      console.error("Get guarantors error:", error);
      res.status(500).json({ error: "Erro ao buscar fiadores" });
    }
  });

  app.get("/api/guarantors/next-code", requirePermission("menu_guarantors"), async (req, res) => {
    try {
      const code = await storage.getNextGuarantorCode();
      res.json({ code });
    } catch (error) {
      console.error("Get next guarantor code error:", error);
      res.status(500).json({ error: "Erro ao gerar próximo código de fiador" });
    }
  });

  app.post("/api/guarantors", requirePermission("menu_guarantors"), async (req, res) => {
    try {
      const data = normalizeInputData(req.body);

      if (!data.name) {
        return res.status(400).json({ error: "O campo Nome é obrigatório." });
      }
      if (!data.doc) {
        return res.status(400).json({ error: "O campo CPF é obrigatório." });
      }

      const guarantor = await storage.createGuarantor(data);
      await writeAuditEntries({
        req,
        action: "CREATE",
        entityType: "FIADOR",
        entityId: guarantor.id,
        after: guarantor,
      });
      res.status(201).json(guarantor);
    } catch (error: any) {
      console.error("Create guarantor error:", error);
      if (error?.code === "23505") {
        return res.status(400).json({ error: "Já existe um fiador com este código." });
      }
      res.status(500).json({ error: "Erro ao criar fiador." });
    }
  });

  app.patch("/api/guarantors/:id", requirePermission("edit_guarantor"), async (req, res) => {
    try {
      const guarantorId = getSingleParam(req.params.id);
      const currentGuarantor = await storage.getGuarantor(guarantorId);
      if (!currentGuarantor) return res.status(404).json({ error: "Fiador não encontrado" });

      const data = normalizeInputData(req.body);
      await assertEditableFieldsAllowed(req, "edit_guarantor", data);
      const guarantor = await storage.updateGuarantor(guarantorId, data);
      if (!guarantor) return res.status(404).json({ error: "Fiador não encontrado" });
      await writeAuditEntries({
        req,
        action: "UPDATE",
        entityType: "FIADOR",
        entityId: guarantor.id,
        before: currentGuarantor,
        after: guarantor,
      });
      res.json(guarantor);
    } catch (error: any) {
      if (error?.statusCode) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      console.error("Update guarantor error:", error);
      res.status(500).json({ error: "Erro ao atualizar fiador" });
    }
  });

  app.delete("/api/guarantors/:id", requirePermission("menu_guarantors"), async (req, res) => {
    try {
      const guarantorId = getSingleParam(req.params.id);
      const currentGuarantor = await storage.getGuarantor(guarantorId);
      await storage.deleteGuarantor(guarantorId);
      if (currentGuarantor) {
        await writeAuditEntries({
          req,
          action: "DELETE",
          entityType: "FIADOR",
          entityId: currentGuarantor.id,
          before: currentGuarantor,
        });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Delete guarantor error:", error);
      res.status(500).json({ error: "Erro ao excluir fiador" });
    }
  });

  app.get("/api/providers", requirePermission("menu_providers"), async (req, res) => {
    try {
      const providers = await storage.getServiceProviders();
      res.json(providers);
    } catch (error) {
      console.error("Get providers error:", error);
      res.status(500).json({ error: "Erro ao buscar prestadores" });
    }
  });

  app.post("/api/providers", requirePermission("menu_providers"), async (req, res) => {
    try {
      const provider = await storage.createServiceProvider(normalizeInputData(req.body));
      await writeAuditEntries({
        req,
        action: "CREATE",
        entityType: "PRESTADOR",
        entityId: provider.id,
        after: provider,
      });
      res.status(201).json(provider);
    } catch (error) {
      console.error("Create provider error:", error);
      res.status(500).json({ error: "Erro ao criar prestador" });
    }
  });

  app.patch("/api/providers/:id", requirePermission("edit_provider"), async (req, res) => {
    try {
      const providerId = getSingleParam(req.params.id);
      const currentProvider = await storage.getServiceProvider(providerId);
      if (!currentProvider) return res.status(404).json({ error: "Prestador não encontrado" });

      const data = normalizeInputData(req.body);
      await assertEditableFieldsAllowed(req, "edit_provider", data);
      const provider = await storage.updateServiceProvider(providerId, data);
      if (!provider) return res.status(404).json({ error: "Prestador não encontrado" });
      await writeAuditEntries({
        req,
        action: "UPDATE",
        entityType: "PRESTADOR",
        entityId: provider.id,
        before: currentProvider,
        after: provider,
      });
      res.json(provider);
    } catch (error: any) {
      if (error?.statusCode) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      console.error("Update provider error:", error);
      res.status(500).json({ error: "Erro ao atualizar prestador" });
    }
  });

  app.delete("/api/providers/:id", requirePermission("menu_providers"), async (req, res) => {
    try {
      const providerId = getSingleParam(req.params.id);
      const currentProvider = await storage.getServiceProvider(providerId);
      await storage.deleteServiceProvider(providerId);
      if (currentProvider) {
        await writeAuditEntries({
          req,
          action: "DELETE",
          entityType: "PRESTADOR",
          entityId: currentProvider.id,
          before: currentProvider,
        });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Delete provider error:", error);
      res.status(500).json({ error: "Erro ao excluir prestador" });
    }
  });

  app.get("/api/properties", requireAuth, async (req, res) => {
    try {
      const properties = await storage.getProperties();
      res.json(properties);
    } catch (error) {
      console.error("Get properties error:", error);
      res.status(500).json({ error: "Erro ao buscar imóveis" });
    }
  });

  app.get("/api/properties/next-code", requireAuth, async (req, res) => {
    try {
      const code = await storage.getNextPropertyCode();
      res.json({ code });
    } catch (error) {
      console.error("Get next property code error:", error);
      res.status(500).json({ error: "Erro ao gerar próximo código de imóvel" });
    }
  });

  app.post("/api/properties", requireAuth, async (req, res) => {
    try {
      const data = normalizeInputData(req.body);

      if (Array.isArray((data as any).landlordShares) && (data as any).landlordShares.length > 0) {
        const firstLandlordId = (data as any).landlordShares[0]?.landlordId;
        (data as any).landlordId = firstLandlordId || null;
      } else if ((data as any).landlordShares) {
        (data as any).landlordId = null;
      }

      if (!data.code) {
        return res.status(400).json({ error: "O campo Código é obrigatório." });
      }
      if (!data.title) {
        return res.status(400).json({ error: "O campo Título é obrigatório." });
      }
      if (!data.address) {
        return res.status(400).json({ error: "O campo Endereço é obrigatório." });
      }
      if (!data.city) {
        return res.status(400).json({ error: "O campo Cidade é obrigatório." });
      }
      if (!data.state) {
        return res.status(400).json({ error: "O campo Estado é obrigatório." });
      }
      if (data.rentDefault === undefined || data.rentDefault === null || data.rentDefault === "") {
        return res.status(400).json({ error: "O campo Aluguel Padrão é obrigatório." });
      }

      const property = await storage.createProperty(data);
      await writeAuditEntries({
        req,
        action: "CREATE",
        entityType: "IMOVEL",
        entityId: property.id,
        after: property,
      });
      res.status(201).json(property);
    } catch (error: any) {
      console.error("Create property error:", error);
      if (error?.code === "23505") {
        return res.status(400).json({ error: "Já existe um imóvel com este código." });
      }
      res.status(500).json({ error: "Erro ao criar imóvel." });
    }
  });

  app.patch("/api/properties/:id", requirePermission("edit_property"), async (req, res) => {
    try {
      const propertyId = getSingleParam(req.params.id);
      const currentProperty = await storage.getProperty(propertyId);
      if (!currentProperty) return res.status(404).json({ error: "Imóvel não encontrado" });

      const data = normalizeInputData(req.body);
      await assertEditableFieldsAllowed(req, "edit_property", data);

      if (Array.isArray((data as any).landlordShares)) {
        if ((data as any).landlordShares.length > 0) {
          const firstLandlordId = (data as any).landlordShares[0]?.landlordId;
          (data as any).landlordId = firstLandlordId || null;
        } else {
          (data as any).landlordId = null;
        }
      }

      const property = await storage.updateProperty(propertyId, data);
      if (!property) return res.status(404).json({ error: "Imóvel não encontrado" });
      await writeAuditEntries({
        req,
        action: "UPDATE",
        entityType: "IMOVEL",
        entityId: property.id,
        before: currentProperty,
        after: property,
      });
      res.json(property);
    } catch (error: any) {
      if (error?.statusCode) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      console.error("Update property error:", error);
      res.status(500).json({ error: "Erro ao atualizar imóvel" });
    }
  });

  app.delete("/api/properties/:id", requireAuth, async (req, res) => {
    try {
      const propertyId = getSingleParam(req.params.id);
      const currentProperty = await storage.getProperty(propertyId);
      await storage.deleteProperty(propertyId);
      if (currentProperty) {
        await writeAuditEntries({
          req,
          action: "DELETE",
          entityType: "IMOVEL",
          entityId: currentProperty.id,
          before: currentProperty,
        });
      }
      res.json({ success: true });
    } catch (error: any) {
      if (error.code === '23503') {
        return res.status(400).json({ 
          error: "Não é possível excluir este imóvel pois existem registros vinculados a ele (contratos, etc)." 
        });
      }
      console.error("Delete property error:", error);
      console.error("Error code:", error.code); // Debug log
      res.status(500).json({ error: "Erro ao excluir imóvel" });
    }
  });

  app.get("/api/contracts", requireAuth, async (req, res) => {
    try {
      const contracts = await storage.getContracts();
      res.json(contracts);
    } catch (error) {
      console.error("Get contracts error:", error);
      res.status(500).json({ error: "Erro ao buscar contratos" });
    }
  });

  app.get("/api/contracts/:id", requireAuth, async (req, res) => {
    try {
      const contract = await storage.getContract(getSingleParam(req.params.id));
      if (!contract) return res.status(404).json({ error: "Contrato não encontrado" });
      res.json(contract);
    } catch (error) {
      console.error("Get contract error:", error);
      res.status(500).json({ error: "Erro ao buscar contrato" });
    }
  });

  app.post("/api/contracts", requireAuth, async (req, res) => {
    try {
      const contract = await storage.createContract(req.body);
      await writeAuditEntries({
        req,
        action: "CREATE",
        entityType: "CONTRATO",
        entityId: contract.id,
        after: contract,
      });
      res.status(201).json(contract);
    } catch (error) {
      console.error("Create contract error:", error);
      res.status(500).json({ error: "Erro ao criar contrato" });
    }
  });

  app.patch("/api/contracts/:id", requirePermission("edit_contract"), async (req, res) => {
    try {
      const contractId = getSingleParam(req.params.id);
      const currentContract = await storage.getContract(contractId);
      if (!currentContract) return res.status(404).json({ error: "Contrato não encontrado" });

      await assertEditableFieldsAllowed(req, "edit_contract", req.body);
      const contract = await storage.updateContract(contractId, req.body);
      if (!contract) return res.status(404).json({ error: "Contrato não encontrado" });
      await writeAuditEntries({
        req,
        action: "UPDATE",
        entityType: "CONTRATO",
        entityId: contract.id,
        before: currentContract,
        after: contract,
      });
      res.json(contract);
    } catch (error: any) {
      if (error?.statusCode) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      console.error("Update contract error:", error);
      res.status(500).json({ error: "Erro ao atualizar contrato" });
    }
  });

  app.delete("/api/contracts/:id", requireAuth, async (req, res) => {
    try {
      const contractId = getSingleParam(req.params.id);
      const currentContract = await storage.getContract(contractId);
      await storage.deleteContract(contractId);
      if (currentContract) {
        await writeAuditEntries({
          req,
          action: "DELETE",
          entityType: "CONTRATO",
          entityId: currentContract.id,
          before: currentContract,
        });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Delete contract error:", error);
      res.status(500).json({ error: "Erro ao excluir contrato" });
    }
  });

  app.delete("/api/contracts/:id/draft-receipts", requirePermission("delete_receipt"), async (req, res) => {
    try {
      const { password, totpToken } = req.body || {};
      await assertSensitiveActionCredentials(req, { password, totpToken });
      const deletedReceipts = await storage.deleteDraftReceiptsByContractId(getSingleParam(req.params.id));
      await Promise.all(
        deletedReceipts.map((receipt) =>
          writeAuditEntries({
            req,
            action: "DELETE",
            entityType: "RECIBO",
            entityId: receipt.id,
            before: receipt,
          })
        )
      );
      res.json({ success: true, deleted: deletedReceipts.length });
    } catch (error: any) {
      if (error?.statusCode) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      console.error("Delete draft receipts error:", error);
      res.status(500).json({ error: "Erro ao excluir recibos em rascunho" });
    }
  });

  app.delete("/api/receipts/drafts", requirePermission("delete_receipt"), async (req, res) => {
    try {
      const { year, month, password, totpToken } = req.body || {};
      if (!year || !month) {
        return res.status(400).json({ error: "Ano e mês são obrigatórios" });
      }
      await assertSensitiveActionCredentials(req, { password, totpToken });
      const deletedReceipts = await storage.deleteDraftReceiptsByRef(year, month);
      await Promise.all(
        deletedReceipts.map((receipt) =>
          writeAuditEntries({
            req,
            action: "DELETE",
            entityType: "RECIBO",
            entityId: receipt.id,
            before: receipt,
          })
        )
      );
      res.json({ success: true, deleted: deletedReceipts.length });
    } catch (error) {
      console.error("Delete draft receipts by ref error:", error);
      res.status(500).json({ error: "Erro ao excluir recibos em rascunho do mês" });
    }
  });

  // Recurring Items Routes
  app.get("/api/contracts/:id/recurring-items", requireAuth, async (req, res) => {
    try {
      const items = await storage.getContractRecurringItems(getSingleParam(req.params.id));
      res.json(items);
    } catch (error) {
      console.error("Get recurring items error:", error);
      res.status(500).json({ error: "Erro ao buscar itens recorrentes" });
    }
  });

  app.post("/api/contracts/:id/recurring-items", requireAuth, async (req, res) => {
    try {
      const item = await storage.createContractRecurringItem({
        ...req.body,
        contractId: getSingleParam(req.params.id)
      });
      res.status(201).json(item);
    } catch (error) {
      console.error("Create recurring item error:", error);
      res.status(500).json({ error: "Erro ao criar item recorrente" });
    }
  });

  app.delete("/api/recurring-items/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteContractRecurringItem(getSingleParam(req.params.id));
      res.json({ success: true });
    } catch (error) {
      console.error("Delete recurring item error:", error);
      res.status(500).json({ error: "Erro ao excluir item recorrente" });
    }
  });

  app.get("/api/services", requireAuth, async (req, res) => {
    try {
      const services = await storage.getServices();
      res.json(services);
    } catch (error) {
      console.error("Get services error:", error);
      res.status(500).json({ error: "Erro ao buscar serviços" });
    }
  });

  app.post("/api/services", requireAuth, async (req, res) => {
    try {
      // Validar se o recibo já está fechado
      const { contractId, refYear, refMonth } = req.body;
      const receipt = await storage.getReceiptByContractAndRef(contractId, refYear, refMonth);
      
      if (receipt && receipt.status !== "draft") {
        return res.status(400).json({ error: "Não é possível adicionar serviços a um recibo fechado, pago ou repassado." });
      }

      const service = await storage.createService(req.body);
      await writeAuditEntries({
        req,
        action: "CREATE",
        entityType: "SERVICO",
        entityId: service.id,
        after: service,
      });
      res.status(201).json(service);
    } catch (error) {
      console.error("Create service error:", error);
      res.status(500).json({ error: "Erro ao criar serviço" });
    }
  });

  app.patch("/api/services/:id", requireAuth, async (req, res) => {
    try {
      const existingService = await storage.getService(getSingleParam(req.params.id));
      if (!existingService) return res.status(404).json({ error: "Serviço não encontrado" });
      await assertEditableFieldsAllowed(
        req,
        existingService.providerId ? "edit_service" : "edit_adjustment",
        req.body,
      );

      // Validar se o recibo já está fechado
      const receipt = await storage.getReceiptByContractAndRef(
        existingService.contractId, 
        existingService.refYear, 
        existingService.refMonth
      );
      
      if (receipt && receipt.status !== "draft") {
        return res.status(400).json({ error: "Não é possível alterar serviços de um recibo fechado, pago ou repassado." });
      }

      const service = await storage.updateService(getSingleParam(req.params.id), req.body);
      if (!service) return res.status(404).json({ error: "Serviço não encontrado" });
      await writeAuditEntries({
        req,
        action: "UPDATE",
        entityType: "SERVICO",
        entityId: service.id,
        before: existingService,
        after: service,
      });
      res.json(service);
    } catch (error: any) {
      if (error?.statusCode) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      console.error("Update service error:", error);
      res.status(500).json({ error: "Erro ao atualizar serviço" });
    }
  });

  app.delete("/api/services/bulk", requireAuth, async (req, res) => {
    try {
      const { ids } = req.body;
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: "IDs inválidos ou vazios" });
      }

      const servicesToDelete: any[] = [];

      // Validar cada serviço antes de excluir
      // TODO: Otimizar para buscar todos de uma vez se necessário
      for (const id of ids) {
        const service = await storage.getService(id);
        if (service) {
          servicesToDelete.push(service);
          const receipt = await storage.getReceiptByContractAndRef(
            service.contractId,
            service.refYear,
            service.refMonth
          );
          if (receipt && receipt.status !== "draft") {
            return res.status(400).json({ 
              error: `Não é possível excluir o serviço (Valor: ${service.amount}, Desc: ${service.description}) pois o recibo está fechado.` 
            });
          }
        }
      }

      await storage.deleteServicesBulk(ids);
      await Promise.all(
        servicesToDelete.map((service) =>
          writeAuditEntries({
            req,
            action: "DELETE",
            entityType: "SERVICO",
            entityId: service.id,
            before: service,
          })
        )
      );
      res.json({ success: true });
    } catch (error) {
      console.error("Bulk delete services error:", error);
      res.status(500).json({ error: "Erro ao excluir serviços em lote" });
    }
  });

  app.delete("/api/services/:id", requireAuth, async (req, res) => {
    try {
      const existingService = await storage.getService(getSingleParam(req.params.id));
      if (!existingService) return res.status(404).json({ error: "Serviço não encontrado" });

      // Validar se o recibo já está fechado
      const receipt = await storage.getReceiptByContractAndRef(
        existingService.contractId, 
        existingService.refYear, 
        existingService.refMonth
      );
      
      if (receipt && receipt.status !== "draft") {
        return res.status(400).json({ error: "Não é possível excluir serviços de um recibo fechado, pago ou repassado." });
      }

      await storage.deleteService(getSingleParam(req.params.id));
      await writeAuditEntries({
        req,
        action: "DELETE",
        entityType: "SERVICO",
        entityId: existingService.id,
        before: existingService,
      });
      res.json({ success: true });
    } catch (error) {
      console.error("Delete service error:", error);
      res.status(500).json({ error: "Erro ao excluir serviço" });
    }
  });

  app.get("/api/receipts", requireAuth, async (req, res) => {
    try {
      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      const month = parseInt(req.query.month as string) || new Date().getMonth() + 1;
      const [receipts, transfers, invoices, contracts, properties, landlords] = await Promise.all([
        storage.getReceiptsByRef(year, month),
        storage.getLandlordTransfersReport(year, month, "ref"),
        storage.getInvoices(),
        storage.getContracts(),
        storage.getProperties(),
        storage.getLandlords(),
      ]);

      const contractsById = new Map(contracts.map((item: any) => [item.id, item]));
      const propertiesById = new Map(properties.map((item: any) => [item.id, item]));
      const landlordsById = new Map(landlords.map((item: any) => [item.id, item]));

      const transfersByReceiptId = new Map<string, any[]>();
      for (const t of transfers) {
        const list = transfersByReceiptId.get(t.receiptId) || [];
        list.push(t);
        transfersByReceiptId.set(t.receiptId, list);
      }

      const invoicesByReceiptId = new Map<string, any[]>();
      for (const invoice of invoices) {
        if (!invoice.receiptId) continue;
        const existing = invoicesByReceiptId.get(invoice.receiptId) || [];
        existing.push(invoice);
        invoicesByReceiptId.set(invoice.receiptId, existing);
      }

      // Buscar transações para determinar isPaid e data de pagamento
      const receiptIds = receipts.map(r => r.id);
      const cashTransactions = await storage.getCashTransactionsByReceiptIds(receiptIds);
      
      const paymentsByReceiptId = new Map<string, string>();
      const paidReceiptIds = new Set<string>();

      cashTransactions
        .filter(t => t.type === "IN")
        .forEach(t => {
          if (!t.receiptId) return;
          paidReceiptIds.add(t.receiptId);
          paymentsByReceiptId.set(t.receiptId, String(t.date));
        });

      const enrichedReceipts = await Promise.all(receipts.map(async (receipt) => {
        const receiptTransfers = transfersByReceiptId.get(receipt.id) || [];
        const hasTransfer = receiptTransfers.length > 0;
        const transferStatus = (() => {
          if (receiptTransfers.length === 0) return undefined;
          const statuses = receiptTransfers.map(t => t.status);
          if (statuses.every(s => s === "paid")) return "paid";
          if (statuses.some(s => s === "failed")) return "failed";
          if (statuses.some(s => s === "reversed")) return "reversed";
          return "pending";
        })();
        const transferSplits = receiptTransfers.map((t: any) => ({
          id: t.id,
          landlordId: t.landlordId,
          amount: t.amount,
          status: t.status,
        }));

        const receiptInvoices = invoicesByReceiptId.get(receipt.id) || [];
        const adminInvoices = receiptInvoices.filter((i: any) => isAdministracaoInvoice(i));
        const landlordNfseInvoices = receiptInvoices.filter((i: any) => isLandlordNfseInvoice(i));
        const nonCancelledInvoices = adminInvoices.filter((i: any) => i.status !== "cancelled");
        const nonCancelledLandlordNfseInvoices = landlordNfseInvoices.filter((i: any) => i.status !== "cancelled");
        const hasInvoiceGenerated = nonCancelledInvoices.length > 0;
        const hasInvoiceIssued =
          hasInvoiceGenerated && nonCancelledInvoices.every((i: any) => i.status === "issued");
        const hasLandlordNfseGenerated = nonCancelledLandlordNfseInvoices.length > 0;
        const hasLandlordNfseIssued =
          hasLandlordNfseGenerated && nonCancelledLandlordNfseInvoices.every((i: any) => i.status === "issued");
        const hasAnyCancelled = adminInvoices.some((i: any) => i.status === "cancelled");
        const invoiceLandlordIds = nonCancelledInvoices.map((i: any) => i.landlordId);
        const landlordNfseLandlordIds = nonCancelledLandlordNfseInvoices.map((i: any) => i.landlordId);
        const contract = contractsById.get(receipt.contractId);
        const property = contract ? propertiesById.get(contract.propertyId) : undefined;
        const sharesRaw = ((property as any)?.landlordShares as Array<{ landlordId: string; percent: number }> | undefined) || [];
        const owners =
          Array.isArray(sharesRaw) && sharesRaw.length > 0
            ? sharesRaw
                .filter((share) => !!share.landlordId && Number(share.percent) > 0)
                .map((share) => ({ landlordId: share.landlordId, percent: Number(share.percent) }))
            : contract?.landlordId
              ? [{ landlordId: contract.landlordId, percent: 100 }]
              : [];
        const existingLandlordNfseIdsSet = new Set<string>(landlordNfseLandlordIds);
        const landlordNfseEligibleOwners = owners
          .filter((owner) => !existingLandlordNfseIdsSet.has(owner.landlordId))
          .map((owner) => {
            const landlord = landlordsById.get(owner.landlordId);
            return {
              landlordId: owner.landlordId,
              percent: owner.percent,
              name: landlord?.name || "",
              nfseEnabled: Boolean((landlord as any)?.nfseEnabled),
            };
          })
          .filter((owner) => owner.nfseEnabled);
        const landlordNfseEligibleIds = landlordNfseEligibleOwners.map((owner) => owner.landlordId);

        const mergedInvoiceFlags = {
          isInvoiceGenerated: hasInvoiceGenerated,
          isInvoiceIssued: hasInvoiceIssued,
          isInvoiceCancelled: hasAnyCancelled && !hasInvoiceGenerated,
          isLandlordNfseGenerated: hasLandlordNfseGenerated,
          isLandlordNfseIssued: hasLandlordNfseIssued,
        };

        const isPaid = receipt.status === "paid" || (receipt.id && paidReceiptIds.has(receipt.id));
        const paymentDate = paymentsByReceiptId.get(receipt.id) || null;

        if (receipt.status === 'paid' || receipt.status === 'transferred') {
          return { 
            ...receipt, 
            ...mergedInvoiceFlags,
            outdated: false, 
            hasTransfer,
            transferStatus,
            transferSplits,
            isPaid,
            paymentDate,
            invoiceLandlordIds,
            landlordNfseLandlordIds,
            landlordNfseEligibleIds,
            landlordNfseEligibleOwners,
          };
        }

        const contractServices = await storage.getServicesByContractAndRef(
          receipt.contractId,
          receipt.refYear,
          receipt.refMonth
        );

        const servicesTenantTotal = contractServices
          .filter((s: any) => s.chargedTo === "TENANT" && !(s as any).receiptDiscountTo)
          .reduce((sum, s) => sum + Number(s.amount), 0);

        const servicesLandlordTotal = contractServices
          .filter(
            (s: any) =>
              s.chargedTo === "LANDLORD" &&
            (s as any).discountFrom !== "LANDLORD" &&
            (s as any).discountFrom !== "TENANT" &&
            !(s as any).receiptDiscountTo &&
            !(s as any).isTribute
          )
          .reduce((sum, s) => sum + Number(s.amount), 0);

        const storedTenantTotal = Number(receipt.servicesTenantTotal || 0);
        const storedLandlordTotal = Number(receipt.servicesLandlordTotal || 0);

        const outdated =
          Math.abs(servicesTenantTotal - storedTenantTotal) > 0.01 ||
          Math.abs(servicesLandlordTotal - storedLandlordTotal) > 0.01;

        return { 
          ...receipt,
          ...mergedInvoiceFlags,
          outdated, 
          hasTransfer,
          transferStatus,
          transferSplits,
          isPaid,
          paymentDate,
          invoiceLandlordIds,
          landlordNfseLandlordIds,
          landlordNfseEligibleIds,
          landlordNfseEligibleOwners,
        };
      }));

      res.json(enrichedReceipts);
    } catch (error) {
      console.error("Get receipts error:", error);
      res.status(500).json({ error: "Erro ao buscar recibos" });
    }
  });

  app.post("/api/receipts/by-ids", requireAuth, async (req, res) => {
    try {
      const ids = (req.body as any)?.ids;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.json([]);
      }
      const safeIds = ids.filter((x: any) => typeof x === "string" && x.trim().length > 0);
      if (safeIds.length === 0) return res.json([]);

      const receipts = await storage.getReceiptsByIds(safeIds);
      res.json(receipts);
    } catch (error) {
      console.error("Get receipts by ids error:", error);
      res.status(500).json({ error: "Erro ao buscar recibos" });
    }
  });

  app.get("/api/receipts/:id", requireAuth, async (req, res) => {
    try {
      const receipt = await storage.getReceipt(getSingleParam(req.params.id));
      if (!receipt) return res.status(404).json({ error: "Recibo não encontrado" });

      const transfers = await storage.getLandlordTransfersByReceipt(receipt.id);
      const transfer = transfers.length > 0 ? transfers[0] : null;

      const cashTransactions = await storage.getCashTransactionsByReceiptIds([receipt.id]);
      const isPaid = receipt.status === "paid" || cashTransactions.some(t => t.type === "IN");

      res.json({
        ...receipt,
        hasTransfer: !!transfer,
        transferStatus: transfer?.status,
        isPaid
      });
    } catch (error) {
      console.error("Get receipt error:", error);
      res.status(500).json({ error: "Erro ao buscar recibo" });
    }
  });

  app.post("/api/receipts/:id/slip", requireAuth, async (req, res) => {
    try {
      const receipt = await storage.getReceipt(getSingleParam(req.params.id));
      if (!receipt) return res.status(404).json({ error: "Recibo não encontrado" });

      const contract = await storage.getContract(receipt.contractId);
      if (!contract) return res.status(404).json({ error: "Contrato não encontrado" });

      const tenant = await storage.getTenant(contract.tenantId);
      if (!tenant) return res.status(404).json({ error: "Locatário não encontrado" });

      // Fetch services to check for Tribute
      const services = await storage.getServicesByContractAndRef(contract.id, receipt.refYear, receipt.refMonth);
      const tributeService = services.find(s => s.isTribute);
      const servicesTenantTotalForSlip = services
        .filter((s: any) => s.chargedTo === "TENANT" && !(s as any).receiptDiscountTo)
        .reduce((sum, s) => sum + Number(s.amount), 0);
      const tenantDiscountFromRentForSlip = services
        .filter((s: any) => (s as any).discountFrom === "TENANT" || (s as any).isTribute)
        .reduce((sum, s) => sum + Number(s.amount), 0);
      const receiptDiscountTenantTotalForSlip = services
        .filter(
          (s: any) =>
            (s as any).receiptDiscountTo === "TENANT" ||
            (s as any).receiptDiscountTo === "BOTH"
        )
        .reduce((sum, s) => sum + Number(s.amount), 0);
      const tenantTotalDueForSlip = Math.max(
        0,
        Number(receipt.rentAmount) +
          servicesTenantTotalForSlip -
          tenantDiscountFromRentForSlip -
          receiptDiscountTenantTotalForSlip
      );

      // Calculate Due Date
      let dataVencimento: string;

      if (receipt.dueDate) {
        dataVencimento = String(receipt.dueDate);
      } else {
        dataVencimento = calculateReceiptDueDate(receipt.refYear, receipt.refMonth, contract.dueDay);
      }
      
      // Calculate Fine Date (Next day)
      const fineDate = new Date(dataVencimento);
      fineDate.setDate(fineDate.getDate() + 1);
      const dataMulta = fineDate.toISOString().split('T')[0];

      // Seu Numero - Unique ID (10 digits from timestamp)
      const seuNumero = Date.now().toString().slice(-10);

      // Clean Tenant Data
      const cleanDoc = tenant.doc.replace(/\D/g, '');
      const cleanZip = tenant.zipCode?.replace(/\D/g, '') || "";

      const instructions = [
        `A partir de ${dataMulta.split('-').reverse().join('/')} Juros 0,03%/dia.`,
        `A partir de ${dataMulta.split('-').reverse().join('/')} Multa de 10%`,
        "Não conceder desconto."
      ];

      if (tributeService) {
        const formatMoney = (val: number) => "R$ " + val.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ".");
        
        const rentVal = formatMoney(Number(receipt.rentAmount));
        const tributeVal = formatMoney(Number(tributeService.amount) * -1);

        instructions.push(`Valor do Aluguel: ${rentVal}`);
        instructions.push(`IRRF: ${tributeVal}`);
      }

      const payload = {
        numeroCliente: 2457024,
        codigoModalidade: 1,
        numeroContaCorrente: 775886,
        codigoEspecieDocumento: "DM",
        dataEmissao: new Date().toISOString().split('T')[0],
        seuNumero: seuNumero,
        identificacaoEmissaoBoleto: 1,
        identificacaoDistribuicaoBoleto: 1,
        valor: Number(tenantTotalDueForSlip.toFixed(2)),
        dataVencimento: dataVencimento,
        tipoDesconto: 0,
        tipoMulta: 2,
        dataMulta: dataMulta,
        valorMulta: 10, 
        tipoJurosMora: 2,
        dataJurosMora: dataMulta,
        valorJurosMora: 0.3, 
        numeroParcela: 1,
        aceite: true,
        pagador: {
          numeroCpfCnpj: cleanDoc,
          nome: tenant.name,
          endereco: tenant.address || "Endereço não informado",
          bairro: tenant.neighborhood || "Centro",
          cidade: tenant.city,
          cep: cleanZip,
          uf: tenant.state,
          email: tenant.email || "email@naoinformado.com"
        },
        beneficiarioFinal: {
          numeroCpfCnpj: "57431088000113",
          nome: "Imobiliária Simões"
        },
        mensagensInstrucao: instructions,
        gerarPdf: true,
        codigoCadastrarPIX: 1,
        numeroContratoCobranca: 0
      };

      const result = await sicoobProvider.emitirBoleto(payload);
      console.log("Sicoob Response Keys:", Object.keys(result));


      // Handle PDF
      let slipPdfUrl = "";
      if (result.pdfBoleto) {
        // Base64
        const buffer = Buffer.from(result.pdfBoleto, 'base64');
        const fileName = `boleto-${receipt.id}.pdf`;
        const publicDir = path.join(process.cwd(), 'client', 'public', 'boletos');
        
        // Ensure directory exists
        if (!fs.existsSync(publicDir)) {
          fs.mkdirSync(publicDir, { recursive: true });
        }
        
        fs.writeFileSync(path.join(publicDir, fileName), buffer);
        slipPdfUrl = `/boletos/${fileName}`;
      }

      // Update Receipt
      const digitableLine = result.resultado?.linhaDigitavel || result.linhaDigitavel;
      let barcode = result.resultado?.codigoBarra || result.codigoBarra;
      
      if (!barcode && digitableLine) {
        barcode = digitableToBarcode(digitableLine);
      }

      await storage.updateReceipt(receipt.id, {
        tenantTotalDue: String(tenantTotalDueForSlip.toFixed(2)),
        isSlipIssued: true,
        slipPdfUrl: slipPdfUrl,
        slipOurNumber: seuNumero,
        slipDigitableLine: digitableLine,
        slipBarcode: barcode,
      });

      res.json({ success: true, pdfUrl: slipPdfUrl, ...result });

    } catch (error: any) {
      console.error("Emitir boleto error:", error);
      res.status(500).json({ error: error.message || "Erro ao emitir boleto" });
    }
  });

  app.get("/api/receipts/:id/slip", requireAuth, async (req, res) => {
      // Just to return slip info if needed separately
      const receipt = await storage.getReceipt(getSingleParam(req.params.id));
      if (!receipt) return res.status(404).json({ error: "Recibo não encontrado" });
      res.json({ 
          isSlipIssued: receipt.isSlipIssued,
          slipPdfUrl: receipt.slipPdfUrl,
          slipOurNumber: receipt.slipOurNumber,
          slipDigitableLine: receipt.slipDigitableLine,
          slipBarcode: receipt.slipBarcode
      });
  });

  app.get("/api/receipts/:id/boleto-pdf", requireAuth, async (req, res) => {
    try {
      const receipt = await storage.getReceipt(getSingleParam(req.params.id));
      if (!receipt) return res.status(404).json({ error: "Recibo não encontrado" });

      if (!receipt.slipDigitableLine) {
        return res.status(400).json({ error: "Boleto não possui linha digitável registrada" });
      }

      const result = await sicoobProvider.consultarSegundaVia(receipt.slipDigitableLine);
      
      // O PDF vem em base64 no campo resultado.pdfBoleto ou pdfBoleto (dependendo da resposta exata, verificar logica do emitir)
      // No emitir: result.pdfBoleto
      // No endpoint de segunda via: geralmente é o mesmo padrão
      const pdfBase64 = result.resultado?.pdfBoleto || result.pdfBoleto;

      if (!pdfBase64) {
        return res.status(500).json({ error: "PDF não retornado pela API do Sicoob" });
      }

      const buffer = Buffer.from(pdfBase64, 'base64');

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename=boleto-${receipt.id}.pdf`);
      res.send(buffer);

    } catch (error: any) {
      console.error("Get boleto PDF error:", error);
      res.status(500).json({ error: error.message || "Erro ao buscar PDF do boleto" });
    }
  });

  // Rota pública para visualizar o boleto (sem autenticação, usada para compartilhamento externo)
  app.get("/api/public/receipts/:id/boleto", async (req, res) => {
    try {
      const receipt = await storage.getReceipt(getSingleParam(req.params.id));
      if (!receipt) return res.status(404).json({ error: "Recibo não encontrado" });

      if (!receipt.slipDigitableLine) {
        return res.status(400).json({ error: "Boleto não possui linha digitável registrada" });
      }

      // Consulta a segunda via no Sicoob
      const result = await sicoobProvider.consultarSegundaVia(receipt.slipDigitableLine);
      
      const pdfBase64 = result.resultado?.pdfBoleto || result.pdfBoleto;

      if (!pdfBase64) {
        return res.status(500).json({ error: "PDF não retornado pela API do Sicoob" });
      }

      const buffer = Buffer.from(pdfBase64, 'base64');

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename=boleto-${receipt.id}.pdf`);
      res.send(buffer);

    } catch (error: any) {
      console.error("Get public boleto PDF error:", error);
      res.status(500).json({ error: error.message || "Erro ao buscar PDF do boleto" });
    }
  });

  // Rota pública para visualização de dados do recibo para impressão (compartilhamento externo)
  app.get("/api/public/receipts/:id/print", async (req, res) => {
    try {
      const receipt = await storage.getReceipt(getSingleParam(req.params.id));
      if (!receipt) {
        return res.status(404).json({ error: "Recibo não encontrado" });
      }

      const contract = await storage.getContract(receipt.contractId);
      if (!contract) {
        return res.status(404).json({ error: "Contrato não encontrado" });
      }

      const [property, tenant, landlord, services] = await Promise.all([
        storage.getProperty(contract.propertyId),
        storage.getTenant(contract.tenantId),
        storage.getLandlord(contract.landlordId),
        storage.getServicesByContractAndRef(contract.id, receipt.refYear, receipt.refMonth),
      ]);

      if (!property || !tenant || !landlord) {
        return res.status(404).json({ error: "Dados do contrato incompletos" });
      }

      res.json({
        receipt,
        contract,
        property,
        tenant,
        landlord,
        services,
      });
    } catch (error: any) {
      console.error("Get public receipt print data error:", error);
      res
        .status(500)
        .json({ error: error.message || "Erro ao buscar dados públicos do recibo para impressão" });
    }
  });

  app.post("/api/receipts/generate", requireAuth, async (req, res) => {
    try {
      const { year: reqYear, month: reqMonth } = req.body;
      const year = parseInt(reqYear);
      const month = parseInt(reqMonth);

      if (isNaN(year) || isNaN(month)) {
        return res.status(400).json({ error: "Ano e mês inválidos" });
      }

      const activeContracts = await storage.getActiveContracts();
      const created: any[] = [];

      for (const contract of activeContracts) {
        const result = await generateReceiptForContract(contract, year, month);
        if (!result.created || !result.receipt) continue;

        created.push(result.receipt);
        await writeAuditEntries({
          req,
          action: "CREATE",
          entityType: "RECIBO",
          entityId: result.receipt.id,
          after: result.receipt,
        });
      }

      res.json({ created: created.length, receipts: created });
    } catch (error) {
      console.error("Generate receipts error:", error);
      res.status(500).json({ error: "Erro ao gerar recibos" });
    }
  });

  app.post("/api/contracts/:id/generate-receipt", requirePermission("generate_receipt"), async (req, res) => {
    try {
      const contractId = getSingleParam(req.params.id);
      const { year: reqYear, month: reqMonth } = req.body;
      const year = parseInt(reqYear);
      const month = parseInt(reqMonth);

      if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
        return res.status(400).json({ error: "Ano e mês de referência inválidos" });
      }

      const contract = await storage.getContract(contractId);
      if (!contract) {
        return res.status(404).json({ error: "Contrato não encontrado" });
      }

      const result = await generateReceiptForContract(contract, year, month);

      if (!result.created) {
        if (result.reason === "already_exists") {
          return res.status(409).json({
            error: `Já existe um recibo para ${String(month).padStart(2, "0")}/${year} neste contrato.`,
            receipt: result.receipt || null,
          });
        }

        if (result.reason === "before_first_due_date") {
          return res.status(400).json({
            error: "Não é possível gerar recibo antes do primeiro vencimento do contrato.",
          });
        }
      }

      if (!result.receipt) {
        return res.status(500).json({ error: "Não foi possível gerar o recibo." });
      }

      await writeAuditEntries({
        req,
        action: "CREATE",
        entityType: "RECIBO",
        entityId: result.receipt.id,
        after: result.receipt,
      });

      res.status(201).json(result.receipt);
    } catch (error) {
      console.error("Generate contract receipt error:", error);
      res.status(500).json({ error: "Erro ao gerar recibo individual" });
    }
  });

  app.post("/api/receipts/:id/regenerate", requireAuth, async (req, res) => {
    try {
      const receipt = await storage.getReceipt(getSingleParam(req.params.id));
      if (!receipt) return res.status(404).json({ error: "Recibo não encontrado" });
      
      if (receipt.status === "transferred" || receipt.status === "paid") {
        return res.status(400).json({ error: "Não é possível regerar um recibo pago ou repassado. Faça o estorno primeiro." });
      }

      const contract = await storage.getContract(receipt.contractId);
      if (!contract) return res.status(404).json({ error: "Contrato não encontrado" });

      // Auto-create Recurring Items if missing
      const recurringItems = await storage.getContractRecurringItems(contract.id);
      const preServices = await storage.getServicesByContractAndRef(contract.id, receipt.refYear, receipt.refMonth);
      for (const item of recurringItems) {
         const exists = preServices.some(s => s.description === item.description);
         if (!exists) {
           await storage.createService({
              contractId: contract.id,
              refYear: receipt.refYear,
              refMonth: receipt.refMonth,
              description: item.description,
              amount: String(item.amount),
              chargedTo: item.chargedTo,
              discountFrom: item.discountFrom,
              passThrough: item.passThrough
           });
         }
      }

      // Auto-create/Update Insurance Service if applicable
      if (contract.guaranteeType === 'insurance' && Number(contract.insuranceValue) > 0) {
        const currentServices = await storage.getServicesByContractAndRef(contract.id, receipt.refYear, receipt.refMonth);
        const insuranceService = currentServices.find(s => s.description === "Seguro Fiança");
        
        if (insuranceService) {
           // Update amount if different
           if (Number(insuranceService.amount) !== Number(contract.insuranceValue)) {
             await storage.updateService(insuranceService.id, { amount: String(contract.insuranceValue) });
           }
        } else {
           // Create
           await storage.createService({
             contractId: contract.id,
             refYear: receipt.refYear,
             refMonth: receipt.refMonth,
             description: "Seguro Fiança",
             amount: String(contract.insuranceValue),
             chargedTo: "TENANT",
             passThrough: false
           });
        }
      }

      const contractServices = await storage.getServicesByContractAndRef(
        contract.id,
        receipt.refYear,
        receipt.refMonth
      );
      
      // Calculate Tribute Total separately
      const tributeTotal = contractServices
        .filter((s: any) => (s as any).isTribute)
        .reduce((sum, s) => sum + Number(s.amount), 0);

      const receiptDiscountTenantTotal = contractServices
        .filter(
          (s: any) =>
            (s as any).receiptDiscountTo === "TENANT" ||
            (s as any).receiptDiscountTo === "BOTH"
        )
        .reduce((sum, s) => sum + Number(s.amount), 0);

      const receiptDiscountLandlordTotal = contractServices
        .filter(
          (s: any) =>
            (s as any).receiptDiscountTo === "LANDLORD" ||
            (s as any).receiptDiscountTo === "BOTH"
        )
        .reduce((sum, s) => sum + Number(s.amount), 0);

      const tenantDiscountFromRent = contractServices
        .filter((s: any) => (s as any).discountFrom === "TENANT" || (s as any).isTribute)
        .reduce((sum, s) => sum + Number(s.amount), 0);
      
      // Exclude isTribute and tenant discounts from landlordDiscountFromRent to preserve admin fee base
      const landlordDiscountFromRent = contractServices
        .filter(
          (s: any) =>
            (s as any).discountFrom === "LANDLORD" &&
            !(s as any).isTribute
        )
        .reduce((sum, s) => sum + Number(s.amount), 0);
      const servicesTenantTotal = contractServices
        .filter((s: any) => s.chargedTo === "TENANT" && !(s as any).receiptDiscountTo)
        .reduce((sum, s) => sum + Number(s.amount), 0);
      const servicesLandlordTotal = contractServices
        .filter(
          (s: any) =>
            s.chargedTo === "LANDLORD" &&
            (s as any).discountFrom !== "LANDLORD" &&
            (s as any).discountFrom !== "TENANT" &&
            !(s as any).receiptDiscountTo &&
            !(s as any).isTribute
        )
        .reduce((sum, s) => sum + Number(s.amount), 0);
      const servicesPassThroughTotal = contractServices
        .filter((s: any) => s.passThrough && !(s as any).receiptDiscountTo)
        .reduce((sum, s) => sum + Number(s.amount), 0);

      const rentAmount = Number(contract.rentAmount);
      const adjustedRentTenant = Math.max(0, rentAmount - tenantDiscountFromRent);
      const adjustedRentLandlord = Math.max(0, rentAmount - landlordDiscountFromRent);
      const adminFeePercent = Number(contract.adminFeePercent);
      const adminFeeAmount = (adjustedRentLandlord * adminFeePercent) / 100;
      const tenantTotalDue =
        rentAmount +
        servicesTenantTotal -
        tenantDiscountFromRent -
        receiptDiscountTenantTotal;
      const landlordTotalDue =
        adjustedRentLandlord -
        adminFeeAmount -
        servicesLandlordTotal +
        servicesPassThroughTotal -
        tributeTotal -
        receiptDiscountLandlordTotal;
      
      // Update due date only if not manually set (or always? Let's recalculate based on contract rules)
      let dueDate: string;
      if (contract.firstDueDate) {
        const firstDueStr = String(contract.firstDueDate).split("T")[0];
           
        const [fYearStr, fMonthStr] = firstDueStr.split('-');
        const fYear = parseInt(fYearStr);
        const fMonth = parseInt(fMonthStr);
        
        if (receipt.refYear === fYear && receipt.refMonth === fMonth) {
           dueDate = firstDueStr;
        } else {
           dueDate = calculateReceiptDueDate(receipt.refYear, receipt.refMonth, contract.dueDay);
        }
      } else {
        dueDate = calculateReceiptDueDate(receipt.refYear, receipt.refMonth, contract.dueDay);
      }

      const updated = await storage.updateReceipt(receipt.id, {
        rentAmount: String(rentAmount),
        adminFeePercent: String(adminFeePercent),
        adminFeeAmount: String(adminFeeAmount),
        servicesTenantTotal: String(servicesTenantTotal),
        servicesLandlordTotal: String(servicesLandlordTotal),
        tenantTotalDue: String(tenantTotalDue),
        landlordTotalDue: String(landlordTotalDue),
        dueDate: dueDate,
        // Mantém o status atual (draft ou closed)
      });

      res.json(updated);
    } catch (error) {
      console.error("Regenerate receipt error:", error);
      res.status(500).json({ error: `Erro ao regerar recibo: ${(error as Error).message}` });
    }
  });

  // Rota para buscar serviços de um contrato específico em um mês/ano (usado nos detalhes do recibo)
  app.get("/api/contracts/:id/services/:year/:month", requireAuth, async (req, res) => {
    try {
      const services = await storage.getServicesByContractAndRef(
        getSingleParam(req.params.id), 
        parseInt(getSingleParam(req.params.year)), 
        parseInt(getSingleParam(req.params.month))
      );
      res.json(services);
    } catch (error) {
      console.error("Get contract services error:", error);
      res.status(500).json({ error: "Erro ao buscar serviços do contrato" });
    }
  });

  app.get("/api/reports/landlord-transfers", requireAuth, async (req, res) => {
    try {
      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      const month = parseInt(req.query.month as string) || new Date().getMonth() + 1;
      const type = (req.query.type as "ref" | "paid") || "ref";
      const start = req.query.start as string | undefined;
      const end = req.query.end as string | undefined;
      const landlordId = req.query.landlordId as string | undefined;

      let transfers;
      if (type === "paid" && start && end) {
        transfers = await storage.getLandlordTransfersByPaymentPeriod(start, end, landlordId);
      } else {
        transfers = await storage.getLandlordTransfersReport(year, month, type);
      }
      res.json(transfers);
    } catch (error) {
      console.error("Get landlord transfers report error:", error);
      res.status(500).json({ error: "Erro ao buscar relatório de repasses" });
    }
  });

  app.get("/api/reports/revenue", requireAuth, async (req, res) => {
    try {
      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      const month = parseInt(req.query.month as string) || new Date().getMonth() + 1;
      
      const revenue = await storage.getRevenueReport(year, month);
      res.json(revenue);
    } catch (error) {
      console.error("Get revenue report error:", error);
      res.status(500).json({ error: "Erro ao buscar relatório de receita" });
    }
  });

  app.get("/api/reports/insurance", requireAuth, async (req, res) => {
    try {
      const today = new Date();
      const defaultEndDate = new Date(today.getFullYear(), today.getMonth(), 10).toISOString().split('T')[0];
      const defaultStartDate = new Date(today.getFullYear(), today.getMonth() - 1, 10).toISOString().split('T')[0];

      const startDate = (req.query.startDate as string) || defaultStartDate;
      const endDate = (req.query.endDate as string) || defaultEndDate;
      
      const statusMode = (req.query.status as string) || "paid_transferred";
      const statuses = statusMode === "all" ? ["paid", "transferred", "closed"] : ["paid", "transferred"];
      
      const insurance = await storage.getInsuranceReport(startDate, endDate, statuses as any);
      res.json(insurance);
    } catch (error) {
      console.error("Get insurance report error:", error);
      res.status(500).json({ error: "Erro ao buscar relatório de seguro fiança" });
    }
  });

  const parseDimobYear = (raw: unknown) => {
    const year = parseInt(getSingleParam(raw as string | string[] | undefined) || "", 10);
    return Number.isFinite(year) && year >= 2000 && year <= 2100
      ? year
      : new Date().getFullYear();
  };

  app.get("/api/reports/dimob", requireAuth, async (req, res) => {
    try {
      const year = parseDimobYear(req.query.year);
      const fichas = await getDimobReport(year);
      res.json({ year, fichas });
    } catch (error) {
      console.error("Get DIMOB report error:", error);
      res.status(500).json({ error: "Erro ao buscar relatório DIMOB" });
    }
  });

  app.get("/api/reports/dimob/pdf", requireAuth, async (req, res) => {
    try {
      const year = parseDimobYear(req.query.year);
      const fichas = await getDimobReport(year);
      const pdfBuffer = await renderHtmlToPdfBuffer(buildDimobReportHtml(fichas, year));
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=${sanitizeExportFileName(`dimob-${year}.pdf`)}`,
      );
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.send(pdfBuffer);
    } catch (error) {
      console.error("Generate DIMOB report PDF error:", error);
      res.status(500).json({ error: "Erro ao gerar PDF do relatório DIMOB" });
    }
  });

  app.get("/api/reports/dimob/excel", requireAuth, async (req, res) => {
    try {
      const year = parseDimobYear(req.query.year);
      const fichas = await getDimobReport(year);
      const csv = buildDimobReportCsv(fichas, year);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=${sanitizeExportFileName(`dimob-${year}.csv`)}`,
      );
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.send(csv);
    } catch (error) {
      console.error("Generate DIMOB report CSV error:", error);
      res.status(500).json({ error: "Erro ao gerar Excel do relatório DIMOB" });
    }
  });

  app.get("/api/reports/invoices-issued", requireAuth, async (req, res) => {
    try {
      const startDate = getSingleParam(req.query.startDate as string | string[] | undefined);
      const endDate = getSingleParam(req.query.endDate as string | string[] | undefined);
      const requestedType = getSingleParam(req.query.type as string | string[] | undefined);
      const reportType: IssuedInvoicesReportTypeFilter =
        requestedType === "PROPRIETARIO" || requestedType === "TODAS" ? requestedType : "IMOBILIARIA";
      const report = await getIssuedInvoicesReport(startDate || undefined, endDate || undefined, reportType);
      // #region debug-point D:api-response
      debugIssuedInvoicesReport("post-fix", "D", "server/routes.ts:/api/reports/invoices-issued", "API respondeu relatorio de notas emitidas", {
        queryStartDate: startDate || null,
        queryEndDate: endDate || null,
        typeFilter: reportType,
        items: report.items.length,
        totalNotas: report.summary.totalNotas,
      });
      // #endregion
      res.json(report);
    } catch (error) {
      console.error("Get issued invoices report error:", error);
      res.status(500).json({ error: "Erro ao buscar relatório de notas fiscais emitidas" });
    }
  });

  app.get("/api/reports/invoices-issued/pdf", requireAuth, async (req, res) => {
    try {
      const startDate = getSingleParam(req.query.startDate as string | string[] | undefined);
      const endDate = getSingleParam(req.query.endDate as string | string[] | undefined);
      const requestedType = getSingleParam(req.query.type as string | string[] | undefined);
      const reportType: IssuedInvoicesReportTypeFilter =
        requestedType === "PROPRIETARIO" || requestedType === "TODAS" ? requestedType : "IMOBILIARIA";
      // #region debug-point P:pdf-endpoint-hit
      debugIssuedInvoicesReport("pre-fix", "D", "server/routes.ts:/api/reports/invoices-issued/pdf:hit", "Endpoint de PDF acionado", {
        nodeEnv: process.env.NODE_ENV || null,
        startDate: startDate || null,
        endDate: endDate || null,
        typeFilter: reportType,
      });
      // #endregion
      const report = await getIssuedInvoicesReport(startDate || undefined, endDate || undefined, reportType);
      // #region debug-point D:pdf-response
      debugIssuedInvoicesReport("post-fix", "D", "server/routes.ts:/api/reports/invoices-issued/pdf", "PDF do relatorio preparado", {
        queryStartDate: startDate || null,
        queryEndDate: endDate || null,
        typeFilter: reportType,
        items: report.items.length,
        firstItems: report.items.slice(0, 3).map((item) => ({
          emissaoId: item.emissaoId,
          numeroNfse: item.numeroNfse,
          emissionDate: item.emissionDate,
        })),
      });
      // #endregion
      const html = buildIssuedInvoicesReportHtml(report);
      const pdfBuffer = await renderHtmlToPdfBuffer(html);
      const startLabel = report.startDate || "todos";
      const endLabel = report.endDate || "todos";
      const fileName = `relatorio-notas-fiscais-emitidas-${report.typeFilter.toLowerCase()}-${startLabel}-${endLabel}.pdf`;

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename=${sanitizeExportFileName(fileName)}`);
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      res.send(pdfBuffer);
    } catch (error) {
      console.error("Generate issued invoices report PDF error:", error);
      // #region debug-point P:pdf-endpoint-error
      debugIssuedInvoicesReport("pre-fix", "D", "server/routes.ts:/api/reports/invoices-issued/pdf:error", "Erro ao gerar PDF no endpoint", {
        message: (error as any)?.message || String(error),
        name: (error as any)?.name || null,
      });
      // #endregion
      res.status(500).json({ error: "Erro ao gerar PDF do relatório de notas fiscais emitidas" });
    }
  });

  app.patch("/api/receipts/:id/admin-fee", requirePermission("edit_receipt"), async (req, res) => {
    try {
      const { adminFeeAmount } = req.body;
      await assertEditableFieldsAllowed(req, "edit_receipt", { adminFeeAmount });
      if (adminFeeAmount === undefined || adminFeeAmount === null) {
        return res.status(400).json({ error: "Valor da taxa é obrigatório" });
      }

      const receipt = await storage.getReceipt(getSingleParam(req.params.id));
      if (!receipt) return res.status(404).json({ error: "Recibo não encontrado" });
      if (receipt.status !== "draft") return res.status(400).json({ error: "Recibo não está em rascunho" });

      const rentAmount = Number(receipt.rentAmount);
      const newAdminFeeAmount = Number(adminFeeAmount);

      // Recompute totals considerando descontos e todos os repasses
      const contractServices = await storage.getServicesByContractAndRef(receipt.contractId, receipt.refYear, receipt.refMonth);
      const discountToLandlord = contractServices
        .filter((s: any) => (s as any).discountFrom === "LANDLORD" && !(s as any).isTribute)
        .reduce((sum, s) => sum + Number(s.amount), 0);
      const tributeTotal = contractServices
        .filter((s: any) => (s as any).isTribute)
        .reduce((sum, s) => sum + Number(s.amount), 0);
      const receiptDiscountLandlordTotal = contractServices
        .filter(
          (s: any) =>
            (s as any).receiptDiscountTo === "LANDLORD" ||
            (s as any).receiptDiscountTo === "BOTH"
        )
        .reduce((sum, s) => sum + Number(s.amount), 0);
      const servicesLandlordTotal = contractServices
        .filter(
          (s: any) =>
            s.chargedTo === "LANDLORD" &&
            (s as any).discountFrom !== "LANDLORD" &&
            (s as any).discountFrom !== "TENANT" &&
            !(s as any).isTribute &&
            !(s as any).receiptDiscountTo
        )
        .reduce((sum, s) => sum + Number(s.amount), 0);
      const servicesPassThroughTotal = contractServices
        .filter((s: any) => s.passThrough && !(s as any).receiptDiscountTo)
        .reduce((sum, s) => sum + Number(s.amount), 0);
      const adjustedRent = Math.max(0, rentAmount - discountToLandlord);

      // Recalculate landlord total due
      // Fórmula: (Aluguel Ajustado) - Taxa Adm - Serviços(Proprietário) + Repasses
      const landlordTotalDue =
        adjustedRent -
        newAdminFeeAmount -
        servicesLandlordTotal +
        servicesPassThroughTotal -
        tributeTotal -
        receiptDiscountLandlordTotal;

      // Update percent if possible
      let adminFeePercent = Number(receipt.adminFeePercent);
      if (adjustedRent > 0) {
        adminFeePercent = (newAdminFeeAmount / adjustedRent) * 100;
      }

      const updated = await storage.updateReceipt(getSingleParam(req.params.id), { 
        adminFeeAmount: String(newAdminFeeAmount),
        adminFeePercent: String(adminFeePercent.toFixed(2)),
        landlordTotalDue: String(landlordTotalDue.toFixed(2))
      });

      if (updated) {
        await writeAuditEntries({
          req,
          action: "UPDATE",
          entityType: "RECIBO",
          entityId: updated.id,
          before: receipt,
          after: updated,
        });
      }

      res.json(updated);
    } catch (error: any) {
      if (error?.statusCode) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      console.error("Update admin fee error:", error);
      res.status(500).json({ error: "Erro ao atualizar taxa de administração" });
    }
  });

  app.patch("/api/receipts/:id/due-date", requirePermission("edit_receipt"), async (req, res) => {
    try {
      const { dueDate } = req.body as { dueDate?: string };
      await assertEditableFieldsAllowed(req, "edit_receipt", { dueDate });
      if (!dueDate) {
        return res.status(400).json({ error: "Data de vencimento é obrigatória" });
      }

      const receipt = await storage.getReceipt(getSingleParam(req.params.id));
      if (!receipt) return res.status(404).json({ error: "Recibo não encontrado" });

      if (receipt.isSlipIssued) {
        return res.status(400).json({ error: "Recibo já possui boleto emitido; vencimento não pode ser alterado" });
      }

      if (receipt.status !== "draft" && receipt.status !== "closed") {
        return res.status(400).json({ error: "Vencimento só pode ser alterado para recibos em rascunho ou fechados" });
      }

      const parsed = new Date(dueDate);
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ error: "Data de vencimento inválida" });
      }

      const normalized = parsed.toISOString().split("T")[0];

      const updated = await storage.updateReceipt(getSingleParam(req.params.id), {
        dueDate: normalized,
      });

      if (updated) {
        await writeAuditEntries({
          req,
          action: "UPDATE",
          entityType: "RECIBO",
          entityId: updated.id,
          before: receipt,
          after: updated,
        });
      }

      res.json(updated);
    } catch (error: any) {
      if (error?.statusCode) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      console.error("Update receipt due date error:", error);
      res.status(500).json({ error: "Erro ao atualizar vencimento do recibo" });
    }
  });

  app.post("/api/receipts/:id/close", requireAuth, async (req, res) => {
    try {
      const receipt = await storage.getReceipt(getSingleParam(req.params.id));
      if (!receipt) return res.status(404).json({ error: "Recibo não encontrado" });
      if (receipt.status !== "draft") return res.status(400).json({ error: "Recibo não está em rascunho" });

      const updated = await storage.updateReceipt(getSingleParam(req.params.id), { status: "closed" });
      if (updated) {
        await writeAuditEntries({
          req,
          action: "UPDATE",
          entityType: "RECIBO",
          entityId: updated.id,
          before: receipt,
          after: updated,
        });
      }
      res.json(updated);
    } catch (error) {
      console.error("Close receipt error:", error);
      res.status(500).json({ error: "Erro ao fechar recibo" });
    }
  });

  app.post("/api/receipts/:id/reopen", requireAuth, async (req, res) => {
    try {
      const receipt = await storage.getReceipt(getSingleParam(req.params.id));
      if (!receipt) return res.status(404).json({ error: "Recibo não encontrado" });
      
      // Allow reopening ONLY 'closed' receipts. Paid or Transferred receipts must be reversed first.
      if (receipt.status !== "closed") {
        return res.status(400).json({ error: "Recibo deve estar APENAS Fechado para ser reaberto. Se estiver Pago ou Repassado, realize o estorno primeiro." });
      }

      // Check if any transfer exists (even if pending)
      const transfers = await storage.getLandlordTransfersByReceipt(receipt.id);
      if (transfers.length > 0) {
        return res.status(400).json({ error: "Não é possível reabrir um recibo com repasse gerado. Exclua o repasse primeiro." });
      }

      if (receipt.isInvoiceIssued) {
        return res.status(400).json({ error: "Não é possível reabrir recibo com nota fiscal emitida." });
      }
      
      if (receipt.isInvoiceGenerated && !receipt.isInvoiceCancelled) {
        return res.status(400).json({ error: "Exclua a nota fiscal gerada antes de reabrir o recibo." });
      }

      const updated = await storage.updateReceipt(getSingleParam(req.params.id), { status: "draft" });
      if (updated) {
        await writeAuditEntries({
          req,
          action: "UPDATE",
          entityType: "RECIBO",
          entityId: updated.id,
          before: receipt,
          after: updated,
        });
      }
      res.json(updated);
    } catch (error) {
      console.error("Reopen receipt error:", error);
      res.status(500).json({ error: "Erro ao reabrir recibo" });
    }
  });

  app.post("/api/receipts/:id/reopen", requireAuth, async (req, res) => {
    try {
      const receipt = await storage.getReceipt(getSingleParam(req.params.id));
      if (!receipt) return res.status(404).json({ error: "Recibo não encontrado" });
      
      // Allow reopening 'closed' or 'paid' receipts
      if (receipt.status !== "closed" && receipt.status !== "paid") {
        return res.status(400).json({ error: "Recibo deve estar fechado ou pago para ser reaberto." });
      }

      // If paid, check if transferred
      if (receipt.status === "paid") {
        const transfers = await storage.getLandlordTransfersByReceipt(receipt.id);
        const activeTransfer = transfers.find(t => t.status === "pending" || t.status === "paid");
        
        if (activeTransfer) {
          return res.status(400).json({ error: "Não é possível reabrir um recibo com repasse ativo. Exclua o repasse primeiro." });
        }
      }

      if (receipt.isInvoiceIssued) {
        return res.status(400).json({ error: "Não é possível reabrir recibo com nota fiscal emitida." });
      }
      
      if (receipt.isInvoiceGenerated && !receipt.isInvoiceCancelled) {
        return res.status(400).json({ error: "Exclua a nota fiscal gerada antes de reabrir o recibo." });
      }

      // If status was paid, reverse payment (remove Cash IN)
      if (receipt.status === "paid") {
        await storage.deleteCashTransactionByReceiptAndType(receipt.id, "IN");
      }

      const updated = await storage.updateReceipt(getSingleParam(req.params.id), { status: "draft" });
      if (updated) {
        await writeAuditEntries({
          req,
          action: "UPDATE",
          entityType: "RECIBO",
          entityId: updated.id,
          before: receipt,
          after: updated,
        });
      }
      res.json(updated);
    } catch (error) {
      console.error("Reopen receipt error:", error);
      res.status(500).json({ error: "Erro ao reabrir recibo" });
    }
  });

  app.post("/api/receipts/:id/emit-slip", requireAuth, async (req, res) => {
    try {
      const receipt = await storage.getReceipt(getSingleParam(req.params.id));
      if (!receipt) return res.status(404).json({ error: "Recibo não encontrado" });

      if (receipt.isSlipIssued) {
        return res.status(400).json({ error: "Boleto já emitido para este recibo" });
      }

      // Permitir emitir boleto mesmo se pago/repassado (solicitação do usuário)
      // if (receipt.status === "paid" || receipt.status === "transferred") {
      //   return res.status(400).json({ error: "Recibo já pago ou repassado" });
      // }

      const updated = await storage.updateReceipt(receipt.id, {
        isSlipIssued: true,
      });

      if (updated) {
        await writeAuditEntries({
          req,
          action: "UPDATE",
          entityType: "RECIBO",
          entityId: updated.id,
          before: receipt,
          after: updated,
        });
      }

      res.json(updated);
    } catch (error) {
      console.error("Emit slip error:", error);
      res.status(500).json({ error: "Erro ao emitir boleto" });
    }
  });

  app.post("/api/receipts/:id/cancel-slip", requireAuth, async (req, res) => {
    try {
      const receipt = await storage.getReceipt(getSingleParam(req.params.id));
      if (!receipt) return res.status(404).json({ error: "Recibo não encontrado" });

      if (!receipt.isSlipIssued) {
        return res.status(400).json({ error: "Boleto não foi emitido para este recibo" });
      }

      // Permitir cancelar boleto mesmo se pago/repassado (solicitação do usuário)
      // if (receipt.status === "paid" || receipt.status === "transferred") {
      //   return res.status(400).json({ error: "Não é possível cancelar boleto de recibo pago ou repassado" });
      // }

      const updated = await storage.updateReceipt(receipt.id, {
        isSlipIssued: false,
      });

      if (updated) {
        await writeAuditEntries({
          req,
          action: "UPDATE",
          entityType: "RECIBO",
          entityId: updated.id,
          before: receipt,
          after: updated,
        });
      }

      res.json(updated);
    } catch (error) {
      console.error("Cancel slip error:", error);
      res.status(500).json({ error: "Erro ao cancelar boleto" });
    }
  });

  app.post("/api/receipts/:id/mark-paid", requirePermission("mark_receipt_paid"), async (req, res) => {
    try {
      const { paymentDate, interest } = req.body;
      const receipt = await storage.getReceipt(getSingleParam(req.params.id));
      if (!receipt) return res.status(404).json({ error: "Recibo não encontrado" });
      
      // Permitir closed ou transferred
      if (receipt.status !== "closed" && receipt.status !== "transferred") {
        return res.status(400).json({ error: "Recibo não está fechado ou repassado" });
      }

      // Se status é closed, muda para paid. Se é transferred, mantém transferred.
      const newStatus = receipt.status === "closed" ? "paid" : receipt.status;
      const updated = await storage.updateReceipt(getSingleParam(req.params.id), { 
        status: newStatus,
        interestAmount: interest ? String(interest) : "0"
      });
      if (updated) {
        await writeAuditEntries({
          req,
          action: "UPDATE",
          entityType: "RECIBO",
          entityId: updated.id,
          before: receipt,
          after: updated,
        });
      }

      const contract = await storage.getContract(receipt.contractId);
      const tenant = contract ? await storage.getTenant(contract.tenantId) : null;
      const tenantName = tenant ? ` - ${tenant.name}` : "";

      const rentCash = await storage.createCashTransaction({
        type: "IN",
        date: paymentDate || new Date().toISOString().split("T")[0],
        category: "Aluguel",
        description: `Pagamento Recibo ${String(receipt.refMonth).padStart(2, "0")}/${receipt.refYear}${tenantName}`,
        amount: receipt.tenantTotalDue,
        receiptId: receipt.id,
      });
      await writeAuditEntries({
        req,
        action: "CREATE",
        entityType: "CAIXA",
        entityId: rentCash.id,
        after: rentCash,
      });

      if (interest && Number(interest) > 0) {
        const interestCash = await storage.createCashTransaction({
          type: "IN",
          date: paymentDate || new Date().toISOString().split("T")[0],
          category: "Juros",
          description: `Juros Recibo ${String(receipt.refMonth).padStart(2, "0")}/${receipt.refYear}${tenantName}`,
          amount: String(interest),
          receiptId: receipt.id,
        });
        await writeAuditEntries({
          req,
          action: "CREATE",
          entityType: "CAIXA",
          entityId: interestCash.id,
          after: interestCash,
        });
      }

      res.json(updated);
    } catch (error) {
      console.error("Mark paid error:", error);
      res.status(500).json({ error: "Erro ao marcar como pago" });
    }
  });

  // Financial Records (Expense Control)
  app.get("/api/financial-records", requireAuth, async (req, res) => {
    try {
      const { month, year } = req.query;
      
      if (!month || !year) {
        return res.status(400).json({ error: "Month and year are required" });
      }

      const m = parseInt(month as string);
      const y = parseInt(year as string);

      if (isNaN(m) || isNaN(y)) {
        return res.status(400).json({ error: "Invalid month or year" });
      }

      const records = await storage.getFinancialRecords(y, m);
      const previousBalance = await storage.getFinancialRecordPreviousBalance(y, m);

      res.json({
        records,
        previousBalance
      });
    } catch (error) {
      console.error("Get financial records error:", error);
      res.status(500).json({ error: "Failed to fetch financial records" });
    }
  });

  // Financial Period Status
  app.get("/api/financial-periods", requireAuth, async (req, res) => {
    try {
      const { month, year } = req.query;
      
      if (!month || !year) {
        return res.status(400).json({ error: "Month and year are required" });
      }

      const m = parseInt(month as string);
      const y = parseInt(year as string);

      if (isNaN(m) || isNaN(y)) {
        return res.status(400).json({ error: "Invalid month or year" });
      }

      const period = await storage.getFinancialPeriod(y, m);
      res.json(period || { status: "OPEN" }); // Default to OPEN if not found
    } catch (error) {
      console.error("Get financial period error:", error);
      res.status(500).json({ error: "Failed to fetch financial period" });
    }
  });

  app.post("/api/financial-periods/toggle", requireAuth, async (req, res) => {
    try {
      const { month, year, status } = req.body;
      
      if (!month || !year || !status) {
        return res.status(400).json({ error: "Month, year and status are required" });
      }

      const m = parseInt(month);
      const y = parseInt(year);

      if (isNaN(m) || isNaN(y) || (status !== "OPEN" && status !== "CLOSED")) {
        return res.status(400).json({ error: "Invalid parameters" });
      }

      const period = await storage.toggleFinancialPeriod(y, m, status);
      res.json(period);
    } catch (error) {
      console.error("Toggle financial period error:", error);
      res.status(500).json({ error: "Failed to toggle financial period" });
    }
  });

  app.post("/api/financial-records", requireAuth, async (req, res) => {
    try {
      const data = insertFinancialRecordSchema.parse(req.body);
      const record = await storage.createFinancialRecord(data);
      await writeAuditEntries({
        req,
        action: "CREATE",
        entityType: "LANCAMENTO_FINANCEIRO",
        entityId: record.id,
        after: record,
      });
      res.status(201).json(record);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors });
      } else if (
        error instanceof Error &&
        (error.message.includes("Período") || error.message.includes("Saldo Inicial"))
      ) {
        res.status(400).json({ error: error.message });
      } else {
        console.error("Create financial record error:", error);
        res.status(500).json({ error: "Failed to create financial record" });
      }
    }
  });

  app.put("/api/financial-records/:id", requireAuth, async (req, res) => {
    try {
      const recordId = getSingleParam(req.params.id);
      const currentRecord = await storage.getFinancialRecord(recordId);
      if (!currentRecord) {
        return res.status(404).json({ error: "Financial record not found" });
      }

      const data = insertFinancialRecordSchema.partial().parse(req.body);
      const record = await storage.updateFinancialRecord(recordId, data);
      
      if (!record) {
        return res.status(404).json({ error: "Financial record not found" });
      }
      
      await writeAuditEntries({
        req,
        action: "UPDATE",
        entityType: "LANCAMENTO_FINANCEIRO",
        entityId: record.id,
        before: currentRecord,
        after: record,
      });
      res.json(record);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors });
      } else if (
        error instanceof Error &&
        (error.message.includes("Período") || error.message.includes("Saldo Inicial"))
      ) {
        res.status(400).json({ error: error.message });
      } else {
        console.error("Update financial record error:", error);
        res.status(500).json({ error: "Failed to update financial record" });
      }
    }
  });

  app.delete("/api/financial-records/:id", requireAuth, async (req, res) => {
    try {
      const recordId = getSingleParam(req.params.id);
      const currentRecord = await storage.getFinancialRecord(recordId);
      await storage.deleteFinancialRecord(recordId);
      if (currentRecord) {
        await writeAuditEntries({
          req,
          action: "DELETE",
          entityType: "LANCAMENTO_FINANCEIRO",
          entityId: currentRecord.id,
          before: currentRecord,
        });
      }
      res.sendStatus(204);
    } catch (error) {
      if (error instanceof Error && error.message.includes("Período")) {
        res.status(400).json({ error: error.message });
      } else {
        console.error("Delete financial record error:", error);
        res.status(500).json({ error: "Failed to delete financial record" });
      }
    }
  });

  app.post("/api/receipts/:id/reverse-payment", requirePermission("reverse_payment"), async (req, res) => {
    try {
      const receipt = await storage.getReceipt(getSingleParam(req.params.id));
      if (!receipt) return res.status(404).json({ error: "Recibo não encontrado" });
      
      // Permitir paid ou transferred (se tiver pagamento)
      if (receipt.status !== "paid" && receipt.status !== "transferred") {
        return res.status(400).json({ error: "Recibo não está pago" });
      }

      // Se for paid, volta para closed. Se for transferred, mantém transferred (mas remove a transação IN).
      const newStatus = receipt.status === "paid" ? "closed" : receipt.status;
      
      const updated = await storage.updateReceipt(getSingleParam(req.params.id), { status: newStatus });

      // Remover transação de entrada do caixa
      const receiptCashTransactions = await storage.getCashTransactionsByReceiptIds([receipt.id]);
      const cashEntriesToDelete = receiptCashTransactions.filter((transaction) => transaction.type === "IN");
      await storage.deleteCashTransactionByReceiptAndType(receipt.id, "IN");

      if (updated) {
        await writeAuditEntries({
          req,
          action: "UPDATE",
          entityType: "RECIBO",
          entityId: updated.id,
          before: receipt,
          after: updated,
        });
      }

      await Promise.all(
        cashEntriesToDelete.map((transaction) =>
          writeAuditEntries({
            req,
            action: "DELETE",
            entityType: "CAIXA",
            entityId: transaction.id,
            before: transaction,
          })
        )
      );

      res.json(updated);
    } catch (error) {
      console.error("Reverse payment error:", error);
      res.status(500).json({ error: "Erro ao estornar pagamento" });
    }
  });

  app.post("/api/receipts/:id/create-transfer", requirePermission("generate_transfer"), async (req, res) => {
    try {
      const receipt = await storage.getReceipt(getSingleParam(req.params.id));
      if (!receipt) return res.status(404).json({ error: "Recibo não encontrado" });
      if (receipt.status !== "paid" && receipt.status !== "closed") return res.status(400).json({ error: "Recibo deve estar fechado ou pago para gerar repasse" });

      // Verifica se já existe repasse para este recibo
      const existingTransfers = await storage.getLandlordTransfersByReceipt(receipt.id);
      if (existingTransfers.length > 0) {
        return res.status(400).json({ error: "Já existe um repasse gerado para este recibo" });
      }

      const contract = await storage.getContract(receipt.contractId);
      if (!contract) return res.status(404).json({ error: "Contrato não encontrado" });

      // Use the finalized receipt amount to keep transfer generation aligned
      // with the "Total Proprietario" already shown and persisted on the receipt.
      const landlordTotalForTransfer = Number(receipt.landlordTotalDue);

      const property = await storage.getProperty(contract.propertyId);
      const sharesRaw = ((property as any)?.landlordShares as Array<{ landlordId: string; percent: number }> | undefined) || [];
      const shares =
        Array.isArray(sharesRaw) && sharesRaw.length > 0
          ? sharesRaw
              .filter(s => !!s.landlordId && Number(s.percent) > 0)
              .map(s => ({ landlordId: s.landlordId, percent: Number(s.percent) }))
          : [{ landlordId: contract.landlordId, percent: 100 }];

      const splitAmounts = (() => {
        const totalCents = Math.round(Number(landlordTotalForTransfer) * 100);
        // 1) Prefer receipt landlordSplitOverride if present
        const override = (receipt as any).landlordSplitOverride as Array<{ landlordId: string; amount: number }> | undefined;
        if (Array.isArray(override) && override.length > 0) {
          const byId = new Map(override.map(o => [o.landlordId, Math.max(0, Math.round(Number(o.amount) * 100))]));
          const parts = shares.map(s => ({ landlordId: s.landlordId, amountCents: byId.get(s.landlordId) ?? 0 }));
          const sum = parts.reduce((acc, p) => acc + p.amountCents, 0);
          let diff = totalCents - sum;
          if (Math.abs(diff) <= 1) {
            if (diff !== 0) {
              // adjust the largest part by the diff
              const idx = parts.reduce((imax, p, i, arr) => (p.amountCents > arr[imax].amountCents ? i : imax), 0);
              parts[idx].amountCents += diff;
            }
            return parts;
          }
          // If difference is larger, scale proportionally and distribute rounding
          if (sum > 0) {
            const scaled = parts.map(p => ({ landlordId: p.landlordId, raw: (p.amountCents * totalCents) / sum }));
            const floors = scaled.map(s => ({ landlordId: s.landlordId, floor: Math.floor(s.raw), remainder: s.raw - Math.floor(s.raw) }));
            const sumFloor = floors.reduce((acc, f) => acc + f.floor, 0);
            let remaining = totalCents - sumFloor;
            const sorted = [...floors].sort((a, b) => b.remainder - a.remainder);
            for (let i = 0; i < sorted.length && remaining > 0; i++) {
              sorted[i].floor += 1;
              remaining -= 1;
            }
            return sorted.map(f => ({ landlordId: f.landlordId, amountCents: f.floor }));
          }
          // fallthrough to percent if sum==0
        }
        const sumPercent = shares.reduce((sum, s) => sum + Number(s.percent || 0), 0);
        if (totalCents === 0) return shares.map(s => ({ landlordId: s.landlordId, amountCents: 0 }));
        if (!sumPercent) return [{ landlordId: contract.landlordId, amountCents: totalCents }];

        const parts = shares.map(s => {
          const raw = (totalCents * s.percent) / sumPercent;
          const floor = Math.floor(raw);
          return { landlordId: s.landlordId, floor, remainder: raw - floor };
        });
        const sumFloor = parts.reduce((sum, p) => sum + p.floor, 0);
        let remaining = totalCents - sumFloor;
        const sorted = [...parts].sort((a, b) => b.remainder - a.remainder);
        for (let i = 0; i < sorted.length && remaining > 0; i++) {
          sorted[i].floor += 1;
          remaining -= 1;
        }
        return sorted.map(p => ({ landlordId: p.landlordId, amountCents: p.floor }));
      })();

      const createdTransfers = [];
      for (const part of splitAmounts) {
        const transfer = await storage.createLandlordTransfer({
          landlordId: part.landlordId,
          receiptId: receipt.id,
          amount: String((part.amountCents / 100).toFixed(2)),
          status: "pending",
        });
        createdTransfers.push(transfer);
      }
      
      // Removed automatic receipt status update to "transferred".
      // Receipt status should only change when transfer is actually paid.

      res.json(createdTransfers);
    } catch (error) {
      console.error("Create transfer error:", error);
      res.status(500).json({ error: "Erro ao criar repasse" });
    }
  });

  app.post("/api/transfers/batch-generate", requirePermission("generate_transfer"), async (req, res) => {
    try {
      const { receiptIds } = req.body;
      if (!Array.isArray(receiptIds) || receiptIds.length === 0) {
        return res.status(400).json({ error: "Lista de recibos inválida" });
      }

      const results = {
        success: 0,
        errors: 0,
        details: [] as any[]
      };

      for (const id of receiptIds) {
        try {
          const receipt = await storage.getReceipt(id);
          if (!receipt) throw new Error(`Recibo ${id} não encontrado`);
          
          if (receipt.status !== "paid" && receipt.status !== "closed") {
             throw new Error(`Recibo deve estar fechado ou pago (Status atual: ${receipt.status})`);
          }

          const existingTransfers = await storage.getLandlordTransfersByReceipt(receipt.id);
          if (existingTransfers.length > 0) {
            throw new Error(`Já existe repasse para este recibo`);
          }
          
          const contract = await storage.getContract(receipt.contractId);
          if (!contract) throw new Error(`Contrato não encontrado`);

          // Use the finalized receipt amount to keep batch transfer generation
          // aligned with the same value already persisted on the receipt.
          const landlordTotalForTransfer = Number(receipt.landlordTotalDue);
          
          const property = await storage.getProperty(contract.propertyId);
          const sharesRaw = ((property as any)?.landlordShares as Array<{ landlordId: string; percent: number }> | undefined) || [];
          const shares =
            Array.isArray(sharesRaw) && sharesRaw.length > 0
              ? sharesRaw
                  .filter(s => !!s.landlordId && Number(s.percent) > 0)
                  .map(s => ({ landlordId: s.landlordId, percent: Number(s.percent) }))
              : [{ landlordId: contract.landlordId, percent: 100 }];

          const splitAmounts = (() => {
            const totalCents = Math.round(Number(landlordTotalForTransfer) * 100);
            // Prefer landlordSplitOverride if present
            const override = (receipt as any).landlordSplitOverride as Array<{ landlordId: string; amount: number }> | undefined;
            if (Array.isArray(override) && override.length > 0) {
              const byId = new Map(override.map(o => [o.landlordId, Math.max(0, Math.round(Number(o.amount) * 100))]));
              const parts = shares.map(s => ({ landlordId: s.landlordId, amountCents: byId.get(s.landlordId) ?? 0 }));
              const sum = parts.reduce((acc, p) => acc + p.amountCents, 0);
              let diff = totalCents - sum;
              if (Math.abs(diff) <= 1) {
                if (diff !== 0) {
                  const idx = parts.reduce((imax, p, i, arr) => (p.amountCents > arr[imax].amountCents ? i : imax), 0);
                  parts[idx].amountCents += diff;
                }
                return parts;
              }
              if (sum > 0) {
                const scaled = parts.map(p => ({ landlordId: p.landlordId, raw: (p.amountCents * totalCents) / sum }));
                const floors = scaled.map(s => ({ landlordId: s.landlordId, floor: Math.floor(s.raw), remainder: s.raw - Math.floor(s.raw) }));
                const sumFloor = floors.reduce((acc, f) => acc + f.floor, 0);
                let remaining = totalCents - sumFloor;
                const sorted = [...floors].sort((a, b) => b.remainder - a.remainder);
                for (let i = 0; i < sorted.length && remaining > 0; i++) {
                  sorted[i].floor += 1;
                  remaining -= 1;
                }
                return sorted.map(f => ({ landlordId: f.landlordId, amountCents: f.floor }));
              }
            }
            const sumPercent = shares.reduce((sum, s) => sum + Number(s.percent || 0), 0);
            if (totalCents === 0) return shares.map(s => ({ landlordId: s.landlordId, amountCents: 0 }));
            if (!sumPercent) return [{ landlordId: contract.landlordId, amountCents: totalCents }];

            const parts = shares.map(s => {
              const raw = (totalCents * s.percent) / sumPercent;
              const floor = Math.floor(raw);
              return { landlordId: s.landlordId, floor, remainder: raw - floor };
            });
            const sumFloor = parts.reduce((sum, p) => sum + p.floor, 0);
            let remaining = totalCents - sumFloor;
            const sorted = [...parts].sort((a, b) => b.remainder - a.remainder);
            for (let i = 0; i < sorted.length && remaining > 0; i++) {
              sorted[i].floor += 1;
              remaining -= 1;
            }
            return sorted.map(p => ({ landlordId: p.landlordId, amountCents: p.floor }));
          })();

          for (const part of splitAmounts) {
            await storage.createLandlordTransfer({
              landlordId: part.landlordId,
              receiptId: receipt.id,
              amount: String((part.amountCents / 100).toFixed(2)),
              status: "pending",
            });
          }

          /* 
          // REMOVIDO: O status do recibo só deve mudar para 'transferred' quando o repasse for efetivamente PAGO.
          if (receipt.status === "paid") {
             await storage.updateReceipt(receipt.id, { status: "transferred" });
          }
          */

          results.success++;
          results.details.push({ id, status: "success" });
        } catch (err: any) {
          results.errors++;
          results.details.push({ id, status: "error", message: err.message });
        }
      }

      res.json(results);
    } catch (error) {
      console.error("Batch generate transfers error:", error);
      res.status(500).json({ error: "Erro ao gerar repasses em lote" });
    }
  });

  app.post("/api/receipts/batch-mark-paid", requirePermission("mark_receipt_paid"), async (req, res) => {
    try {
      const { receiptIds, paymentDate } = req.body;
      if (!Array.isArray(receiptIds) || receiptIds.length === 0) {
        return res.status(400).json({ error: "Lista de recibos inválida" });
      }

      const results = {
        success: 0,
        errors: 0,
        details: [] as any[]
      };

      for (const id of receiptIds) {
        try {
          const receipt = await storage.getReceipt(id);
          if (!receipt) throw new Error(`Recibo ${id} não encontrado`);
          
          if (receipt.status !== "closed" && receipt.status !== "transferred") {
            throw new Error(`Recibo deve estar fechado ou repassado (Status atual: ${receipt.status})`);
          }

          // Check if already paid (Cash IN exists or status is paid)
          const existingTransactions = await storage.getCashTransactionsByReceiptIds([receipt.id]);
          const hasPayment = existingTransactions.some((t) => t.type === "IN");
          
          if (hasPayment) {
             throw new Error("Recibo já possui pagamento registrado");
          }

          const newStatus = receipt.status === "closed" ? "paid" : receipt.status;
          const updatedReceipt = await storage.updateReceipt(receipt.id, { status: newStatus });

          if (updatedReceipt) {
            await writeAuditEntries({
              req,
              action: "UPDATE",
              entityType: "RECIBO",
              entityId: updatedReceipt.id,
              before: receipt,
              after: updatedReceipt,
            });
          }

          const createdCash = await storage.createCashTransaction({
            type: "IN",
            date: paymentDate || new Date().toISOString().split("T")[0],
            category: "Aluguel",
            description: `Pagamento recibo ${String(receipt.refMonth).padStart(2, "0")}/${receipt.refYear}`,
            amount: receipt.tenantTotalDue,
            receiptId: receipt.id,
          });
          await writeAuditEntries({
            req,
            action: "CREATE",
            entityType: "CAIXA",
            entityId: createdCash.id,
            after: createdCash,
          });

          results.success++;
          results.details.push({ id, status: "success" });
        } catch (err: any) {
          results.errors++;
          results.details.push({ id, status: "error", message: err.message });
        }
      }

      res.json(results);
    } catch (error) {
      console.error("Batch mark paid error:", error);
      res.status(500).json({ error: "Erro ao marcar recibos como pago em lote" });
    }
  });

  app.post("/api/receipts/batch-emit-slip", requireAuth, async (req, res) => {
    try {
      const { receiptIds } = req.body;
      if (!Array.isArray(receiptIds) || receiptIds.length === 0) {
        return res.status(400).json({ error: "Lista de recibos inválida" });
      }

      const results = {
        success: 0,
        errors: 0,
        details: [] as any[]
      };

      for (const id of receiptIds) {
        try {
          const receipt = await storage.getReceipt(id);
          if (!receipt) throw new Error(`Recibo ${id} não encontrado`);
          
          if (receipt.status === "draft") {
             throw new Error("Não é possível emitir boleto para recibo em rascunho");
          }

          if (receipt.isSlipIssued) {
             throw new Error("Boleto já emitido para este recibo");
          }

          const contract = await storage.getContract(receipt.contractId);
          if (!contract) throw new Error("Contrato não encontrado");

          const tenant = await storage.getTenant(contract.tenantId);
          if (!tenant) throw new Error("Locatário não encontrado");

          // Calculate Due Date
          let dataVencimento: string;
          if (receipt.dueDate) {
            dataVencimento = String(receipt.dueDate);
          } else {
            dataVencimento = calculateReceiptDueDate(receipt.refYear, receipt.refMonth, contract.dueDay);
          }
          
          // Calculate Fine Date (Next day)
          const fineDate = new Date(dataVencimento);
          fineDate.setDate(fineDate.getDate() + 1);
          const dataMulta = fineDate.toISOString().split('T')[0];

          // Seu Numero - Unique ID (10 digits from timestamp + random suffix to ensure uniqueness in batch)
          const seuNumero = Date.now().toString().slice(-6) + Math.floor(Math.random() * 10000).toString().padStart(4, '0');

          // Clean Tenant Data
          const cleanDoc = tenant.doc.replace(/\D/g, '');
          const cleanZip = tenant.zipCode?.replace(/\D/g, '') || "";

          const services = await storage.getServicesByContractAndRef(contract.id, receipt.refYear, receipt.refMonth);
          const servicesTenantTotalForSlip = services
            .filter((s: any) => s.chargedTo === "TENANT" && !(s as any).receiptDiscountTo)
            .reduce((sum, s) => sum + Number(s.amount), 0);
          const tenantDiscountFromRentForSlip = services
            .filter((s: any) => (s as any).discountFrom === "TENANT" || (s as any).isTribute)
            .reduce((sum, s) => sum + Number(s.amount), 0);
          const receiptDiscountTenantTotalForSlip = services
            .filter(
              (s: any) =>
                (s as any).receiptDiscountTo === "TENANT" ||
                (s as any).receiptDiscountTo === "BOTH"
            )
            .reduce((sum, s) => sum + Number(s.amount), 0);
          const tenantTotalDueForSlip = Math.max(
            0,
            Number(receipt.rentAmount) +
              servicesTenantTotalForSlip -
              tenantDiscountFromRentForSlip -
              receiptDiscountTenantTotalForSlip
          );

          const payload = {
            numeroCliente: 2457024,
            codigoModalidade: 1,
            numeroContaCorrente: 775886,
            codigoEspecieDocumento: "DM",
            dataEmissao: new Date().toISOString().split('T')[0],
            seuNumero: seuNumero,
            identificacaoEmissaoBoleto: 1,
            identificacaoDistribuicaoBoleto: 1,
            valor: Number(tenantTotalDueForSlip.toFixed(2)),
            dataVencimento: dataVencimento,
            tipoDesconto: 0,
            tipoMulta: 2,
            dataMulta: dataMulta,
            valorMulta: 10, 
            tipoJurosMora: 2,
            dataJurosMora: dataMulta,
            valorJurosMora: 0.3, 
            numeroParcela: 1,
            aceite: true,
            pagador: {
              numeroCpfCnpj: cleanDoc,
              nome: tenant.name,
              endereco: tenant.address || "Endereço não informado",
              bairro: tenant.neighborhood || "Centro",
              cidade: tenant.city,
              cep: cleanZip,
              uf: tenant.state,
              email: tenant.email || "email@naoinformado.com"
            },
            beneficiarioFinal: {
              numeroCpfCnpj: "57431088000113",
              nome: "Imobiliária Simões"
            },
            mensagensInstrucao: [
              `A partir de ${dataMulta.split('-').reverse().join('/')} Juros 0,03%/dia.`,
              `A partir de ${dataMulta.split('-').reverse().join('/')} Multa de 10%`,
              "Não conceder desconto."
            ],
            gerarPdf: true,
            codigoCadastrarPIX: 1,
            numeroContratoCobranca: 0
          };

          const result = await sicoobProvider.emitirBoleto(payload);

          // Handle PDF
          let slipPdfUrl = "";
          if (result.pdfBoleto) {
            const buffer = Buffer.from(result.pdfBoleto, 'base64');
            const fileName = `boleto-${receipt.id}.pdf`;
            const publicDir = path.join(process.cwd(), 'client', 'public', 'boletos');
            
            if (!fs.existsSync(publicDir)) {
              fs.mkdirSync(publicDir, { recursive: true });
            }
            
            fs.writeFileSync(path.join(publicDir, fileName), buffer);
            slipPdfUrl = `/boletos/${fileName}`;
          }

          // Update Receipt
          const digitableLine = result.resultado?.linhaDigitavel || result.linhaDigitavel;
          let barcode = result.resultado?.codigoBarra || result.codigoBarra;
          
          if (!barcode && digitableLine) {
            barcode = digitableToBarcode(digitableLine);
          }

          await storage.updateReceipt(receipt.id, {
            tenantTotalDue: String(tenantTotalDueForSlip.toFixed(2)),
            isSlipIssued: true,
            slipPdfUrl: slipPdfUrl,
            slipOurNumber: seuNumero,
            slipDigitableLine: digitableLine,
            slipBarcode: barcode,
          });

          results.success++;
          results.details.push({ id, status: "success" });
        } catch (err: any) {
          console.error(`Error emitting slip for receipt ${id}:`, err);
          results.errors++;
          results.details.push({ id, status: "error", message: err.message });
        }
      }

      res.json(results);
    } catch (error) {
      console.error("Batch emit slip error:", error);
      res.status(500).json({ error: "Erro ao emitir boletos em lote" });
    }
  });

  const calculateSplitAmounts = (
    owners: Array<{ landlordId: string; percent: number }>,
    totalAmount: number,
  ) => {
    const totalCents = Math.round(totalAmount * 100);
    const selectedPercentSum = owners.reduce((sum, o) => sum + Number(o.percent || 0), 0);
    const targetTotalCents = Math.round((totalCents * selectedPercentSum) / 100);

    const parts = owners.map((o) => {
      const raw = (totalCents * o.percent) / 100;
      const floor = Math.floor(raw);
      return { landlordId: o.landlordId, percent: o.percent, floor, remainder: raw - floor };
    });

    const sumFloor = parts.reduce((sum, p) => sum + p.floor, 0);
    let remaining = targetTotalCents - sumFloor;
    const sorted = [...parts].sort((a, b) => b.remainder - a.remainder);
    for (let i = 0; i < sorted.length && remaining > 0; i++) {
      sorted[i].floor += 1;
      remaining -= 1;
    }
    return sorted;
  };

  const getLandlordNfseBaseAmount = async (receipt: any, contract: any) => {
    const services = await storage.getServicesByContractAndRef(contract.id, receipt.refYear, receipt.refMonth);
    const additionalAmount = services
      .filter((service: any) => {
        if (service.chargedTo !== "TENANT") return false;
        return isCondominiumOrIptuService(service.description);
      })
      .reduce((sum, service) => sum + Number(service.amount || 0), 0);

    return Number(receipt.rentAmount || 0) + additionalAmount;
  };

  const recomputeInvoiceFlags = async (receiptId: string) => {
    const allInvoices = await storage.getInvoices();
    const receiptInvoices = allInvoices.filter(
      (i) => i.receiptId === receiptId && isAdministracaoInvoice(i),
    );
    const nonCancelled = receiptInvoices.filter(i => i.status !== "cancelled");
    const isInvoiceGenerated = nonCancelled.length > 0;
    const isInvoiceIssued = isInvoiceGenerated && nonCancelled.every(i => i.status === "issued");
    const isInvoiceCancelled = receiptInvoices.some(i => i.status === "cancelled") && !isInvoiceGenerated;
    await storage.updateReceipt(receiptId, {
      isInvoiceGenerated,
      isInvoiceIssued,
      isInvoiceCancelled,
    });
  };

  app.post("/api/receipts/:id/create-invoice", requireAuth, async (req, res) => {
    try {
      const receipt = await storage.getReceipt(getSingleParam(req.params.id));
      if (!receipt) return res.status(404).json({ error: "Recibo não encontrado" });
      if (receipt.status !== "paid" && receipt.status !== "transferred") {
        return res.status(400).json({ error: "Recibo deve estar pago ou repassado para emitir NF" });
      }

      const contract = await storage.getContract(receipt.contractId);
      if (!contract) return res.status(404).json({ error: "Contrato não encontrado" });

      // Use stored admin fee amount directly to avoid recalculation discrepancies
      const adminFeeAmountForInvoice = Number(receipt.adminFeeAmount);

      const property = await storage.getProperty(contract.propertyId);
      const sharesRaw = ((property as any)?.landlordShares as Array<{ landlordId: string; percent: number }> | undefined) || [];
      const owners =
        Array.isArray(sharesRaw) && sharesRaw.length > 0
          ? sharesRaw
              .filter(s => !!s.landlordId && Number(s.percent) > 0)
              .map(s => ({ landlordId: s.landlordId, percent: Number(s.percent) }))
          : [{ landlordId: contract.landlordId, percent: 100 }];

      const selectedLandlordIds = Array.isArray(req.body?.landlordIds)
        ? (req.body.landlordIds as string[])
        : owners.map(o => o.landlordId);

      const selectedOwners = owners.filter(o => selectedLandlordIds.includes(o.landlordId));
      if (selectedOwners.length === 0) {
        return res.status(400).json({ error: "Selecione ao menos um proprietário para gerar a NF." });
      }

      const existingInvoices = (await storage.getInvoices()).filter(i => i.receiptId === receipt.id);
      const existingAdminInvoices = existingInvoices.filter(isAdministracaoInvoice);
      const existingByLandlord = new Set(
        existingAdminInvoices.filter(i => i.status !== "cancelled").map(i => i.landlordId),
      );
      const sorted = calculateSplitAmounts(selectedOwners, adminFeeAmountForInvoice);

      const created: any[] = [];
      const skipped: any[] = [];
      for (const p of sorted) {
        if (existingByLandlord.has(p.landlordId)) {
          skipped.push({ landlordId: p.landlordId, reason: "INVOICE_ALREADY_EXISTS" });
          continue;
        }
        const invoice = await storage.createInvoice({
          landlordId: p.landlordId,
          receiptId: receipt.id,
          amount: String((p.floor / 100).toFixed(2)),
          invoiceCategory: ADMINISTRACAO_INVOICE_CATEGORY,
          status: "draft",
        });
        created.push(invoice);
      }

      await recomputeInvoiceFlags(receipt.id);

      res.json({ created, skipped });
    } catch (error) {
      console.error("Create invoice error:", error);
      res.status(500).json({ error: "Erro ao criar nota fiscal" });
    }
  });

  app.post("/api/receipts/:id/create-landlord-nfse", requireAuth, async (req, res) => {
    try {
      const receipt = await storage.getReceipt(getSingleParam(req.params.id));
      if (!receipt) return res.status(404).json({ error: "Recibo não encontrado" });
      if (receipt.status !== "paid" && receipt.status !== "transferred") {
        return res.status(400).json({ error: "Recibo deve estar pago ou repassado para gerar a NFS-e do proprietário" });
      }

      const contract = await storage.getContract(receipt.contractId);
      if (!contract) return res.status(404).json({ error: "Contrato não encontrado" });

      const property = await storage.getProperty(contract.propertyId);
      const sharesRaw = ((property as any)?.landlordShares as Array<{ landlordId: string; percent: number }> | undefined) || [];
      const owners =
        Array.isArray(sharesRaw) && sharesRaw.length > 0
          ? sharesRaw
              .filter((s) => !!s.landlordId && Number(s.percent) > 0)
              .map((s) => ({ landlordId: s.landlordId, percent: Number(s.percent) }))
          : [{ landlordId: contract.landlordId, percent: 100 }];

      const selectedLandlordIds = Array.isArray(req.body?.landlordIds)
        ? (req.body.landlordIds as string[])
        : owners.map((o) => o.landlordId);

      const selectedOwners = owners.filter((o) => selectedLandlordIds.includes(o.landlordId));
      if (selectedOwners.length === 0) {
        return res.status(400).json({ error: "Selecione ao menos um proprietário para gerar a NFS-e do proprietário." });
      }

      const landlords = await storage.getLandlords();
      const landlordById = new Map(landlords.map((landlord) => [landlord.id, landlord]));
      for (const owner of selectedOwners) {
        const landlord = landlordById.get(owner.landlordId);
        const validationError = validateLandlordNfseProfile(landlord);
        if (validationError) {
          return res.status(400).json({ error: `${landlord?.name || "Proprietário"}: ${validationError}` });
        }
      }

      const baseAmount = await getLandlordNfseBaseAmount(receipt, contract);
      if (baseAmount <= 0) {
        return res.status(400).json({ error: "Não foi possível calcular a base da NFS-e do proprietário. Verifique aluguel, IPTU e condomínio do recibo." });
      }

      const existingInvoices = (await storage.getInvoices()).filter(
        (invoice) => invoice.receiptId === receipt.id && isLandlordNfseInvoice(invoice),
      );
      const existingByLandlord = new Set(
        existingInvoices.filter((invoice) => invoice.status !== "cancelled").map((invoice) => invoice.landlordId),
      );

      const sorted = calculateSplitAmounts(selectedOwners, baseAmount);
      const created: any[] = [];
      const skipped: any[] = [];

      for (const part of sorted) {
        if (existingByLandlord.has(part.landlordId)) {
          skipped.push({ landlordId: part.landlordId, reason: "LANDLORD_NFSE_ALREADY_EXISTS" });
          continue;
        }

        const invoice = await storage.createInvoice({
          landlordId: part.landlordId,
          receiptId: receipt.id,
          amount: String((part.floor / 100).toFixed(2)),
          invoiceCategory: LANDLORD_NFSE_INVOICE_CATEGORY,
          status: "draft",
        });
        created.push(invoice);
      }

      res.json({ created, skipped });
    } catch (error) {
      console.error("Create landlord NFSe error:", error);
      res.status(500).json({ error: "Erro ao criar NFS-e do proprietário" });
    }
  });

  app.get("/api/receipts/:id/transfers", requireAuth, async (req, res) => {
    try {
      const transfers = await storage.getLandlordTransfersByReceipt(getSingleParam(req.params.id));
      res.json(transfers);
    } catch (error) {
      console.error("Get receipt transfers error:", error);
      res.status(500).json({ error: "Erro ao buscar repasses do recibo" });
    }
  });

  app.patch("/api/receipts/:id/transfer-splits", requirePermission("generate_transfer"), async (req, res) => {
    try {
      const receiptId = getSingleParam(req.params.id);
      const splits = req.body?.splits as Array<{ id: string; amount: number }> | undefined;
      if (!Array.isArray(splits) || splits.length === 0) {
        return res.status(400).json({ error: "Lista de rateio inválida" });
      }

      const existing = await storage.getLandlordTransfersByReceipt(receiptId);
      if (existing.length === 0) {
        return res.status(400).json({ error: "Recibo não possui repasses para editar" });
      }

      const existingById = new Map(existing.map(t => [t.id, t]));
      const existingTotal = existing.reduce((sum, t) => sum + Number(t.amount), 0);
      const newTotal = splits.reduce((sum, s) => sum + Number(s.amount), 0);
      if (Math.abs(existingTotal - newTotal) > 0.01) {
        return res.status(400).json({ error: "A soma do rateio deve permanecer igual ao total do repasse atual." });
      }

      const updated = [];
      for (const s of splits) {
        const transfer = existingById.get(s.id);
        if (!transfer) {
          return res.status(400).json({ error: "Repasse inválido na lista." });
        }
        if (transfer.status !== "pending") {
          return res.status(400).json({ error: "Só é possível editar rateio de repasses pendentes." });
        }
        const amountNum = Number(s.amount);
        if (!Number.isFinite(amountNum)) {
          return res.status(400).json({ error: "Valor inválido no rateio." });
        }
        const result = await storage.updateLandlordTransfer(transfer.id, {
          amount: String(amountNum.toFixed(2)),
        });
        if (result) updated.push(result);
      }

      res.json(updated);
    } catch (error) {
      console.error("Update transfer splits error:", error);
      res.status(500).json({ error: "Erro ao atualizar rateio do repasse" });
    }
  });

  app.patch("/api/receipts/:id/split-override", requirePermission("generate_transfer"), async (req, res) => {
    try {
      const receipt = await storage.getReceipt(getSingleParam(req.params.id));
      if (!receipt) return res.status(404).json({ error: "Recibo não encontrado" });
      if (receipt.status === "draft") return res.status(400).json({ error: "Feche o recibo antes de ajustar o rateio." });

      const splits = req.body?.splits as Array<{ landlordId: string; amount: number }> | undefined;
      if (!Array.isArray(splits) || splits.length === 0) {
        return res.status(400).json({ error: "Lista de rateio inválida" });
      }

      const contract = await storage.getContract(receipt.contractId);
      const property = contract ? await storage.getProperty(contract.propertyId) : undefined;
      if (!property) return res.status(400).json({ error: "Imóvel não encontrado para o recibo." });

      const sharesRaw = ((property as any)?.landlordShares as Array<{ landlordId: string; percent: number }> | undefined) || [];
      const owners =
        Array.isArray(sharesRaw) && sharesRaw.length > 0
          ? sharesRaw
          : contract
            ? [{ landlordId: contract.landlordId, percent: 100 }]
            : [];
      if (owners.length <= 1) {
        return res.status(400).json({ error: "Rateio só é aplicável quando há mais de um proprietário." });
      }

      const ownerIds = new Set(owners.map(o => o.landlordId));
      for (const s of splits) {
        if (!ownerIds.has(s.landlordId)) {
          return res.status(400).json({ error: "Rateio contém proprietário inválido." });
        }
        if (!Number.isFinite(Number(s.amount)) || Number(s.amount) < 0) {
          return res.status(400).json({ error: "Valor inválido no rateio." });
        }
      }

      const totalOverride = splits.reduce((sum, s) => sum + Number(s.amount), 0);
      if (totalOverride <= 0) return res.status(400).json({ error: "Soma do rateio deve ser maior que zero." });

      const currentReceipt = receipt;
      const updatedReceipt = await storage.updateReceipt(receipt.id, { landlordSplitOverride: splits as any });
      if (updatedReceipt) {
        await writeAuditEntries({
          req,
          action: "UPDATE",
          entityType: "RECIBO",
          entityId: updatedReceipt.id,
          before: currentReceipt,
          after: updatedReceipt,
        });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Save split override error:", error);
      res.status(500).json({ error: "Erro ao salvar rateio prévio" });
    }
  });

  app.get("/api/cash", requireAuth, async (req, res) => {
    try {
      const { month, year } = req.query;
      let startDate, endDate;

      if (month && year) {
        const m = parseInt(month as string);
        const y = parseInt(year as string);
        if (!isNaN(m) && !isNaN(y)) {
           startDate = `${y}-${String(m).padStart(2, '0')}-01`;
           const lastDay = new Date(y, m, 0).getDate();
           endDate = `${y}-${String(m).padStart(2, '0')}-${lastDay}`;
        }
      }

      const transactions = await storage.getCashTransactions(startDate, endDate);
      res.json(transactions);
    } catch (error) {
      console.error("Get cash error:", error);
      res.status(500).json({ error: "Erro ao buscar transações" });
    }
  });

  app.post("/api/cash", requireAuth, async (req, res) => {
    try {
      const transaction = await storage.createCashTransaction(req.body);
      await writeAuditEntries({
        req,
        action: "CREATE",
        entityType: "CAIXA",
        entityId: transaction.id,
        after: transaction,
      });
      res.status(201).json(transaction);
    } catch (error) {
      console.error("Create cash error:", error);
      res.status(500).json({ error: "Erro ao criar transação" });
    }
  });

  app.patch("/api/cash/:id", requirePermission("edit_transaction"), async (req, res) => {
    try {
      await assertEditableFieldsAllowed(req, "edit_transaction", req.body);
      const currentTransaction = await storage.getCashTransaction(getSingleParam(req.params.id));
      if (!currentTransaction) return res.status(404).json({ error: "Transação não encontrada" });
      const transaction = await storage.updateCashTransaction(getSingleParam(req.params.id), req.body);
      if (!transaction) return res.status(404).json({ error: "Transação não encontrada" });
      await writeAuditEntries({
        req,
        action: "UPDATE",
        entityType: "CAIXA",
        entityId: transaction.id,
        before: currentTransaction,
        after: transaction,
      });
      res.json(transaction);
    } catch (error: any) {
      if (error?.statusCode) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      console.error("Update cash error:", error);
      res.status(500).json({ error: "Erro ao atualizar transação" });
    }
  });

  app.delete("/api/cash/:id", requireAuth, async (req, res) => {
    try {
      const transaction = await storage.getCashTransaction(getSingleParam(req.params.id));
      if (!transaction) return res.status(404).json({ error: "Transação não encontrada" });

      if (transaction.receiptId) {
        return res.status(400).json({ 
          error: "Não é possível excluir manualmente uma transação vinculada a um recibo. Ela será excluída automaticamente se o pagamento do recibo for estornado." 
        });
      }

      await storage.deleteCashTransaction(getSingleParam(req.params.id));
      await writeAuditEntries({
        req,
        action: "DELETE",
        entityType: "CAIXA",
        entityId: transaction.id,
        before: transaction,
      });
      res.json({ success: true });
    } catch (error) {
      console.error("Delete cash error:", error);
      res.status(500).json({ error: "Erro ao excluir transação" });
    }
  });

  app.get("/api/transfers", requireAuth, async (req, res) => {
    try {
      const { month, year } = req.query;
      const m = month ? parseInt(month as string) : undefined;
      const y = year ? parseInt(year as string) : undefined;

      const transfers = await storage.getEnrichedLandlordTransfers(m, y);
      res.json(transfers);
    } catch (error) {
      console.error("Get transfers error:", error);
      res.status(500).json({ error: "Erro ao buscar repasses" });
    }
  });

  const resolveNfseRuntimeProfile = async (origemTipo: string, origemId: string) => {
    if (origemTipo === LANDLORD_NFSE_ORIGIN_TYPE) {
      const invoice = await storage.getInvoice(origemId);
      if (!invoice) throw new Error("Registro da NFS-e do proprietário não encontrado.");

      const landlord = await storage.getLandlord(invoice.landlordId);
      if (!landlord) throw new Error("Proprietário emissor não encontrado.");

      const validationError = validateLandlordNfseProfile(landlord);
      if (validationError) throw new Error(validationError);

      const globalConfig = await storage.getNfseConfig();

      return {
        namespaceId: `landlord:${landlord.id}`,
        aliquotaIss: String(landlord.nfseIssRate || globalConfig?.aliquotaIss || "0"),
        descricaoServicoPadrao: "Recebimento de aluguel conforme contrato de locação",
      };
    }

    const config = await storage.getNfseConfig();
    if (!config) throw new Error("NFS-e não configurada");

    return {
      namespaceId: `global:${config.id}`,
      aliquotaIss: String(config.aliquotaIss || "0"),
      descricaoServicoPadrao: config.descricaoServicoPadrao || "Serviço de administração de imóveis",
    };
  };

  // --- Rotas NFS-e ---

  app.get("/api/nfse/config", requireAuth, async (req, res) => {
    try {
      const config = await storage.getNfseConfig();
      res.json(config || {});
    } catch (error) {
      console.error("Get NFS-e config error:", error);
      res.status(500).json({ error: "Erro ao buscar configuração NFS-e" });
    }
  });

  app.post("/api/nfse/config", requireAuth, async (req, res) => {
    try {
      const config = await storage.upsertNfseConfig(req.body);
      res.json(config);
    } catch (error) {
      console.error("Upsert NFS-e config error:", error);
      res.status(500).json({ error: "Erro ao salvar configuração NFS-e" });
    }
  });

  app.get("/api/nfse/emissoes", requireAuth, async (req, res) => {
    try {
      const emissoes = await storage.getNfseEmissoes();
      res.json(emissoes.map((emissao) => normalizeEmissaoNumeroNfse(emissao)));
    } catch (error) {
      console.error("Get NFS-e emissoes error:", error);
      res.status(500).json({ error: "Erro ao buscar emissões NFS-e" });
    }
  });

  app.get("/api/nfse/emissoes/:id", requireAuth, async (req, res) => {
    try {
      const emissao = await storage.getNfseEmissao(getSingleParam(req.params.id));
      if (!emissao) return res.status(404).json({ error: "Emissão não encontrada" });
      res.json(normalizeEmissaoNumeroNfse(emissao));
    } catch (error) {
      console.error("Get NFS-e emissao error:", error);
      res.status(500).json({ error: "Erro ao buscar emissão NFS-e" });
    }
  });

  app.post("/api/nfse/lotes", requireAuth, async (req, res) => {
    try {
      const { itens } = req.body; // Array of items
      if (!Array.isArray(itens) || itens.length === 0) {
        return res.status(400).json({ error: "Lista de itens inválida ou vazia" });
      }

      if (itens.length === 1) {
        // Emissão individual disparada pela tela de notas: isola o clique manual
        // para o worker não processar outras pendências em paralelo.
        nfseWorker.pauseTemporarily(60000, "emissao manual individual");
      }

      const crypto = await import('crypto');
      const loteItensToCreate: any[] = [];
      let valorTotalLote = 0;

      // 1. Validate and Prepare items
      for (const item of itens) {
         // Validação mais rigorosa
         if (!item.origemId || !item.origemTipo || !item.valor || !item.tomadorCpfCnpj || !item.tomadorNome) {
             console.error("Item inválido no lote (dados incompletos):", item);
             continue;
         }

         const valorNum = Number(item.valor);
         if (isNaN(valorNum)) {
             console.error("Item com valor não numérico:", item);
             continue;
         }

         const runtimeProfile = await resolveNfseRuntimeProfile(item.origemTipo, item.origemId);
         const idempotencyKey = crypto.createHash('sha256')
            .update(`${runtimeProfile.namespaceId}-${item.origemId}-${item.valor}-${new Date().getMonth()}-${item.origemTipo}-LOTE`)
            .digest('hex');

         // Check for duplicates
         const existing = await storage.getNfseEmissaoByIdempotency(idempotencyKey);
         const existingStatus = existing ? getNormalizedEmissaoStatus(existing) : null;
         if (existing && (existingStatus === 'EMITIDA' || existingStatus === 'ENVIANDO')) {
            console.warn(`Skipping duplicate emission for ${item.origemId}`);
            continue; 
         }

         valorTotalLote += valorNum;
         const valorIssNum = valorNum * (Number(runtimeProfile.aliquotaIss) / 100);
         
        let discriminacao = item.discriminacao || runtimeProfile.descricaoServicoPadrao;
        if (item.origemTipo === LANDLORD_NFSE_ORIGIN_TYPE) {
          const invoice = await storage.getInvoice(item.origemId);
          const receipt = invoice?.receiptId ? await storage.getReceipt(invoice.receiptId) : undefined;
          const contract = receipt ? await storage.getContract(receipt.contractId) : undefined;
          const property = contract ? await storage.getProperty(contract.propertyId) : undefined;
          discriminacao = buildLandlordNfseDescription({ receipt, property, contract });
        }

        loteItensToCreate.push({
            ...item,
            idempotencyKey,
            valorServico: valorNum.toFixed(2),
            valorIss: valorIssNum.toFixed(2),
            baseCalculo: valorNum.toFixed(2),
            aliquotaIss: String(runtimeProfile.aliquotaIss),
           discriminacao,
         });
      }

      if (loteItensToCreate.length === 0) {
        return res.status(400).json({ error: "Nenhum item válido para emitir (possíveis duplicatas ou dados inválidos)" });
      }

      // 2. Create Lote
      console.log("Creating lote with status: CRIADO");
      const lote = await storage.createNfseLote({
        criadoPorUsuarioId: req.session.userId || null,
        qtdItens: loteItensToCreate.length,
        valorTotal: valorTotalLote.toFixed(2),
        status: "CRIADO"
      });

      // 3. Create Emissions linked to Lote
      const createdEmissions = [];
      const errors = [];
      
      for (const item of loteItensToCreate) {
        try {
            // Check if emission already exists for this idempotency key
            const existing = await storage.getNfseEmissaoByIdempotency(item.idempotencyKey);
            const existingStatus = existing ? getNormalizedEmissaoStatus(existing) : null;
            const landlordTomadorPayload =
              item.origemTipo === LANDLORD_NFSE_ORIGIN_TYPE
                ? await buildLandlordNfseTomadorPayloadByInvoiceId(item.origemId)
                : null;
            const landlordPropertyPayload =
              item.origemTipo === LANDLORD_NFSE_ORIGIN_TYPE
                ? await buildLandlordNfsePropertyPayloadByInvoiceId(item.origemId)
                : null;
            
            if (existing) {
                if (existingStatus === 'EMITIDA' || existingStatus === 'ENVIANDO') {
                    console.log(`Emissão ${existing.id} já processada. Ignorando.`);
                    createdEmissions.push(existing);
                    continue;
                }
                
                // Reuse existing emission, update loteId and status
                console.log(`Reusing existing emission ${existing.id} for new lote`);
                const updated = await storage.updateNfseEmissao(existing.id, {
                    loteId: lote.id,
                    status: "PENDENTE",
                    ...(landlordTomadorPayload || {}),
                    ...(landlordPropertyPayload || {}),
                    updatedAt: new Date()
                });
                if (updated) createdEmissions.push(updated);
            } else {
                // Create new
                const emissao = await storage.createNfseEmissao({
                  loteId: lote.id,
                  status: "PENDENTE",
                  idempotencyKey: item.idempotencyKey,
                  valorServico: item.valorServico,
                  valorIss: item.valorIss,
                  aliquotaIss: item.aliquotaIss,
                  baseCalculo: item.baseCalculo,
                  descricaoServico: item.discriminacao,
                  tomadorCpfCnpj: landlordTomadorPayload?.tomadorCpfCnpj || item.tomadorCpfCnpj,
                  tomadorNome: landlordTomadorPayload?.tomadorNome || item.tomadorNome,
                  tomadorEmail: landlordTomadorPayload?.tomadorEmail || null,
                  tomadorEnderecoJson: landlordTomadorPayload?.tomadorEnderecoJson || null,
                  imovelEnderecoJson: landlordPropertyPayload?.imovelEnderecoJson || null,
                  origemId: item.origemId,
                  origemTipo: item.origemTipo
                });
                createdEmissions.push(emissao);
            }
        } catch (err) {
            console.error("Erro ao criar emissão individual:", err, item);
            errors.push({ item, error: err instanceof Error ? err.message : String(err) });
        }
      }

      res.status(201).json({ lote, emissoes: createdEmissions, errors });
    } catch (error) {
      console.error("Create Batch NFS-e error:", error);
      if (error instanceof Error) {
          console.error("Stack trace:", error.stack);
      }
      res.status(500).json({ error: "Erro ao criar lote de NFS-e", details: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/nfse/emitir", requireAuth, async (req, res) => {
    try {
      // Espera receber dados para criar a emissão. 
      // Pode vir de um recibo (comissao) ou avulso.
      // Exemplo payload: { origemId: '...', origemTipo: 'COMISSAO', valor: 100, ... }
      
      const { origemId, origemTipo, valor, tomadorNome, tomadorCpfCnpj, discriminacao } = req.body;

      if (!origemId || !origemTipo || !valor) {
        return res.status(400).json({ error: "Dados incompletos para emissão" });
      }

      // Idempotência

      const crypto = await import('crypto');
      const runtimeProfile = await resolveNfseRuntimeProfile(origemTipo, origemId);
      const idempotencyKey = crypto.createHash('sha256')
        .update(`${runtimeProfile.namespaceId}-${origemId}-${valor}-${new Date().getMonth()}-${origemTipo}`)
        .digest('hex');

      const existing = await storage.getNfseEmissaoByIdempotency(idempotencyKey);
      if (existing) {
         if (existing.status === 'EMITIDA' || existing.status === 'ENVIANDO') {
           return res.status(409).json({ error: "Nota já emitida ou em processamento", emissao: existing });
         }
         // Se falhou ou pendente, pode tentar de novo (retorna a existente para reprocessar)
         return res.json(existing);
      }

      // Criar Lote para esta emissão (requisito: um lote por clique/emissão ou agrupado)
      console.log("Creating single lote with status: CRIADO");
      const lote = await storage.createNfseLote({
        criadoPorUsuarioId: req.session.userId || null,
        qtdItens: 1,
        valorTotal: Number(valor).toFixed(2),
        status: "CRIADO"
      });

      const landlordTomadorPayload =
        origemTipo === LANDLORD_NFSE_ORIGIN_TYPE
          ? await buildLandlordNfseTomadorPayloadByInvoiceId(origemId)
          : null;
      const landlordPropertyPayload =
        origemTipo === LANDLORD_NFSE_ORIGIN_TYPE
          ? await buildLandlordNfsePropertyPayloadByInvoiceId(origemId)
          : null;

      // Criar nova emissão
      const emissao = await storage.createNfseEmissao({
        loteId: lote.id,
        status: "PENDENTE",
        idempotencyKey,
        valorServico: Number(valor).toFixed(2),
        valorIss: (Number(valor) * (Number(runtimeProfile.aliquotaIss) / 100)).toFixed(2),
        aliquotaIss: runtimeProfile.aliquotaIss,
        baseCalculo: Number(valor).toFixed(2),
        descricaoServico: discriminacao || runtimeProfile.descricaoServicoPadrao,
        tomadorCpfCnpj: landlordTomadorPayload?.tomadorCpfCnpj || tomadorCpfCnpj,
        tomadorNome: landlordTomadorPayload?.tomadorNome || tomadorNome,
        tomadorEmail: landlordTomadorPayload?.tomadorEmail || null,
        tomadorEnderecoJson: landlordTomadorPayload?.tomadorEnderecoJson || null,
        imovelEnderecoJson: landlordPropertyPayload?.imovelEnderecoJson || null,
        origemId,
        origemTipo
      });

      res.status(201).json(emissao);
    } catch (error) {
      console.error("Emitir NFS-e error:", error);
      res.status(500).json({ error: "Erro ao criar emissão NFS-e", details: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/nfse/lotes/:id", requireAuth, async (req, res) => {
    try {
      const loteId = req.params.id as string;
      const lote = await storage.getNfseLote(loteId);
      if (!lote) return res.status(404).json({ error: "Lote não encontrado" });
      
      const emissoes = await storage.getNfseEmissoesByLote(lote.id);
      res.json({ lote, emissoes });
    } catch (error) {
      console.error("Get Lote NFS-e error:", error);
      res.status(500).json({ error: "Erro ao buscar lote NFS-e" });
    }
  });

  app.get("/api/nfse/emissoes/:id", requireAuth, async (req, res) => {
    try {
      const emissaoId = req.params.id as string;
      const emissao = await storage.getNfseEmissao(emissaoId);
      if (!emissao) return res.status(404).json({ error: "Emissão não encontrada" });
      res.json(emissao);
    } catch (error) {
      console.error("Get Emissão NFS-e error:", error);
      res.status(500).json({ error: "Erro ao buscar emissão NFS-e" });
    }
  });



  app.post("/api/nfse/lotes/:id/processar", requireAuth, async (req, res) => {
    try {
      const loteId = req.params.id as string;
      const lote = await storage.getNfseLote(loteId);
      if (!lote) return res.status(404).json({ error: "Lote não encontrado" });
      
      const emissoes = await storage.getNfseEmissoesByLote(lote.id);
      const results = [];

      for (const emissao of emissoes) {
        if (emissao.status === "PENDENTE" || emissao.status === "FALHOU") {
          const result = await new NfseNationalProvider().emitirNfse(emissao.id);
          results.push({ id: emissao.id, result });
        }
      }

      res.json({ message: "Processamento iniciado", results });
    } catch (error) {
      console.error("Processar Lote NFS-e error:", error);
      res.status(500).json({ error: "Erro ao processar lote NFS-e" });
    }
  });

  app.post("/api/nfse/emissoes/:id/processar", requireAuth, async (req, res) => {
    try {
      const emissaoId = req.params.id as string;
      nfseWorker.pauseTemporarily(60000, `processamento manual da emissao ${emissaoId}`);
      const current = await storage.getNfseEmissao(emissaoId);
      if (!current) return res.status(404).json({ error: "Emissão não encontrada" });
      const currentStatus = getNormalizedEmissaoStatus(current);
      // #region debug-point A:processar-entry
      debugNfseReprocess("pre-fix", "A", "server/routes.ts:/api/nfse/emissoes/:id/processar:entry", "Entrou na rota de reprocessamento", {
        emissaoId,
        currentStatusRaw: current.status,
        currentStatusNormalized: currentStatus,
        erroCodigo: current.erroCodigo || null,
        erroMensagem: current.erroMensagem || null,
        updatedAt: current.updatedAt ? new Date(current.updatedAt).toISOString() : null,
      });
      // #endregion
      if (currentStatus === "EMITIDA") {
        // #region debug-point A:processar-block-emitted
        debugNfseReprocess("pre-fix", "A", "server/routes.ts:/api/nfse/emissoes/:id/processar:emitted-block", "Bloqueou reprocessamento por status EMITIDA", {
          emissaoId,
          currentStatusRaw: current.status,
          currentStatusNormalized: currentStatus,
        });
        // #endregion
        return res.status(409).json({ error: "Emissão já em processamento ou emitida", emissao: normalizeEmissaoNumeroNfse(current) });
      }
      if (current.status === "ENVIANDO" && (currentStatus === "FALHOU" || shouldReleaseSendingEmission(current))) {
        // #region debug-point B:processar-release-sending
        debugNfseReprocess("pre-fix", "B", "server/routes.ts:/api/nfse/emissoes/:id/processar:release", "Liberando emissao travada em ENVIANDO", {
          emissaoId,
          currentStatusRaw: current.status,
          currentStatusNormalized: currentStatus,
          shouldRelease: shouldReleaseSendingEmission(current),
        });
        // #endregion
        await storage.updateNfseEmissao(emissaoId, {
          status: "FALHOU",
          updatedAt: new Date(),
        });
      } else if (current.status === "ENVIANDO") {
        // #region debug-point B:processar-block-sending
        debugNfseReprocess("pre-fix", "B", "server/routes.ts:/api/nfse/emissoes/:id/processar:sending-block", "Bloqueou reprocessamento por ENVIANDO ativo", {
          emissaoId,
          currentStatusRaw: current.status,
          currentStatusNormalized: currentStatus,
          shouldRelease: shouldReleaseSendingEmission(current),
        });
        // #endregion
        return res.status(409).json({
          error: "Emissão ainda está em processamento neste momento. Aguarde alguns instantes e tente novamente.",
          emissao: normalizeEmissaoNumeroNfse(current),
        });
      }
      // #region debug-point C:processar-before-provider
      debugNfseReprocess("pre-fix", "C", "server/routes.ts:/api/nfse/emissoes/:id/processar:before-provider", "Chamando provider.emitirNfse", {
        emissaoId,
      });
      // #endregion
      const result = await new NfseNationalProvider().emitirNfse(emissaoId);
      // #region debug-point C:processar-provider-result
      debugNfseReprocess("pre-fix", "C", "server/routes.ts:/api/nfse/emissoes/:id/processar:provider-result", "Provider retornou do reprocessamento", {
        emissaoId,
        success: result.success,
        message: result.message || null,
      });
      // #endregion
      if (result.success) {
        res.json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (error: any) {
      console.error("Processar NFS-e error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/nfse/emissoes/:id/cancelar", requireAuth, async (req, res) => {
    try {
      const { motivo } = req.body;
      if (!motivo) return res.status(400).json({ error: "Motivo é obrigatório" });

      const emissaoId = req.params.id as string;
      const result = await new NfseNationalProvider().cancelarNfse(emissaoId, motivo);
      if (result.success) {
        res.json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (error: any) {
      console.error("Cancelar NFS-e error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/nfse/emissoes/:id/manual-emit", requireAuth, async (req, res) => {
    try {
      const emissaoId = req.params.id as string;
      const { chaveAcesso } = req.body as { chaveAcesso?: string };
      if (!chaveAcesso) {
        return res.status(400).json({ error: "Chave de acesso é obrigatória" });
      }

      const emissao = await storage.getNfseEmissao(emissaoId);
      if (!emissao) {
        return res.status(404).json({ error: "Emissão não encontrada" });
      }

      if (emissao.status === "CANCELADA") {
        return res.status(400).json({ error: "Não é possível marcar uma NFS-e cancelada como emitida" });
      }

      await storage.updateNfseEmissao(emissao.id, {
        status: "EMITIDA",
        chaveAcesso,
        updatedAt: new Date(),
      });

      if (
        emissao.origemTipo === "INVOICE" ||
        emissao.origemTipo === "COMISSAO" ||
        emissao.origemTipo === LANDLORD_NFSE_ORIGIN_TYPE
      ) {
        const invoice = await storage.updateInvoice(emissao.origemId, { status: "issued" });
        if (invoice?.receiptId && emissao.origemTipo !== LANDLORD_NFSE_ORIGIN_TYPE) {
          await storage.updateReceipt(invoice.receiptId, {
            isInvoiceGenerated: true,
            isInvoiceIssued: true,
            isInvoiceCancelled: false,
          });
        }
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error("Manual emit NFS-e error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/invoices/:id/manual-nfse", requireAuth, async (req, res) => {
    try {
      const invoiceId = req.params.id as string;
      const { chaveAcesso } = req.body as { chaveAcesso?: string };

      if (!chaveAcesso) {
        return res.status(400).json({ error: "Chave de acesso é obrigatória" });
      }

      const invoice = await storage.getInvoice(invoiceId);
      if (!invoice) {
        return res.status(404).json({ error: "Nota fiscal não encontrada" });
      }

      const landlord = await storage.getLandlord(invoice.landlordId);
      if (!landlord) {
        return res.status(404).json({ error: "Proprietário não encontrado" });
      }

      const receipt = await storage.getReceipt(invoice.receiptId);
      const contract = receipt ? await storage.getContract(receipt.contractId) : undefined;
      const tenant = contract ? await storage.getTenant(contract.tenantId) : undefined;
      const runtimeProfile = await resolveNfseRuntimeProfile(
        isLandlordNfseInvoice(invoice) ? LANDLORD_NFSE_ORIGIN_TYPE : "INVOICE",
        invoice.id,
      );

      const valor = Number(invoice.amount);
      const valorServico = valor.toFixed(2);
      const baseCalculo = valor.toFixed(2);
      const aliquotaIss = Number(runtimeProfile.aliquotaIss || 0);
      const valorIss = (valor * (aliquotaIss / 100)).toFixed(2);

      const reference = receipt ? `${String(receipt.refMonth).padStart(2, "0")}/${receipt.refYear}` : "";
      const property = contract ? await storage.getProperty(contract.propertyId) : undefined;
      const discriminacao = isLandlordNfseInvoice(invoice)
        ? buildLandlordNfseDescription({ receipt, property, contract })
        : `Serviços de administração imobiliária ref. ${reference}`;
      const landlordTomadorPayload = isLandlordNfseInvoice(invoice)
        ? await buildLandlordNfseTomadorPayloadByInvoiceId(invoice.id)
        : null;
      const landlordPropertyPayload = isLandlordNfseInvoice(invoice)
        ? await buildLandlordNfsePropertyPayloadByInvoiceId(invoice.id)
        : null;

      const emissao = await storage.createNfseEmissao({
        origemId: invoice.id,
        origemTipo: isLandlordNfseInvoice(invoice) ? LANDLORD_NFSE_ORIGIN_TYPE : "INVOICE",
        tomadorNome: landlordTomadorPayload?.tomadorNome || (isLandlordNfseInvoice(invoice) ? (tenant?.name || "Locatário") : landlord.name),
        tomadorCpfCnpj: landlordTomadorPayload?.tomadorCpfCnpj || (isLandlordNfseInvoice(invoice) ? (tenant?.doc || "") : landlord.doc),
        tomadorEmail: landlordTomadorPayload?.tomadorEmail || null,
        tomadorEnderecoJson: landlordTomadorPayload?.tomadorEnderecoJson || null,
        imovelEnderecoJson: landlordPropertyPayload?.imovelEnderecoJson || null,
        valorServico,
        baseCalculo,
        aliquotaIss: String(runtimeProfile.aliquotaIss),
        valorIss,
        descricaoServico: discriminacao,
        status: "EMITIDA",
        idempotencyKey: `${isLandlordNfseInvoice(invoice) ? LANDLORD_NFSE_ORIGIN_TYPE : "INVOICE"}-MANUAL-${invoice.id}-${Date.now()}`,
        chaveAcesso,
      });

      const updatedInvoice = await storage.updateInvoice(invoice.id, { status: "issued" });
      if (updatedInvoice?.receiptId && !isLandlordNfseInvoice(invoice)) {
        await storage.updateReceipt(updatedInvoice.receiptId, {
          isInvoiceGenerated: true,
          isInvoiceIssued: true,
          isInvoiceCancelled: false,
        });
      }

      res.json({ success: true, emissao });
    } catch (error: any) {
      console.error("Manual NFS-e from invoice error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/nfse/danfse/:chave", requireAuth, async (req, res) => {
    try {
      const chaveAcesso = getSingleParam(req.params.chave);
      const pdfBuffer = await getNfseDanfsePdfBuffer(chaveAcesso, {
        context: "danfse-download",
      });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename=danfse-${chaveAcesso}.pdf`);
      res.send(pdfBuffer);
    } catch (error: any) {
      console.error("Erro ao redirecionar DANFSe:", error);
      res.status(500).send("Erro ao baixar DANFSe");
    }
  });

  app.get("/api/nfse/emissoes/:id/xml", requireAuth, async (req, res) => {
    try {
      const emissaoId = getSingleParam(req.params.id);
      const xml = await getNfseXmlContent(emissaoId);
      if (!xml) return res.status(404).json({ error: "XML não encontrado" });
      
      res.header("Content-Type", "application/xml");
      res.header("Content-Disposition", `attachment; filename=nfse-${emissaoId}.xml`);
      res.send(xml);
    } catch (error: any) {
      console.error("Download XML error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/nfse/emissoes/:id/atualizar-numero-xml", requireAuth, async (req, res) => {
    try {
      const emissaoId = getSingleParam(req.params.id);
      // #region debug-point A:update-numero-route-entry
      debugUpdateNfseNumber("pre-fix", "A", "server/routes.ts:/api/nfse/emissoes/:id/atualizar-numero-xml:start", "Entrou na rota de atualizar numero pelo XML", {
        emissaoId,
        userId: req.session.userId || null,
        method: req.method,
        path: req.path,
      });
      // #endregion
      const emissao = await storage.getNfseEmissao(emissaoId);
      if (!emissao) return res.status(404).json({ error: "Emissão não encontrada" });
      if (emissao.status !== "EMITIDA") {
        return res.status(400).json({ error: "Apenas NFS-e emitidas podem atualizar o número pelo XML" });
      }

      const xml = await getNfseXmlContent(emissaoId);
      if (!xml) return res.status(404).json({ error: "XML não encontrado para esta emissão" });

      const numeroNfse = extractNfseNumberFromXml(xml);
      // #region debug-point C:update-numero-xml-read
      debugUpdateNfseNumber("pre-fix", "C", "server/routes.ts:/api/nfse/emissoes/:id/atualizar-numero-xml:xml", "XML processado para extrair nNFSe", {
        emissaoId,
        xmlLength: xml.length,
        numeroNfse,
        xmlHead: xml.slice(0, 180),
      });
      // #endregion
      if (!numeroNfse) {
        return res.status(422).json({ error: "A tag <nNFSe> não foi encontrada no XML da NFS-e" });
      }

      const updated = await storage.updateNfseEmissao(emissaoId, {
        numeroNfse,
        updatedAt: new Date(),
      });

      res.json({
        success: true,
        numeroNfse,
        emissao: updated ? normalizeEmissaoNumeroNfse(updated) : normalizeEmissaoNumeroNfse({ ...emissao, numeroNfse }),
      });
    } catch (error: any) {
      // #region debug-point D:update-numero-route-error
      debugUpdateNfseNumber("pre-fix", "D", "server/routes.ts:/api/nfse/emissoes/:id/atualizar-numero-xml:error", "Erro na rota de atualizar numero pelo XML", {
        emissaoId: getSingleParam(req.params.id),
        name: error?.name || null,
        message: error?.message || String(error),
        stack: error?.stack || null,
      });
      // #endregion
      console.error("Atualizar número NFS-e pelo XML error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/public/nfse/danfse/:chave", async (req, res) => {
    try {
      const chave = req.params.chave as string;
      const url = await getNfseDanfseUrl(chave);
      res.redirect(url);
    } catch (error: any) {
      console.error("Erro ao redirecionar DANFSe público:", error);
      res.status(500).send("Erro ao gerar link público do DANFSe");
    }
  });

  app.get("/api/nfse/emissoes/:id/danfse-url", requireAuth, async (req, res) => {
    try {
      const emissaoId = req.params.id as string;
      const emissao = await storage.getNfseEmissao(emissaoId);
      if (!emissao) return res.status(404).json({ error: "Emissão não encontrada" });
      if (!emissao.chaveAcesso) return res.status(400).json({ error: "Chave de acesso indisponível para esta emissão" });
      const url = await getNfseDanfseUrl(emissao.chaveAcesso);
      res.json({ url });
    } catch (error: any) {
      console.error("Erro ao obter URL do DANFSe:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/nfse/emissoes/backfill-numero-nfse", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) return res.status(401).json({ error: "Não autenticado" });
      const user = await storage.getUser(userId);
      if (!user || user.role !== "admin") return res.status(403).json({ error: "Acesso negado" });

      const start = new Date("2026-05-01T00:00:00.000Z");
      const emissoes = await storage.getNfseEmissoes();
      const target = emissoes.filter((emissao) => {
        if (emissao.status !== "EMITIDA") return false;
        const baseDate = emissao.updatedAt || emissao.createdAt;
        if (!baseDate) return false;
        const date = baseDate instanceof Date ? baseDate : new Date(baseDate);
        if (Number.isNaN(date.getTime())) return false;
        return date >= start;
      });

      let scanned = 0;
      let updated = 0;
      let skippedNoRaw = 0;
      let skippedNoNumero = 0;
      let skippedSame = 0;
      const errors: string[] = [];

      for (const emissao of target) {
        scanned += 1;
        if (!emissao.apiResponseRaw) {
          skippedNoRaw += 1;
          continue;
        }
        const numero =
          extractNumeroNfseFromApiResponseRaw(emissao.apiResponseRaw) ||
          extractNumeroNfseFromChaveAcesso(emissao.chaveAcesso, emissao.updatedAt || emissao.createdAt);
        if (!numero) {
          skippedNoNumero += 1;
          continue;
        }
        const current = pickFirstStringValue(emissao.numeroNfse);
        if (current === numero) {
          skippedSame += 1;
          continue;
        }
        try {
          await storage.updateNfseEmissao(emissao.id, { numeroNfse: numero, updatedAt: new Date() });
          updated += 1;
        } catch (error: any) {
          errors.push(`Falha ao atualizar ${emissao.id}: ${error?.message || error}`);
        }
      }

      res.json({
        startFrom: "2026-05-01",
        eligible: target.length,
        scanned,
        updated,
        skippedNoRaw,
        skippedNoNumero,
        skippedSame,
        errors: errors.slice(0, 50),
      });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Erro ao executar backfill" });
    }
  });

  app.get("/api/accounting/export-nfse", requirePermission("menu_accounting_export_nfs"), async (req, res) => {
    try {
      const month = Number(req.query.month);
      const year = Number(req.query.year);
      const exportKindRaw = typeof req.query.kind === "string" ? req.query.kind : Array.isArray(req.query.kind) ? req.query.kind[0] : "both";
      const exportKind = String(exportKindRaw || "both").toLowerCase();
      const exportTypeRaw = typeof req.query.type === "string" ? req.query.type : Array.isArray(req.query.type) ? req.query.type[0] : "IMOBILIARIA";
      const exportType = exportTypeRaw === "PROPRIETARIO" ? "PROPRIETARIO" : "IMOBILIARIA";
      const landlordId = getSingleParam(req.query.landlordId as string | string[] | undefined);
      const includeXml = exportKind === "both" || exportKind === "xml";
      const includeDanfse = exportKind === "both" || exportKind === "danfse";
      // #region debug-point A:request-start
      debugAccountingExport("pre-fix", "A", "server/routes.ts:/api/accounting/export-nfse:start", "Iniciou exportacao contabil de NFs", {
        month,
        year,
        exportKind,
        exportType,
        landlordId: landlordId || null,
      });
      // #endregion
      const exportStartedAt = Date.now();
      let responseFinished = false;
      res.on("finish", () => {
        responseFinished = true;
        debugAccountingExport("pre-fix", "D", "server/routes.ts:/api/accounting/export-nfse:finish", "Exportacao contabil finalizou resposta", {
          month,
          year,
          durationMs: Date.now() - exportStartedAt,
          statusCode: res.statusCode,
        });
      });
      res.on("close", () => {
        if (responseFinished) return;
        debugAccountingExport("pre-fix", "D", "server/routes.ts:/api/accounting/export-nfse:close", "Conexao fechada antes do fim da exportacao contabil", {
          month,
          year,
          durationMs: Date.now() - exportStartedAt,
          statusCode: res.statusCode,
        });
      });

      if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2000) {
        return res.status(400).json({ error: "Mês/ano inválidos para exportação." });
      }

      if (!includeXml && !includeDanfse) {
        return res.status(400).json({ error: "Tipo de exportação inválido. Use kind=xml, kind=danfse ou kind=both." });
      }

      if (exportType === "PROPRIETARIO" && !landlordId) {
        return res.status(400).json({ error: "Selecione o proprietário para exportar as NFs dele." });
      }

      const [emissoes, invoices] = await Promise.all([
        storage.getNfseEmissoes(),
        storage.getInvoices(),
      ]);
      const invoiceById = new Map(invoices.map((invoice) => [invoice.id, invoice]));

      const emitidasNoPeriodo = emissoes.filter((emissao) => {
        if (emissao.status !== "EMITIDA") return false;
        const baseDate = emissao.updatedAt || emissao.createdAt;
        if (!baseDate) return false;
        const date = new Date(baseDate);
        if (Number.isNaN(date.getTime())) return false;
        if (date.getMonth() + 1 !== month || date.getFullYear() !== year) return false;

        const invoice =
          emissao.origemTipo === "INVOICE" || emissao.origemTipo === LANDLORD_NFSE_ORIGIN_TYPE
            ? invoiceById.get(emissao.origemId)
            : undefined;
        const isLandlordEmission =
          emissao.origemTipo === LANDLORD_NFSE_ORIGIN_TYPE || isLandlordNfseInvoice(invoice);

        if (exportType === "IMOBILIARIA") {
          return !isLandlordEmission;
        }

        if (!isLandlordEmission) return false;
        if (!invoice?.landlordId) return false;
        return invoice.landlordId === landlordId;
      });
      // #region debug-point B:filtered-emissions
      debugAccountingExport("pre-fix", "B", "server/routes.ts:/api/accounting/export-nfse:filtered", "Filtrou emissoes para exportacao contabil", {
        month,
        year,
        exportType,
        landlordId: landlordId || null,
        totalEmissoes: emissoes.length,
        emitidasNoPeriodo: emitidasNoPeriodo.length,
        sample: emitidasNoPeriodo.slice(0, 5).map((emissao) => ({
          emissaoId: emissao.id,
          numeroNfse: emissao.numeroNfse || null,
          chaveAcesso: emissao.chaveAcesso || null,
          baseDate: emissao.updatedAt ? new Date(emissao.updatedAt).toISOString() : emissao.createdAt ? new Date(emissao.createdAt).toISOString() : null,
        })),
      });
      // #endregion

      if (emitidasNoPeriodo.length === 0) {
        return res.status(404).json({ error: "Nenhuma NF emitida encontrada para o período informado." });
      }

      const zip = new JSZip();
      const xmlFolder = includeXml ? zip.folder("XML") : null;
      const danfseFolder = includeDanfse ? zip.folder("DANFSE") : null;
      let exportedXmlCount = 0;
      let exportedDanfseCount = 0;
      const skipped: string[] = [];
      const exportConcurrency = Math.max(
        1,
        Number(process.env.ACCOUNTING_EXPORT_NFSE_CONCURRENCY || 4)
      );

      await mapWithConcurrency(emitidasNoPeriodo, exportConcurrency, async (emissao) => {
        const xmlFileName = sanitizeExportFileName(`nfse-${emissao.id}.xml`);
        const pdfFileName = sanitizeExportFileName(`danfse-${emissao.chaveAcesso || emissao.id}.pdf`);

        if (includeXml) {
          try {
            const xml = await getNfseXmlContent(emissao.id);
            if (xml) {
              xmlFolder?.file(xmlFileName, xml);
              exportedXmlCount++;
            } else {
              const message = `XML indisponível para emissão ${emissao.id}`;
              skipped.push(message);
              console.warn(message);
            }
          } catch (error: any) {
            const message = `Falha ao obter XML da emissão ${emissao.id}: ${error?.message || error}`;
            skipped.push(message);
            console.warn(message);
          }
        }

        if (includeDanfse) {
          if (!emissao.chaveAcesso) {
            const message = `DANFSE indisponível para emissão ${emissao.id}: chave de acesso ausente`;
            skipped.push(message);
            console.warn(message);
            return;
          }

          try {
            const pdfBuffer = await getNfseDanfsePdfBuffer(emissao.chaveAcesso, {
              emissaoId: emissao.id,
              month,
              year,
              context: "accounting-export",
            });
            danfseFolder?.file(pdfFileName, pdfBuffer);
            exportedDanfseCount++;
          } catch (error: any) {
            const message = `Falha ao obter DANFSE da emissão ${emissao.id}: ${error?.message || error}`;
            skipped.push(message);
            console.warn(message);
          }
        }
      });

      // #region debug-point C:export-result
      debugAccountingExport("pre-fix", "C", "server/routes.ts:/api/accounting/export-nfse:result", "Concluiu tentativa de montagem do ZIP contabil", {
        month,
        year,
        exportKind,
        exportType,
        landlordId: landlordId || null,
        exportedXmlCount,
        exportedDanfseCount,
        skippedCount: skipped.length,
        skippedSample: skipped.slice(0, 10),
      });
      // #endregion

      if (exportedXmlCount === 0 && exportedDanfseCount === 0) {
        return res.status(404).json({ error: "Nenhum arquivo disponível para o período informado." });
      }

      const zipBuffer = await zip.generateAsync({
        type: "nodebuffer",
        compression: "DEFLATE",
        compressionOptions: { level: 6 },
      });

      const baseName = exportKind === "xml" ? "contabilidade_xml" : exportKind === "danfse" ? "contabilidade_danfse" : "contabilidade_nfs";
      const typeLabel = exportType === "PROPRIETARIO" ? `proprietario_${sanitizeExportFileName(landlordId || "todos")}` : "imobiliaria";
      const fileName = `${baseName}_${typeLabel}_${year}_${String(month).padStart(2, "0")}.zip`;
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename=${fileName}`);
      res.setHeader("X-Exported-Xml-Count", String(exportedXmlCount));
      res.setHeader("X-Exported-Danfse-Count", String(exportedDanfseCount));
      res.setHeader("X-Export-Skipped-Count", String(skipped.length));
      // #region debug-point D:response-success
      debugAccountingExport("pre-fix", "D", "server/routes.ts:/api/accounting/export-nfse:success", "ZIP contabil enviado com sucesso", {
        fileName,
        exportType,
        landlordId: landlordId || null,
        exportedXmlCount,
        exportedDanfseCount,
        skippedCount: skipped.length,
        zipSize: zipBuffer.length,
      });
      // #endregion
      res.send(zipBuffer);
    } catch (error: any) {
      console.error("Export accounting NFSE error:", error);
      // #region debug-point D:response-error
      debugAccountingExport("pre-fix", "D", "server/routes.ts:/api/accounting/export-nfse:error", "Erro na exportacao contabil", {
        message: error?.message || String(error),
      });
      // #endregion
      res.status(500).json({ error: error.message || "Erro ao exportar notas fiscais" });
    }
  });

  app.get("/api/accounting/export-nfse/landlords", requirePermission("menu_accounting_export_nfs"), async (_req, res) => {
    try {
      const landlords = await storage.getLandlords();
      res.json(
        landlords.map((landlord) => ({
          id: landlord.id,
          name: landlord.name,
          doc: landlord.doc,
        })),
      );
    } catch (error) {
      console.error("Get accounting export landlords error:", error);
      res.status(500).json({ error: "Erro ao buscar proprietários para exportação" });
    }
  });

  app.post("/api/transfers/:id/execute", requireAuth, async (req, res) => {
    try {
      const transfer = await storage.getLandlordTransfer(getSingleParam(req.params.id));
      if (!transfer) return res.status(404).json({ error: "Repasse não encontrado" });
      
      // Permitir re-executar se estiver pendente ou com falha
      if (transfer.status !== "pending" && transfer.status !== "failed") {
        return res.status(400).json({ error: `Repasse não está pendente ou com falha (status atual: ${transfer.status})` });
      }

      const landlord = await storage.getLandlord(transfer.landlordId);
      if (!landlord) return res.status(404).json({ error: "Proprietário não encontrado" });

      const receipt = await storage.getReceipt(transfer.receiptId);

      const result = await pixProvider.createTransfer(
        landlord.pixKey || "",
        landlord.name,
        Number(transfer.amount),
        `Repasse aluguel ${receipt?.refMonth}/${receipt?.refYear}`
      );

      if (result.success) {
        await storage.updateLandlordTransfer(transfer.id, {
          status: "paid",
          paidAt: new Date(),
          providerTransferId: result.transferId,
        });

        if (receipt) {
          await storage.updateReceipt(receipt.id, { status: "transferred" });
        }

        await storage.createCashTransaction({
          type: "OUT",
          date: new Date().toISOString().split("T")[0],
          category: "Repasse ao Proprietário",
          description: `Repasse PIX para ${landlord.name}`,
          amount: transfer.amount,
          receiptId: transfer.receiptId,
        });

        res.json({ success: true, transferId: result.transferId });
      } else {
        await storage.updateLandlordTransfer(transfer.id, {
          status: "failed",
          errorMessage: result.error,
        });
        res.status(400).json({ error: result.error });
      }
    } catch (error) {
      console.error("Execute transfer error:", error);
      res.status(500).json({ error: "Erro ao executar repasse" });
    }
  });

  app.post("/api/transfers/:id/manual", requireAuth, async (req, res) => {
    try {
      const { paidAt } = req.body;
      const transfer = await storage.getLandlordTransfer(getSingleParam(req.params.id));
      if (!transfer) return res.status(404).json({ error: "Repasse não encontrado" });
      
      // Permitir registrar manualmente se estiver pendente ou com falha
      if (transfer.status !== "pending" && transfer.status !== "failed") {
        return res.status(400).json({ error: `Repasse não está pendente ou com falha (status atual: ${transfer.status})` });
      }

      const landlord = await storage.getLandlord(transfer.landlordId);
      if (!landlord) return res.status(404).json({ error: "Proprietário não encontrado" });

      const receipt = await storage.getReceipt(transfer.receiptId);

      const paymentDate = paidAt ? new Date(paidAt) : new Date();
      const paymentDateStr = paymentDate.toISOString().split("T")[0];

      // Atualiza status do repasse
      await storage.updateLandlordTransfer(transfer.id, {
        status: "paid",
        paidAt: paymentDate,
        paymentMethod: "manual",
        providerTransferId: "MANUAL-" + Date.now(), // ID fictício para controle
      });

      // Atualiza status do recibo
      if (receipt) {
        await storage.updateReceipt(receipt.id, { status: "transferred" });
      }

      // Cria lançamento no caixa
      await storage.createCashTransaction({
        type: "OUT",
        date: paymentDateStr,
        category: "Repasse ao Proprietário",
        description: `Repasse Manual para ${landlord.name}`,
        amount: transfer.amount,
        receiptId: transfer.receiptId,
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Manual transfer error:", error);
      res.status(500).json({ error: "Erro ao registrar repasse manual" });
    }
  });

  app.patch("/api/transfers/:id/date", requireAuth, async (req, res) => {
    try {
      const { paidAt } = req.body;
      if (!paidAt) return res.status(400).json({ error: "Data de pagamento obrigatória" });

      const transfer = await storage.getLandlordTransfer(getSingleParam(req.params.id));
      if (!transfer) return res.status(404).json({ error: "Repasse não encontrado" });

      if (transfer.status !== "paid" || transfer.paymentMethod !== "manual") {
        return res.status(400).json({ error: "Apenas repasses pagos manualmente podem ter a data editada" });
      }

      const newDate = new Date(paidAt);
      const newDateStr = newDate.toISOString().split("T")[0];

      // Atualiza data do repasse
      await storage.updateLandlordTransfer(transfer.id, {
        paidAt: newDate,
      });

      // Atualiza data da transação no caixa
      // Busca transações do recibo
      if (transfer.receiptId) {
        const cashTransactions = await storage.getCashTransactionsByReceiptIds([transfer.receiptId]);
        const targetTransaction = cashTransactions.find(t => 
          t.type === "OUT" && 
          t.category === "Repasse ao Proprietário"
        );

        if (targetTransaction) {
          await storage.updateCashTransaction(targetTransaction.id, {
            date: newDateStr
          });
        }
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Update transfer date error:", error);
      res.status(500).json({ error: "Erro ao atualizar data do repasse" });
    }
  });

  app.post("/api/transfers/bulk-manual", requireAuth, async (req, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: "Lista de IDs inválida" });
      }

      const results = {
        success: 0,
        errors: 0,
        details: [] as any[]
      };

      for (const id of ids) {
        try {
          const transfer = await storage.getLandlordTransfer(id);
          if (!transfer) throw new Error(`Repasse ${id} não encontrado`);
          
          if (transfer.status !== "pending" && transfer.status !== "failed") {
            throw new Error(`Repasse ${id} não está pendente ou com falha (status: ${transfer.status})`);
          }

          const landlord = await storage.getLandlord(transfer.landlordId);
          if (!landlord) throw new Error(`Proprietário não encontrado para repasse ${id}`);

          const receipt = await storage.getReceipt(transfer.receiptId);

          // Atualiza status do repasse
          await storage.updateLandlordTransfer(transfer.id, {
            status: "paid",
            paidAt: new Date(),
            paymentMethod: "manual",
            providerTransferId: "MANUAL-BULK-" + Date.now(),
          });

          // Atualiza status do recibo
          if (receipt) {
            await storage.updateReceipt(receipt.id, { status: "transferred" });
          }

          // Cria lançamento no caixa
          await storage.createCashTransaction({
            type: "OUT",
            date: new Date().toISOString().split("T")[0],
            category: "Repasse ao Proprietário",
            description: `Repasse Manual (Lote) para ${landlord.name}`,
            amount: transfer.amount,
            receiptId: transfer.receiptId,
          });

          results.success++;
        } catch (error: any) {
          results.errors++;
          results.details.push({ id, error: error.message });
        }
      }

      res.json(results);
    } catch (error) {
      console.error("Bulk manual transfer error:", error);
      res.status(500).json({ error: "Erro ao processar pagamentos em lote" });
    }
  });

  app.delete("/api/transfers/bulk-delete", requireAuth, async (req, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: "Lista de IDs inválida" });
      }

      const results = {
        success: 0,
        errors: 0,
        details: [] as any[]
      };

      for (const id of ids) {
        try {
          const transfer = await storage.getLandlordTransfer(id);
          if (!transfer) throw new Error(`Repasse ${id} não encontrado`);

          if (transfer.status !== "pending" && transfer.status !== "failed") {
             throw new Error(`Repasse ${id} não pode ser excluído (status: ${transfer.status})`);
          }

          const receiptId = transfer.receiptId;
          await storage.deleteLandlordTransfer(id);

          // Garante que o recibo volte para o status correto
          if (receiptId) {
            const receipt = await storage.getReceipt(receiptId);
            if (receipt && receipt.status === "transferred") {
               const cashTransactions = await storage.getCashTransactionsByReceiptIds([receiptId]);
               const hasTenantPayment = cashTransactions.some(t => t.type === "IN");
               const newStatus = hasTenantPayment ? "paid" : "closed";
               await storage.updateReceipt(receiptId, { status: newStatus });
            }
          }

          results.success++;
        } catch (error: any) {
           results.errors++;
           results.details.push({ id, error: error.message });
        }
      }

      res.json(results);
    } catch (error) {
      console.error("Bulk delete transfer error:", error);
      res.status(500).json({ error: "Erro ao excluir repasses em lote" });
    }
  });

  app.post("/api/transfers/:id/reverse", requireAuth, async (req, res) => {
    try {
      const transfer = await storage.getLandlordTransfer(getSingleParam(req.params.id));
      if (!transfer) return res.status(404).json({ error: "Repasse não encontrado" });
      if (transfer.status !== "paid") return res.status(400).json({ error: "Apenas repasses pagos podem ser estornados" });

      const landlord = await storage.getLandlord(transfer.landlordId);
      const receipt = await storage.getReceipt(transfer.receiptId);

      // 1. Reverte status do repasse para pendente (para permitir novo pagamento ou exclusão)
      await storage.updateLandlordTransfer(transfer.id, {
        status: "pending",
      });

      // 2. Reverte status do recibo para pago ou fechado (se existir)
      if (receipt) {
        // Verifica se existe pagamento do inquilino (transação IN)
        const cashTransactions = await storage.getCashTransactionsByReceiptIds([receipt.id]);
        const hasTenantPayment = cashTransactions.some(t => t.type === "IN");
        
        const newStatus = hasTenantPayment ? "paid" : "closed";
        await storage.updateReceipt(receipt.id, { status: newStatus });
        
        // 3. Remove o lançamento do caixa (OUT) vinculado ao recibo
        await storage.deleteCashTransactionByReceiptAndType(receipt.id, "OUT");
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Reverse transfer error:", error);
      res.status(500).json({ error: "Erro ao estornar repasse" });
    }
  });

  app.delete("/api/transfers/:id", requireAuth, async (req, res) => {
    try {
      const transfer = await storage.getLandlordTransfer(getSingleParam(req.params.id));
      if (!transfer) return res.status(404).json({ error: "Repasse não encontrado" });

      if (transfer.status !== "pending" && transfer.status !== "failed") {
        return res.status(400).json({ 
          error: "Apenas repasses pendentes ou com falha podem ser excluídos." 
        });
      }

      // Salva o ID do recibo antes de excluir
      const receiptId = transfer.receiptId;

      await storage.deleteLandlordTransfer(getSingleParam(req.params.id));

      // Garante que o recibo volte para o status correto se estiver 'transferred'
      if (receiptId) {
        const receipt = await storage.getReceipt(receiptId);
        if (receipt && receipt.status === "transferred") {
           const cashTransactions = await storage.getCashTransactionsByReceiptIds([receiptId]);
           const hasTenantPayment = cashTransactions.some(t => t.type === "IN");
           const newStatus = hasTenantPayment ? "paid" : "closed";
           await storage.updateReceipt(receiptId, { status: newStatus });
        }
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error("Delete transfer error:", error);
      res.status(500).json({ error: "Erro ao excluir repasse" });
    }
  });

  app.post("/api/transfers/:id/pix-execute", requirePermission("execute_pix"), async (req, res) => {
    try {
      const transfer = await storage.getLandlordTransfer(getSingleParam(req.params.id));
      if (!transfer) return res.status(404).json({ error: "Repasse não encontrado" });
      
      if (transfer.status !== "pending" && transfer.status !== "failed") {
        return res.status(400).json({ error: `Repasse não está pendente ou com falha (status atual: ${transfer.status})` });
      }

      const landlord = await storage.getLandlord(transfer.landlordId);
      if (!landlord) return res.status(404).json({ error: "Proprietário não encontrado" });
      const receipt = transfer.receiptId ? await storage.getReceipt(transfer.receiptId) : null;
      const contract = receipt?.contractId ? await storage.getContract(receipt.contractId) : null;

      const description = `Pagamento Repasse ${landlord.name}`.substring(0, 140); 
      const reference = buildTransferPixReference(transfer, receipt);
      const auditPixKey = getPixAuditKey(landlord);
      const dedupeKey = buildPixDedupeKey({
        transferId: transfer.id,
        amount: String(transfer.amount),
        pixKey: auditPixKey,
        reference,
      });

      if (landlord.pixKeyType === "agencia_conta") {
        if (!landlord.bankIspb || !landlord.doc || !landlord.name || !landlord.account || !landlord.branch || !(landlord as any).accountType) {
          return res.status(400).json({ error: "Dados bancários incompletos para PIX por Agência/Conta (ISPB, CPF/CNPJ, agência, conta, tipo de conta)." });
        }
      } else if (!landlord.pixKey) {
        return res.status(400).json({ error: "Proprietário não possui chave PIX cadastrada." });
      }

      const existingBlockingAttempt =
        await getBlockingPixTransferAttemptByTransfer(transfer.id) ||
        await getBlockingPixTransferAttemptByDedupeKey(dedupeKey);
      if (existingBlockingAttempt) {
        const reconciliation = await handlePixAttemptReconciliation({
          blockingAttempt: existingBlockingAttempt,
          transfer,
          receipt,
          landlord,
        });
        return res.status(reconciliation.statusCode).json(reconciliation.payload);
      }

      const requestId = createPixRequestId(transfer.id);
      let attempt: PixTransferAttempt;

      try {
        attempt = await createPixTransferAttempt({
          transferId: transfer.id,
          receiptId: transfer.receiptId,
          contractId: receipt?.contractId ?? null,
          propertyId: contract?.propertyId ?? null,
          landlordId: transfer.landlordId,
          amount: String(transfer.amount),
          pixKey: auditPixKey,
          pixKeyType: landlord.pixKeyType ?? null,
          bankApi: "SICOOB_PIX",
          requestId,
          dedupeKey,
          status: "PENDENTE",
          reference,
          createdByUserId: req.session.userId || null,
          requestIp: getRequestIp(req),
          userAgent: String(req.headers["user-agent"] || ""),
        });
      } catch (error: any) {
        if (error?.code === "23505") {
          const concurrentAttempt =
            await getBlockingPixTransferAttemptByTransfer(transfer.id) ||
            await getBlockingPixTransferAttemptByDedupeKey(dedupeKey);
          return res.status(409).json({
            error: "Este repasse possui uma tentativa de PIX pendente de confirmação. Verifique o status antes de reenviar.",
            attemptStatus: concurrentAttempt?.status || "PENDENTE",
          });
        }
        throw error;
      }

      await updatePixTransferAttempt(attempt.id, {
        status: "ENVIANDO",
        requestSentAt: new Date(),
      });

      let providerTransferId: string | null = null;
      let responsePayload: any = null;
      let requestPayload: any = null;

      try {
        if (landlord.pixKeyType === "agencia_conta") {
          const result = await sicoobProvider.confirmPixPaymentByAccount(
            Number(transfer.amount),
            description,
            {
              ispb: landlord.bankIspb!,
              cpfCnpj: landlord.doc!,
              nome: landlord.name,
              conta: String(landlord.account),
              agencia: String(landlord.branch),
              tipo: String((landlord as any).accountType),
            }
          );

          providerTransferId = result.providerTransferId;
          requestPayload = result.audit.requestPayload;
          responsePayload = result.audit.responseData;
        } else {
          const initiation = await sicoobProvider.initiatePixPayment(landlord.pixKey!);
          providerTransferId = initiation.endToEndId;

          await updatePixTransferAttempt(attempt.id, {
            status: "ENVIADO",
            providerTransferId,
            payloadSent: safeJsonStringify(initiation.audit.requestPayload),
            responseReceived: safeJsonStringify(initiation.audit.responseData),
            responseReceivedAt: new Date(),
            providerStatus: "INICIADO",
          });

          const confirmation = await sicoobProvider.confirmPixPayment(providerTransferId, Number(transfer.amount), description);
          requestPayload = {
            initiation: initiation.audit.requestPayload,
            confirmation: confirmation.audit.requestPayload,
          };
          responsePayload = {
            initiation: initiation.audit.responseData,
            confirmation: confirmation.audit.responseData,
          };
        }

        await updatePixTransferAttempt(attempt.id, {
          status: "CONFIRMADO",
          providerTransferId,
          payloadSent: safeJsonStringify(requestPayload),
          responseReceived: safeJsonStringify(responsePayload),
          responseReceivedAt: new Date(),
          providerStatus: "CONFIRMADO",
          errorMessage: null,
        });

        await finalizeSuccessfulPixTransfer({
          transfer,
          receipt,
          landlord,
          providerTransferId,
        });

        return res.json({
          success: true,
          providerTransferId,
          requestId,
          message: `Pagamento iniciado para ${landlord.name}. Pagamento confirmado com sucesso.`,
        });
      } catch (error: any) {
        const pendingConfirmationMessage =
          "Este repasse possui uma tentativa de PIX pendente de confirmação. Verifique o status antes de reenviar.";

        if (error instanceof SicoobPixError) {
          const ambiguous = error.shouldConfirm;
          const newStatus = ambiguous ? "ERRO_CONFIRMAR" : "ERRO";

          await updatePixTransferAttempt(attempt.id, {
            status: newStatus,
            providerTransferId: error.providerTransferId ?? providerTransferId,
            payloadSent: safeJsonStringify(error.requestPayload ?? requestPayload),
            responseReceived: safeJsonStringify(error.responseData),
            responseReceivedAt: new Date(),
            providerStatus: error.phase,
            errorMessage: ambiguous ? pendingConfirmationMessage : error.message,
          });

          await storage.updateLandlordTransfer(transfer.id, {
            status: "failed",
            errorMessage: ambiguous ? pendingConfirmationMessage : error.message,
          });

          if (ambiguous) {
            return res.status(409).json({
              error: pendingConfirmationMessage,
              requestId,
              providerTransferId: error.providerTransferId ?? providerTransferId,
              attemptStatus: newStatus,
            });
          }

          return res.status(400).json({
            error: error.message,
            requestId,
            attemptStatus: newStatus,
          });
        }

        await updatePixTransferAttempt(attempt.id, {
          status: "ERRO_CONFIRMAR",
          providerTransferId,
          payloadSent: safeJsonStringify(requestPayload),
          responseReceived: safeJsonStringify({ message: error?.message || String(error) }),
          responseReceivedAt: new Date(),
          providerStatus: "ERRO_DESCONHECIDO",
          errorMessage: pendingConfirmationMessage,
        });

        await storage.updateLandlordTransfer(transfer.id, {
          status: "failed",
          errorMessage: pendingConfirmationMessage,
        });

        throw error;
      }

    } catch (error: any) {
      console.error("PIX Execute error:", error);
      res.status(500).json({
        error: error.message || "Erro ao executar PIX",
      });
    }
  });

  app.post("/api/transfers/:id/pix-status-check", requirePermission("execute_pix"), async (req, res) => {
    try {
      const transfer = await storage.getLandlordTransfer(getSingleParam(req.params.id));
      if (!transfer) return res.status(404).json({ error: "Repasse não encontrado" });

      const landlord = await storage.getLandlord(transfer.landlordId);
      if (!landlord) return res.status(404).json({ error: "Proprietário não encontrado" });

      const receipt = transfer.receiptId ? await storage.getReceipt(transfer.receiptId) : null;
      const reference = buildTransferPixReference(transfer, receipt);
      const auditPixKey = getPixAuditKey(landlord);
      const dedupeKey = buildPixDedupeKey({
        transferId: transfer.id,
        amount: String(transfer.amount),
        pixKey: auditPixKey,
        reference,
      });

      const blockingAttempt =
        await getBlockingPixTransferAttemptByTransfer(transfer.id) ||
        await getBlockingPixTransferAttemptByDedupeKey(dedupeKey);
      if (!blockingAttempt) {
        return res.status(404).json({ error: "Nenhuma tentativa PIX pendente de confirmação foi encontrada para este repasse." });
      }

      const reconciliation = await handlePixAttemptReconciliation({
        blockingAttempt,
        transfer,
        receipt,
        landlord,
      });

      return res.status(reconciliation.statusCode).json(reconciliation.payload);
    } catch (error: any) {
      console.error("PIX status check error:", error);
      return res.status(500).json({ error: error.message || "Erro ao consultar status do PIX" });
    }
  });

  app.get("/api/invoices", requireAuth, async (req, res) => {
    try {
      const invoices = await storage.getInvoices();
      const receiptIds = Array.from(new Set(invoices.map(i => i.receiptId).filter(Boolean)));
      const [receipts, contracts, properties] = await Promise.all([
        storage.getReceiptsByIds(receiptIds),
        storage.getContracts(),
        storage.getProperties(),
      ]);

      const receiptById = new Map(receipts.map(r => [r.id, r]));
      const contractById = new Map(contracts.map(c => [c.id, c]));
      const propertyById = new Map(properties.map(p => [p.id, p]));

      const enrichedInvoices = invoices.map(invoice => {
        const receipt = receiptById.get(invoice.receiptId);
        const contract = receipt ? contractById.get(receipt.contractId) : undefined;
        const property = contract ? propertyById.get(contract.propertyId) : undefined;

        return {
          ...invoice,
          receiptRefMonth: receipt?.refMonth ?? null,
          receiptRefYear: receipt?.refYear ?? null,
          propertyTitle: property?.title ?? null,
          propertyAddress: property?.address ?? null,
        };
      });

      res.json(enrichedInvoices);
    } catch (error) {
      console.error("Get invoices error:", error);
      res.status(500).json({ error: "Erro ao buscar notas fiscais" });
    }
  });

  app.delete("/api/invoices/bulk", requireAuth, async (req, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: "Lista de IDs inválida" });
      }

      const results = { success: 0, errors: 0, details: [] as any[] };

      for (const id of ids) {
        try {
          const invoice = await storage.getInvoice(id);
          if (!invoice) throw new Error(`Nota fiscal ${id} não encontrada`);
          
          if (invoice.status === "issued") {
             throw new Error(`Nota fiscal ${id} já emitida. Cancele-a primeiro.`);
          }
          
          await storage.deleteInvoice(id);
          
          if (invoice.receiptId) {
             await recomputeInvoiceFlags(invoice.receiptId);
          }

          results.success++;
        } catch (error: any) {
          results.errors++;
          results.details.push({ id, error: error.message });
        }
      }
      
      res.json(results);
    } catch (error) {
      console.error("Bulk delete invoices error:", error);
      res.status(500).json({ error: "Erro ao excluir notas em lote" });
    }
  });

  app.post("/api/invoices/:id/issue", requireAuth, async (req, res) => {
    try {
      const invoice = await storage.getInvoice(getSingleParam(req.params.id));
      if (!invoice) return res.status(404).json({ error: "Nota fiscal não encontrada" });
      if (invoice.status !== "draft") return res.status(400).json({ error: "Nota fiscal não está em rascunho" });

      const landlord = await storage.getLandlord(invoice.landlordId);
      if (!landlord) return res.status(404).json({ error: "Proprietário não encontrado" });

      const receipt = await storage.getReceipt(invoice.receiptId);

      const result = await nfProvider.emitInvoice(
        landlord.name,
        landlord.doc,
        Number(invoice.amount),
        `Aluguel ${receipt?.refMonth}/${receipt?.refYear}`
      );

      if (result.success) {
        await storage.updateInvoice(invoice.id, {
          status: "issued",
          providerInvoiceId: result.invoiceId,
          number: result.invoiceNumber,
        });
        await recomputeInvoiceFlags(invoice.receiptId);
        res.json({ success: true, invoiceNumber: result.invoiceNumber });
      } else {
        await storage.updateInvoice(invoice.id, {
          status: "error",
          errorMessage: result.error,
        });
        res.status(400).json({ error: result.error });
      }
    } catch (error) {
      console.error("Issue invoice error:", error);
      res.status(500).json({ error: "Erro ao emitir nota fiscal" });
    }
  });

  app.post("/api/invoices/:id/cancel", requireAuth, async (req, res) => {
    try {
      const invoice = await storage.getInvoice(getSingleParam(req.params.id));
      if (!invoice) return res.status(404).json({ error: "Nota fiscal não encontrada" });
      if (invoice.status !== "issued") return res.status(400).json({ error: "Apenas notas fiscais emitidas podem ser canceladas" });

      const result = await nfProvider.cancelInvoice(invoice.id, "Cancelamento solicitado pelo usuário");

      if (result.success) {
        await storage.updateInvoice(invoice.id, {
          status: "cancelled",
        });

        await recomputeInvoiceFlags(invoice.receiptId);

        // Try to revert receipt to draft if it was just closed/paid?
        // User asked for a way to go back to draft.
        // If we cancel the invoice, we likely want to edit the receipt.
        // Let's check if we can safely revert to draft.
        const receipt = await storage.getReceipt(invoice.receiptId);
        if (receipt) {
             const transfers = await storage.getLandlordTransfersByReceipt(invoice.receiptId);
             const hasActiveTransfer = transfers.some(t => ['pending', 'processing', 'paid'].includes(t.status));
             
             if (!hasActiveTransfer) {
                 // Check if we should revert payment?
                 // If the invoice is cancelled, the payment might still be valid (tenant paid).
                 // But the user wants to "voltar o Recibo para rascunho".
                 // "Rascunho" means unpaid.
                 // So we probably shouldn't auto-revert to draft if it was paid.
                 // We will rely on the new "Reopen" route which handles this.
             }
        }

        res.json({ success: true });
      } else {
        res.status(400).json({ error: result.error || "Erro ao cancelar nota fiscal" });
      }
    } catch (error) {
      console.error("Cancel invoice error:", error);
      res.status(500).json({ error: "Erro ao cancelar nota fiscal" });
    }
  });

  app.get("/api/invoices/:id/xml", requireAuth, async (req, res) => {
    try {
      const invoice = await storage.getInvoice(getSingleParam(req.params.id));
      if (!invoice) return res.status(404).json({ error: "Nota fiscal não encontrada" });
      
      if (invoice.status !== "issued") {
        return res.status(400).json({ error: "XML disponível apenas para notas emitidas" });
      }

      const landlord = await storage.getLandlord(invoice.landlordId);
      if (!landlord) return res.status(404).json({ error: "Proprietário não encontrado" });

      const xmlContent = await nfProvider.generateXml(invoice.id, {
        number: invoice.number,
        amount: invoice.amount,
        customerName: landlord.name,
        customerDoc: landlord.doc
      });

      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('Content-Disposition', `attachment; filename=nf-${invoice.number || invoice.id}.xml`);
      res.send(xmlContent);
    } catch (error) {
      console.error("Get invoice XML error:", error);
      res.status(500).json({ error: "Erro ao gerar XML da nota fiscal" });
    }
  });

  app.delete("/api/invoices/:id", requireAuth, async (req, res) => {
    try {
      const invoice = await storage.getInvoice(getSingleParam(req.params.id));
      if (!invoice) return res.status(404).json({ error: "Nota fiscal não encontrada" });

      if (invoice.status === "issued") {
        return res.status(400).json({ error: "Não é possível excluir uma nota fiscal emitida. Cancele-a primeiro." });
      }

      // Delete the invoice
      await storage.deleteInvoice(getSingleParam(req.params.id));

      await recomputeInvoiceFlags(invoice.receiptId);

      res.json({ success: true });
    } catch (error) {
      console.error("Delete invoice error:", error);
      res.status(500).json({ error: "Erro ao excluir nota fiscal" });
    }
  });

  app.get("/api/nfse/emissoes/:id/pdf", requireAuth, async (req, res) => {
    try {
      const emissaoId = req.params.id as string;
      const emissao = await storage.getNfseEmissao(emissaoId);
      if (!emissao || !emissao.pdfUrl) return res.status(404).json({ error: "PDF não disponível" });
      
      res.redirect(emissao.pdfUrl);
    } catch (error) {
      console.error("Download PDF NFS-e error:", error);
      res.status(500).json({ error: "Erro ao baixar PDF" });
    }
  });

  return httpServer;
}

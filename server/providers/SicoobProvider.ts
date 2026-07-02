import fs from 'fs';
import path from 'path';
import https from 'https';
import axios from 'axios';
import crypto from 'crypto';
import { storage } from '../storage';

const SICOOB_AUTH_URL = "https://auth.sicoob.com.br/auth/realms/cooperado/protocol/openid-connect/token";
const SICOOB_API_URL = "https://api.sicoob.com.br/cobranca-bancaria/v3/boletos";
const CLIENT_ID = "4e49d786-d22b-46a7-9b87-27a06f297887";
const SCOPE = "boletos_inclusao boletos_consulta boletos_alteracao pixpagamentos_escrita pixpagamentos_consulta pixpagamentos_webhook";

type SicoobPixAudit = {
  method: "PIX_INICIA" | "PIX_CONFIRMA_CHAVE" | "PIX_CONFIRMA_AGENCIA_CONTA" | "PIX_CONSULTA";
  requestPayload: any;
  responseData: any;
  providerTransferId?: string | null;
};

export class SicoobPixError extends Error {
  phase: SicoobPixAudit["method"];
  requestSent: boolean;
  shouldConfirm: boolean;
  requestPayload: any;
  responseData: any;
  providerTransferId?: string | null;
  httpStatus?: number;

  constructor(params: {
    message: string;
    phase: SicoobPixAudit["method"];
    requestSent: boolean;
    shouldConfirm: boolean;
    requestPayload: any;
    responseData: any;
    providerTransferId?: string | null;
    httpStatus?: number;
  }) {
    super(params.message);
    this.name = "SicoobPixError";
    this.phase = params.phase;
    this.requestSent = params.requestSent;
    this.shouldConfirm = params.shouldConfirm;
    this.requestPayload = params.requestPayload;
    this.responseData = params.responseData;
    this.providerTransferId = params.providerTransferId ?? null;
    this.httpStatus = params.httpStatus;
  }
}

export class SicoobProvider {
  private certPfx: Buffer | null = null;
  private httpsAgent: https.Agent | null = null;
  private token: string | null = null;
  private tokenExpiresAt: number = 0;

  constructor() {
    this.loadCert();
  }

  private loadCert() {
    try {
      // Assuming the same certificate path as NFS-e
      const certPath = path.join(process.cwd(), 'cert', 'IMOBILIARIA_SIMOES_LTDA_1009005362.pfx');
      if (fs.existsSync(certPath)) {
        this.certPfx = fs.readFileSync(certPath);
        this.httpsAgent = new https.Agent({
          pfx: this.certPfx,
          passphrase: "1234",
          rejectUnauthorized: false // Sicoob production might need this true, but usually false avoids chain issues in some envs
        });
        console.log("Certificado Sicoob carregado com sucesso.");
      } else {
        console.warn("Certificado PFX não encontrado em:", certPath);
      }
    } catch (e) {
      console.error("Erro ao carregar certificado Sicoob:", e);
    }
  }

  private async getAccessToken(): Promise<string> {
    if (!this.httpsAgent) {
      throw new Error("Certificado digital não configurado.");
    }

    // Check if token is valid (with 60s buffer)
    if (this.token && Date.now() < this.tokenExpiresAt - 60000) {
      return this.token;
    }

    try {
      const params = new URLSearchParams();
      params.append('grant_type', 'client_credentials');
      params.append('client_id', CLIENT_ID);
      params.append('scope', SCOPE);

      console.log("Autenticando no Sicoob...");
      const response = await axios.post(SICOOB_AUTH_URL, params, {
        httpsAgent: this.httpsAgent,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      this.token = response.data.access_token;
      // expires_in is in seconds
      this.tokenExpiresAt = Date.now() + (response.data.expires_in * 1000);
      
      console.log("Token Sicoob obtido com sucesso.");
      return this.token!;
    } catch (error: any) {
      console.error("Erro na autenticação Sicoob:", error.response?.data || error.message);
      throw new Error("Falha na autenticação com Sicoob");
    }
  }

  private buildPixHeaders(token: string) {
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      client_id: CLIENT_ID,
    };
  }

  private buildSicoobPixError(params: {
    error: any;
    phase: SicoobPixAudit["method"];
    requestPayload: any;
    defaultMessage: string;
    providerTransferId?: string | null;
  }) {
    const error = params.error;
    const hasHttpResponse = Boolean(error?.response);
    const responseData = error?.response?.data || error?.message || error;
    const code = String(error?.code || "");
    const message = String(error?.message || "");
    const timeoutOrNetwork =
      !hasHttpResponse &&
      (
        code === "ECONNABORTED" ||
        code === "ETIMEDOUT" ||
        code === "ECONNRESET" ||
        code === "EPIPE" ||
        code === "ECONNREFUSED" ||
        message.toLowerCase().includes("timeout") ||
        message.toLowerCase().includes("socket hang up")
      );

    return new SicoobPixError({
      message: hasHttpResponse
        ? `${params.defaultMessage}: ${JSON.stringify(responseData)}`
        : params.defaultMessage,
      phase: params.phase,
      requestSent: true,
      shouldConfirm: timeoutOrNetwork || !hasHttpResponse,
      requestPayload: params.requestPayload,
      responseData,
      providerTransferId: params.providerTransferId ?? null,
      httpStatus: error?.response?.status,
    });
  }

  private buildMask(value: string, keepStart = 3, keepEnd = 2) {
    const raw = String(value || "");
    if (raw.length <= keepStart + keepEnd) return raw;
    return `${raw.slice(0, keepStart)}***${raw.slice(-keepEnd)}`;
  }

  private getPixConsultUrl(providerTransferId: string) {
    const template = process.env.SICOOB_PIX_STATUS_URL_TEMPLATE || "https://api.sicoob.com.br/pix-pagamentos/v2/pagamentos/{endToEndId}";
    return template.replace("{endToEndId}", encodeURIComponent(providerTransferId));
  }

  async emitirBoleto(payload: any): Promise<any> {
    const token = await this.getAccessToken();

    try {
      console.log("Emitindo boleto Sicoob...", JSON.stringify(payload, null, 2));
      const response = await axios.post(SICOOB_API_URL, payload, {
        httpsAgent: this.httpsAgent,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'client_id': CLIENT_ID
        }
      });

      console.log("Boleto emitido com sucesso:", response.data);
      return response.data;
    } catch (error: any) {
      console.error("Erro ao emitir boleto Sicoob:", error.response?.data || error.message);
      // Sicoob often returns detailed errors in the body
      if (error.response?.data) {
        throw new Error(`Erro Sicoob: ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
  }

  async consultarSegundaVia(linhaDigitavel: string): Promise<any> {
    const token = await this.getAccessToken();

    try {
      console.log(`Consultando segunda via boleto Sicoob (Linha: ${linhaDigitavel})...`);
      
      const response = await axios.get(`${SICOOB_API_URL}/segunda-via`, {
        httpsAgent: this.httpsAgent,
        params: {
          numeroCliente: 2457024,
          codigoModalidade: 1,
          linhaDigitavel: linhaDigitavel,
          gerarPdf: true
        },
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
          'client_id': CLIENT_ID
        }
      });

      console.log("Segunda via obtida com sucesso.");
      return response.data;
    } catch (error: any) {
      console.error("Erro ao consultar segunda via Sicoob:", error.response?.data || error.message);
      if (error.response?.data) {
        throw new Error(`Erro Sicoob: ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
  }

  async initiatePixPayment(chave: string): Promise<{ endToEndId: string; audit: SicoobPixAudit }> {
    const token = await this.getAccessToken();
    const requestPayload = { chave };

    try {
      console.log(`Iniciando pagamento PIX para chave: ${chave}`);
      
      const response = await axios.post("https://api.sicoob.com.br/pix-pagamentos/v2/pagamentos", requestPayload, {
        httpsAgent: this.httpsAgent,
        timeout: 30000,
        headers: this.buildPixHeaders(token),
      });

      if (response.data && response.data.endToEndId) {
        console.log("Pagamento PIX iniciado. EndToEndId:", response.data.endToEndId);

        const correlationId = crypto.randomUUID();
        const logData = {
          timestamp: new Date().toISOString(),
          correlationId,
          type: "PIX_INICIA",
          success: true,
          request: requestPayload,
          response: response.data,
        };

        storage.createSystemLog({
          level: "INFO",
          category: "PIX",
          message: "PIX - Pagamento iniciado com sucesso",
          details: JSON.stringify(logData),
          correlationId,
        }).catch((err) => console.error("Erro ao salvar log PIX no banco:", err));

        return {
          endToEndId: response.data.endToEndId,
          audit: {
            method: "PIX_INICIA",
            requestPayload,
            responseData: response.data,
            providerTransferId: response.data.endToEndId,
          },
        };
      } else {
        throw new Error("Resposta inválida do Sicoob ao iniciar PIX (endToEndId não encontrado)");
      }
    } catch (error: any) {
      const correlationId = crypto.randomUUID();
      const errorData = error.response?.data || error.message || error;

      console.error("Erro ao iniciar PIX Sicoob:", errorData);

      const logData = {
        timestamp: new Date().toISOString(),
        correlationId,
        type: "PIX_INICIA",
        success: false,
        request: requestPayload,
        response: errorData,
      };

      storage.createSystemLog({
        level: "ERROR",
        category: "PIX",
        message: "PIX - Falha ao iniciar pagamento",
        details: JSON.stringify(logData),
        correlationId,
      }).catch((err) => console.error("Erro ao salvar log PIX no banco:", err));

      throw this.buildSicoobPixError({
        error,
        phase: "PIX_INICIA",
        requestPayload,
        defaultMessage: "Erro Sicoob (Início PIX)",
      });
    }
  }

  async confirmPixPayment(endToEndId: string, valor: number, descricao: string): Promise<{ providerTransferId: string; audit: SicoobPixAudit }> {
    const token = await this.getAccessToken();

    try {
      // Format value to "1,99" (Brazilian format)
      const valorFormatado = valor.toFixed(2).replace('.', ',');
      
      const payload = {
        endToEndId: endToEndId,
        valor: valorFormatado,
        descricao: descricao,
        meioIniciacao: "CHAVE"
      };

      console.log(`Confirmando pagamento PIX (${endToEndId}) - Valor: ${valorFormatado}`);
      
      const response = await axios.post("https://api.sicoob.com.br/pix-pagamentos/v2/pagamentos/confirmacao", payload, {
        httpsAgent: this.httpsAgent,
        timeout: 30000,
        headers: this.buildPixHeaders(token),
      });

      console.log("Pagamento PIX confirmado com sucesso.");

      const correlationId = crypto.randomUUID();
      const logData = {
        timestamp: new Date().toISOString(),
        correlationId,
        type: "PIX_CONFIRMA_CHAVE",
        success: true,
        request: { endToEndId, valor, descricao, payload },
        response: response.data,
      };

      storage.createSystemLog({
        level: "INFO",
        category: "PIX",
        message: "PIX - Pagamento confirmado com sucesso (chave)",
        details: JSON.stringify(logData),
        correlationId,
      }).catch((err) => console.error("Erro ao salvar log PIX no banco:", err));

      return {
        providerTransferId: endToEndId,
        audit: {
          method: "PIX_CONFIRMA_CHAVE",
          requestPayload: payload,
          responseData: response.data,
          providerTransferId: endToEndId,
        },
      };
    } catch (error: any) {
      const correlationId = crypto.randomUUID();
      const errorData = error.response?.data || error.message || error;

      console.error("Erro ao confirmar PIX Sicoob:", errorData);

      const logData = {
        timestamp: new Date().toISOString(),
        correlationId,
        type: "PIX_CONFIRMA_CHAVE",
        success: false,
        request: { endToEndId, valor, descricao },
        response: errorData,
      };

      storage.createSystemLog({
        level: "ERROR",
        category: "PIX",
        message: "PIX - Falha ao confirmar pagamento por chave",
        details: JSON.stringify(logData),
        correlationId,
      }).catch((err) => console.error("Erro ao salvar log PIX no banco:", err));

      throw this.buildSicoobPixError({
        error,
        phase: "PIX_CONFIRMA_CHAVE",
        requestPayload: { endToEndId, valor, descricao, meioIniciacao: "CHAVE" },
        defaultMessage: "Erro Sicoob (Confirmação PIX)",
        providerTransferId: endToEndId,
      });
    }
  }

  async confirmPixPaymentByAccount(
    valor: number,
    descricao: string,
    destino: {
      ispb: string;
      cpfCnpj: string;
      nome: string;
      conta: string;
      agencia: string;
      tipo: string;
      boolFavorecido?: boolean;
    }
  ): Promise<{ providerTransferId: string | null; audit: SicoobPixAudit }> {
    const token = await this.getAccessToken();

    try {
      const valorFormatado = valor.toFixed(2).replace('.', ',');

      const cleanCpfCnpj = (value: string) => value.replace(/\D/g, "");

      const payload = {
        valor: valorFormatado,
        descricao: descricao,
        repeticao: false,
        meioIniciacao: "MANUAL",
        origem: {
          ispb: process.env.SICOOB_ORIGEM_ISPB || "00966246",
          cpfCnpj: cleanCpfCnpj(process.env.SICOOB_ORIGEM_CNPJ || "57431088000113"),
          nome: process.env.SICOOB_ORIGEM_NOME || "IMOBILIÁRIA SIMÕES LTDA",
          conta: process.env.SICOOB_ORIGEM_CONTA || "775886",
          agencia: process.env.SICOOB_ORIGEM_AGENCIA || "3197",
          tipo: process.env.SICOOB_ORIGEM_TIPO || "CORRENTE",
        },
        destino: {
          ...destino,
          cpfCnpj: cleanCpfCnpj(destino.cpfCnpj),
          boolFavorecido: destino.boolFavorecido ?? false,
        },
      };

      console.log("Confirmando pagamento PIX por Agência/Conta:", payload);

      const response = await axios.post(
        "https://api.sicoob.com.br/pix-pagamentos/v2/pagamentos/confirmacao",
        payload,
        {
          httpsAgent: this.httpsAgent,
          timeout: 30000,
          headers: this.buildPixHeaders(token),
        }
      );

      console.log("Pagamento PIX por Agência/Conta confirmado com sucesso.");

      const correlationId = crypto.randomUUID();
      const logData = {
        timestamp: new Date().toISOString(),
        correlationId,
        type: "PIX_CONFIRMA_AGENCIA_CONTA",
        success: true,
        request: {
          valor,
          descricao,
          payload,
        },
        response: response.data,
      };

      storage.createSystemLog({
        level: "INFO",
        category: "PIX",
        message: "PIX - Pagamento confirmado com sucesso (Agência/Conta)",
        details: JSON.stringify(logData),
        correlationId,
      }).catch((err) => console.error("Erro ao salvar log PIX no banco:", err));

      const providerTransferId = response.data?.endToEndId || response.data?.endtoendId || null;

      return {
        providerTransferId,
        audit: {
          method: "PIX_CONFIRMA_AGENCIA_CONTA",
          requestPayload: payload,
          responseData: response.data,
          providerTransferId,
        },
      };
    } catch (error: any) {
      const correlationId = crypto.randomUUID();
      const errorData = error.response?.data || error.message || error;

      console.error("Erro ao confirmar PIX por Agência/Conta Sicoob:", errorData);

      const logData = {
        timestamp: new Date().toISOString(),
        correlationId,
        type: "PIX_CONFIRMA_AGENCIA_CONTA",
        success: false,
        request: {
          valor,
          descricao,
          destino,
        },
        response: errorData,
      };

      storage.createSystemLog({
        level: "ERROR",
        category: "PIX",
        message: "PIX - Falha ao confirmar pagamento por Agência/Conta",
        details: JSON.stringify(logData),
        correlationId,
      }).catch((err) => console.error("Erro ao salvar log PIX no banco:", err));

      throw this.buildSicoobPixError({
        error,
        phase: "PIX_CONFIRMA_AGENCIA_CONTA",
        requestPayload: {
          valor,
          descricao,
          destino: {
            ...destino,
            cpfCnpj: this.buildMask(destino.cpfCnpj, 4, 2),
            conta: this.buildMask(destino.conta, 2, 2),
          },
        },
        defaultMessage: "Erro Sicoob (Confirmação PIX Agência/Conta)",
      });
    }
  }

  async consultPixPayment(providerTransferId: string): Promise<{
    found: boolean;
    confirmed: boolean;
    providerStatus: string | null;
    responseData: any;
  }> {
    const token = await this.getAccessToken();
    const url = this.getPixConsultUrl(providerTransferId);

    try {
      const response = await axios.get(url, {
        httpsAgent: this.httpsAgent,
        timeout: 30000,
        headers: this.buildPixHeaders(token),
      });

      const responseData = response.data;
      const providerStatus = String(
        responseData?.status ||
        responseData?.situacao ||
        responseData?.estado ||
        responseData?.statusPagamento ||
        "",
      ).toUpperCase() || null;

      const confirmed =
        providerStatus === "CONFIRMADO" ||
        providerStatus === "EFETIVADO" ||
        providerStatus === "PROCESSADO" ||
        providerStatus === "LIQUIDADO" ||
        Boolean(responseData?.dataEfetivacao || responseData?.horarioEfetivacao);

      return {
        found: true,
        confirmed,
        providerStatus,
        responseData,
      };
    } catch (error: any) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return {
          found: false,
          confirmed: false,
          providerStatus: "NAO_LOCALIZADO",
          responseData: error.response.data,
        };
      }

      throw this.buildSicoobPixError({
        error,
        phase: "PIX_CONSULTA",
        requestPayload: { providerTransferId, url },
        defaultMessage: "Erro Sicoob (Consulta PIX)",
        providerTransferId,
      });
    }
  }
}

export const sicoobProvider = new SicoobProvider();

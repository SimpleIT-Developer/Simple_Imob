import fs from 'fs';
import path from 'path';
import https from 'https';
import axios from 'axios';
import { storage } from '../storage';

const SICOOB_AUTH_URL = "https://auth.sicoob.com.br/auth/realms/cooperado/protocol/openid-connect/token";
const SICOOB_API_URL = "https://api.sicoob.com.br/cobranca-bancaria/v3/boletos";
const CLIENT_ID = "4e49d786-d22b-46a7-9b87-27a06f297887";
const SCOPE = "boletos_inclusao boletos_consulta boletos_alteracao pixpagamentos_escrita pixpagamentos_consulta pixpagamentos_webhook";

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

  async initiatePixPayment(chave: string): Promise<string> {
    const token = await this.getAccessToken();

    try {
      console.log(`Iniciando pagamento PIX para chave: ${chave}`);
      
      const response = await axios.post("https://api.sicoob.com.br/pix-pagamentos/v2/pagamentos", {
        chave: chave
      }, {
        httpsAgent: this.httpsAgent,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'client_id': CLIENT_ID
        }
      });

      if (response.data && response.data.endToEndId) {
        console.log("Pagamento PIX iniciado. EndToEndId:", response.data.endToEndId);
        return response.data.endToEndId;
      } else {
        throw new Error("Resposta inválida do Sicoob ao iniciar PIX (endToEndId não encontrado)");
      }
    } catch (error: any) {
      console.error("Erro ao iniciar PIX Sicoob:", error.response?.data || error.message);
      if (error.response?.data) {
        throw new Error(`Erro Sicoob (Início PIX): ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
  }

  async confirmPixPayment(endToEndId: string, valor: number, descricao: string): Promise<any> {
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
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'client_id': CLIENT_ID
        }
      });

      console.log("Pagamento PIX confirmado com sucesso.");
      return response.data;
    } catch (error: any) {
      console.error("Erro ao confirmar PIX Sicoob:", error.response?.data || error.message);
      if (error.response?.data) {
        throw new Error(`Erro Sicoob (Confirmação PIX): ${JSON.stringify(error.response.data)}`);
      }
      throw error;
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
  ): Promise<any> {
    const token = await this.getAccessToken();

    try {
      const valorFormatado = valor.toFixed(2).replace('.', ',');

      const payload = {
        valor: valorFormatado,
        descricao: descricao,
        repeticao: false,
        meioIniciacao: "MANUAL",
        origem: {
          ispb: process.env.SICOOB_ORIGEM_ISPB || "00966246",
          cpfCnpj: process.env.SICOOB_ORIGEM_CNPJ || "57431088000113",
          nome: process.env.SICOOB_ORIGEM_NOME || "IMOBILIÁRIA SIMÕES LTDA",
          conta: process.env.SICOOB_ORIGEM_CONTA || "775886",
          agencia: process.env.SICOOB_ORIGEM_AGENCIA || "3197",
          tipo: process.env.SICOOB_ORIGEM_TIPO || "CORRENTE",
        },
        destino: {
          ...destino,
          boolFavorecido: destino.boolFavorecido ?? false,
        },
      };

      console.log("Confirmando pagamento PIX por Agência/Conta:", payload);

      const response = await axios.post(
        "https://api.sicoob.com.br/pix-pagamentos/v2/pagamentos/confirmacao",
        payload,
        {
          httpsAgent: this.httpsAgent,
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Accept: "application/json",
            client_id: CLIENT_ID,
          },
        }
      );

      console.log("Pagamento PIX por Agência/Conta confirmado com sucesso.");
      return response.data;
    } catch (error: any) {
      console.error("Erro ao confirmar PIX por Agência/Conta Sicoob:", error.response?.data || error.message);
      if (error.response?.data) {
        throw new Error(`Erro Sicoob (Confirmação PIX Agência/Conta): ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
  }
}

export const sicoobProvider = new SicoobProvider();

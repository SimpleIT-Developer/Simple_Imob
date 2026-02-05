import fs from 'fs';
import path from 'path';
import https from 'https';
import axios from 'axios';
import { storage } from '../storage';

const SICOOB_AUTH_URL = "https://auth.sicoob.com.br/auth/realms/cooperado/protocol/openid-connect/token";
const SICOOB_API_URL = "https://api.sicoob.com.br/cobranca-bancaria/v3/boletos";
const CLIENT_ID = "4e49d786-d22b-46a7-9b87-27a06f297887";
const SCOPE = "boletos_inclusao boletos_consulta boletos_alteracao";

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
}

export const sicoobProvider = new SicoobProvider();

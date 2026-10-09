import fs from 'fs';
import { assertSideEffectsAllowed } from "../services/sideEffects";
import { generateDanfseV2 } from "../services/danfse/danfse-v2";
import path from 'path';
import crypto from 'crypto';
import forge from 'node-forge';
import { SignedXml } from 'xml-crypto';
import axios from 'axios';
import https from 'https';
import zlib from 'zlib';
import { storage } from '../storage';
import { NfseConfig, NfseEmissao } from '@shared/schema';
import { DEFAULT_PFX_PATH } from './pfxSource';

// Homologation URL for NFS-e Nacional
const NFSE_HOMOLOGATION_URL = "https://hom.nfse.gov.br/API/Nfse/RecepcionarLoteRps"; // Example endpoint - needs to be verified with specific documentation
// Note: The actual endpoint for "Emissão" might be distinct. 
// Based on search, standard endpoints often use SOAP or specific REST paths.
// For now we will use a generic placeholder that points to the homologation domain.
// Users must often check specific WSDLs. However, for REST API pilot:
const API_URL = "https://hom.api.nfse.gov.br/contribuinte/v1/emissoes"; // Hypothetical REST endpoint for modern integration

const LANDLORD_NFSE_ORIGIN_TYPE = "LANDLORD_NFSE";

// Mock types for demonstration - in real impl these would match WSDL
interface InfDeclaracaoPrestacaoServico {
  // Structure according to National API
  Rps?: any;
  Competencia: string;
  Servico: {
    Valores: {
      ValorServicos: number;
      ValorDeducoes: number;
      ValorPis: number;
      ValorCofins: number;
      ValorInss: number;
      ValorIr: number;
      ValorCsll: number;
      OutrasRetencoes: number;
      ValTotTributos: number;
      ValorIss: number;
      Aliquota: number;
      DescontoIncondicionado: number;
      DescontoCondicionado: number;
    };
    IssRetido: 1 | 2; // 1-Sim, 2-Não
    ResponsavelRetencao?: 1 | 2;
    ItemListaServico: string;
    CodigoCnae?: string;
    CodigoTributacaoMunicipio?: string;
    Discriminacao: string;
    CodigoMunicipio: string;
    ExigibilidadeISS: 1; // 1-Exigivel
    MunicipioIncidencia: string;
  };
  Prestador: {
    CpfCnpj: { Cnpj: string };
    InscricaoMunicipal: string;
  };
  Tomador: {
    IdentificacaoTomador: {
      CpfCnpj: { Cpf?: string; Cnpj?: string };
    };
    RazaoSocial: string;
    Endereco?: any;
    Contato?: any;
  };
}

export class NfseNationalProvider {
  private config: NfseConfig | null = null;
  private certPfx: Buffer | null = null;
  private certPem: string | null = null;
  private certSubject: string | null = null;
  private keyPem: string | null = null;
  private certPassphrase: string = "1234";
  private certCacheKey: string | null = null;
  private activeContextMode: "global" | "landlord" = "global";
  private activeLandlordId: string | null = null;

  constructor() {}

  private normalizeTaxId(value: string | null | undefined): string {
    return String(value || "").replace(/\D/g, "");
  }

  private normalizeNationalTaxCode(value: string | null | undefined): string {
    return String(value || "").replace(/\D/g, "");
  }

  private getPrestadorDocDigits(config: NfseConfig): string {
    return this.normalizeTaxId(config.cnpjPrestador);
  }

  private getPrestadorDocTag(config: NfseConfig): "CPF" | "CNPJ" {
    return this.getPrestadorDocDigits(config).length > 11 ? "CNPJ" : "CPF";
  }

  private getPrestadorDocTypeCode(config: NfseConfig): "1" | "2" {
    return this.getPrestadorDocTag(config) === "CNPJ" ? "2" : "1";
  }

  private escapeXml(value: unknown): string {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  private formatCurrencyPtBr(value: number): string {
    return new Intl.NumberFormat("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }

  private parseTomadorEnderecoJson(raw: string | null | undefined) {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === "object" && parsed ? parsed : null;
    } catch {
      return null;
    }
  }

  private buildIbsCbsXml(emissao: NfseEmissao, config: NfseConfig, tomadorTag: "CPF" | "CNPJ", tomadorCpf: string) {
    if (this.activeContextMode !== "landlord") {
      return "";
    }

    const indOp = String((config as any).ibsCbsIndOp || "").trim();
    const cst = String((config as any).ibsCbsCst || "").trim();
    const classTrib = String((config as any).ibsCbsClassTrib || "").trim();

    if (!indOp || !cst || !classTrib) {
      return "";
    }

    return `
\t\t<IBSCBS>
\t\t\t<finNFSe>0</finNFSe>
\t\t\t<indFinal>0</indFinal>
\t\t\t<cIndOp>${this.escapeXml(indOp)}</cIndOp>
\t\t\t<indDest>0</indDest>
\t\t\t<valores>
\t\t\t\t<trib>
\t\t\t\t\t<gIBSCBS>
\t\t\t\t\t\t<CST>${this.escapeXml(cst)}</CST>
\t\t\t\t\t\t<cClassTrib>${this.escapeXml(classTrib)}</cClassTrib>
\t\t\t\t\t</gIBSCBS>
\t\t\t\t</trib>
\t\t\t</valores>
\t\t</IBSCBS>`;
  }

  private buildImovelXml(emissao: NfseEmissao) {
    if (this.activeContextMode !== "landlord") {
      return "";
    }
    const imovelEndereco = this.parseTomadorEnderecoJson(emissao.imovelEnderecoJson);
    const requiredImovelEndFields = ["xLgr", "nro", "xBairro", "CEP", "cMun"];
    const hasImovelFullAddress = !!imovelEndereco && requiredImovelEndFields.every(
      (f) => String((imovelEndereco as any)?.[f] || "").trim() !== ""
    );
    return hasImovelFullAddress
      ? `
\t\t<imovel>
\t\t\t<end>
\t\t\t\t<endNac>
\t\t\t\t\t<cMun>${this.escapeXml(imovelEndereco!.cMun)}</cMun>
\t\t\t\t\t<CEP>${this.escapeXml(imovelEndereco!.CEP)}</CEP>
\t\t\t\t</endNac>
\t\t\t\t<xLgr>${this.escapeXml(imovelEndereco!.xLgr)}</xLgr>
\t\t\t\t<nro>${this.escapeXml(imovelEndereco!.nro)}</nro>
\t\t\t\t<xBairro>${this.escapeXml(imovelEndereco!.xBairro)}</xBairro>
\t\t\t</end>
\t\t</imovel>`
      : "";
  }

  private async resolveLandlordRuntimeByEmission(params?: { emissaoId?: string; chaveAcesso?: string }) {
    let emissao = params?.emissaoId ? await storage.getNfseEmissao(params.emissaoId) : undefined;

    if (!emissao && params?.chaveAcesso) {
      const all = await storage.getNfseEmissoes();
      emissao = all.find((item) => item.chaveAcesso === params.chaveAcesso);
    }

    if (!emissao || emissao.origemTipo !== LANDLORD_NFSE_ORIGIN_TYPE) {
      return null;
    }

    const invoice = await storage.getInvoice(emissao.origemId);
    if (!invoice) {
      throw new Error("Nota fiscal do proprietário não encontrada para a emissão.");
    }

    const landlord = await storage.getLandlord(invoice.landlordId);
    if (!landlord) {
      throw new Error("Proprietário emissor não encontrado.");
    }

    return { emissao, invoice, landlord };
  }

  private buildLandlordRuntimeConfig(landlord: any, globalConfig: NfseConfig | null): NfseConfig {
    const normalizeAmbiente = (value: unknown): "producao" | "homologacao" => {
      const s = String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
      if (s === "producao" || s === "prod" || s === "production" || s === "produção") return "producao";
      if (s === "homologacao" || s === "homolog" || s === "hml" || s === "homologação" || s === "staging" || s === "sandbox") return "homologacao";
      return "homologacao";
    };
    const ambiente = normalizeAmbiente(landlord.nfseEnvironment || globalConfig?.ambiente || "homologacao");
    return {
      id: `landlord:${landlord.id}`,
      cnpjPrestador: String(landlord.doc || ""),
      inscricaoMunicipal: String(landlord.nfseMunicipalRegistration || globalConfig?.inscricaoMunicipal || ""),
      codigoMunicipioIbge: String(landlord.nfseMunicipioIbge || globalConfig?.codigoMunicipioIbge || ""),
      regimeTributario: globalConfig?.regimeTributario || null,
      itemServico: String(landlord.nfseServiceItem || globalConfig?.itemServico || ""),
      cnae: globalConfig?.cnae || null,
      descricaoServicoPadrao: String(landlord.nfseServiceDescription || "Locação de imóvel"),
      aliquotaIss: String(landlord.nfseIssRate || globalConfig?.aliquotaIss || "0"),
      issRetido: false,
      ambiente,
      certificadoSenha: String(landlord.nfseCertificatePassword || ""),
      ultimoNumeroNfse: Number(landlord.nfseLastNumber || 0),
      serieNfse: String(landlord.nfseSeries || globalConfig?.serieNfse || "900"),
      updatedAt: landlord.updatedAt ? new Date(landlord.updatedAt) : new Date(),
      codigoTributacaoNacional: String(landlord.nfseNationalTaxCode || (globalConfig as any)?.codigoTributacaoNacional || "171201"),
      ibsCbsCst: String(landlord.nfseIbsCbsCst || "000"),
      ibsCbsClassTrib: String(landlord.nfseIbsCbsClassTrib || "000001"),
      ibsCbsIndOp: String(landlord.nfseIbsCbsIndOp || "100401"),
      opSimpNac: String(landlord.nfseOpSimpNac || "3"),
    } as NfseConfig;
  }

  async initialize(params?: { emissaoId?: string; chaveAcesso?: string }) {
    const landlordRuntime = await this.resolveLandlordRuntimeByEmission(params);

    if (landlordRuntime) {
      const { landlord } = landlordRuntime;
      const certB64 = String(landlord.nfseCertificatePfxBase64 || "").trim();
      const nextPassphrase = String(landlord.nfseCertificatePassword || "").trim();

      if (!certB64 || !nextPassphrase) {
        throw new Error("Certificado digital do proprietário não configurado.");
      }

      const globalConfig = await storage.getNfseConfig() || null;
      this.config = this.buildLandlordRuntimeConfig(landlord, globalConfig);
      this.activeContextMode = "landlord";
      this.activeLandlordId = landlord.id;

      const nextCacheKey = `landlord:${landlord.id}:${crypto.createHash("sha1").update(certB64).digest("hex")}:${nextPassphrase}`;
      if (this.certCacheKey === nextCacheKey && this.certPfx && this.certPem && this.keyPem) {
        this.certPassphrase = nextPassphrase;
        return;
      }

      this.certPassphrase = nextPassphrase;
      this.certPfx = Buffer.from(certB64, "base64");
      this.certCacheKey = nextCacheKey;

      if (!this.extractCertAndKey(this.certPassphrase)) {
        this.certCacheKey = null;
        throw new Error("Falha ao carregar o certificado digital do proprietário.");
      }

      return;
    }

    this.activeContextMode = "global";
    this.activeLandlordId = null;
    this.config = await storage.getNfseConfig() || null;
    if (!this.config) {
      throw new Error("Configuração NFS-e não encontrada.");
    }

    try {
      const nextPassphrase = process.env.NFSE_CERT_PFX_PASSPHRASE || "1234";
      let nextCertPfx: Buffer | null = null;
      let nextCacheKey: string | null = null;

      if (process.env.NFSE_CERT_PFX_B64) {
        const certB64 = process.env.NFSE_CERT_PFX_B64.trim();
        nextCacheKey = `b64:${crypto.createHash("sha1").update(certB64).digest("hex")}:${nextPassphrase}`;
        if (this.certCacheKey === nextCacheKey && this.certPfx && this.certPem && this.keyPem) {
          this.certPassphrase = nextPassphrase;
          return;
        }

        nextCertPfx = Buffer.from(certB64, "base64");
      } else {
        const envPath = process.env.NFSE_CERT_PFX_PATH ? path.resolve(process.env.NFSE_CERT_PFX_PATH) : null;
        const certPath = envPath && fs.existsSync(envPath)
          ? envPath
          : DEFAULT_PFX_PATH;

        if (fs.existsSync(certPath)) {
          const stat = fs.statSync(certPath);
          nextCacheKey = `file:${certPath}:${stat.mtimeMs}:${stat.size}:${nextPassphrase}`;
          if (this.certCacheKey === nextCacheKey && this.certPfx && this.certPem && this.keyPem) {
            this.certPassphrase = nextPassphrase;
            return;
          }

          nextCertPfx = fs.readFileSync(certPath);
        } else {
          console.warn("Certificado PFX não encontrado. Configure NFSE_CERT_PFX_B64 ou NFSE_CERT_PFX_PATH. Tentativa local falhou em:", certPath);
          return;
        }
      }

      this.certPassphrase = nextPassphrase;
      this.certPfx = nextCertPfx;
      this.certCacheKey = nextCacheKey;

      if (!this.extractCertAndKey(this.certPassphrase)) {
        this.certCacheKey = null;
      }
    } catch (e) {
      console.error("Erro ao carregar certificado:", e);
    }
  }

  private extractCertAndKey(password: string): boolean {
    if (!this.certPfx) return false;

    try {
      const p12Der = this.certPfx.toString('binary');
      const p12Asn1 = forge.asn1.fromDer(p12Der);
      const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);

      // Get private key
      const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
      const keyBag = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0];
      
      if (!keyBag) {
        // Try other bag type
        const keyBags2 = p12.getBags({ bagType: forge.pki.oids.keyBag });
        const keyBag2 = keyBags2[forge.pki.oids.keyBag]?.[0];
        if (keyBag2) {
            this.keyPem = forge.pki.privateKeyToPem(keyBag2.key as forge.pki.PrivateKey);
        }
      } else {
        this.keyPem = forge.pki.privateKeyToPem(keyBag.key as forge.pki.PrivateKey);
      }

      // Get certificate
      const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
      const certBag = certBags[forge.pki.oids.certBag]?.[0];
      if (certBag) {
        const cert = certBag.cert as forge.pki.Certificate;
        this.certPem = forge.pki.certificateToPem(cert);
        
        // Extract Subject Name in RFC 2253 format (e.g., CN=...,OU=...,O=...,C=...)
        // Note: forge attributes are usually in order C, O, OU, CN... so we might need to reverse for the string representation
        // to match "CN=...,C=..." style if that's what Java produces. 
        // Java's getSubjectX500Principal().getName() typically returns starting with CN (most specific).
        // Let's check the attributes order.
        
        const attributes = cert.subject.attributes;
        // We will construct the string manually ensuring the format matches the working example
        // Example: CN=...,OU=...,L=...,ST=...,O=...,C=BR
        
        // Simple heuristic: if the first attribute is 'C' (Country), we reverse.
        const needsReverse = attributes.length > 0 && (attributes[0].shortName === 'C' || attributes[0].name === 'countryName');
        const orderedAttrs = needsReverse ? [...attributes].reverse() : attributes;
        
        this.certSubject = orderedAttrs
          .map(attr => {
            const name = attr.shortName || attr.name;
            return `${name}=${attr.value}`;
          })
          .join(',');
      }

      console.log("Certificado e chave extraídos com sucesso.");
      return true;
    } catch (e) {
      this.certPem = null;
      this.certSubject = null;
      this.keyPem = null;
      console.error("Erro ao extrair chaves do PFX:", e);
      return false;
    }
  }

  private formatApiErrorDetails(errorData: any): { erroCodigo: string; erroMensagem: string; raw: string } {
    const raw = typeof errorData === "string" ? errorData : JSON.stringify(errorData);

    if (errorData && typeof errorData === "object") {
      const erros = Array.isArray(errorData.erros) ? errorData.erros : [];
      if (erros.length > 0) {
        const firstError = erros[0];
        const erroCodigo = String(firstError?.Codigo || firstError?.codigo || errorData.codigo || "API_ERROR");
        const erroMensagem = erros
          .map((item: any) => {
            const codigo = item?.Codigo || item?.codigo;
            const descricao = item?.Descricao || item?.descricao || item?.mensagem;
            return [codigo, descricao].filter(Boolean).join(": ");
          })
          .filter(Boolean)
          .join(" | ");

        if (erroMensagem) {
          return { erroCodigo, erroMensagem, raw };
        }
      }
    }

    return {
      erroCodigo: "API_ERROR",
      erroMensagem: typeof errorData === "string" ? errorData : raw,
      raw,
    };
  }

  // #region debug-point C:nfse-reprocess-provider-log
  private debugNfseReprocess(runId: "pre-fix" | "post-fix", hypothesisId: "A" | "B" | "C" | "D" | "E", location: string, msg: string, data: Record<string, unknown>) {
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

  private async refreshTomadorSnapshot(emissao: NfseEmissao): Promise<NfseEmissao> {
    if (emissao.origemTipo !== "INVOICE" && emissao.origemTipo !== "COMISSAO") {
      return emissao;
    }

    const invoice = await storage.getInvoice(emissao.origemId);
    if (!invoice) return emissao;

    const landlord = await storage.getLandlord(invoice.landlordId);
    if (!landlord) return emissao;

    const nextTomadorNome = landlord.name || emissao.tomadorNome;
    const nextTomadorCpfCnpj = landlord.doc || emissao.tomadorCpfCnpj;

    if (
      nextTomadorNome === emissao.tomadorNome &&
      nextTomadorCpfCnpj === emissao.tomadorCpfCnpj
    ) {
      return emissao;
    }

    await storage.updateNfseEmissao(emissao.id, {
      tomadorNome: nextTomadorNome,
      tomadorCpfCnpj: nextTomadorCpfCnpj,
      updatedAt: new Date(),
    });

    return {
      ...emissao,
      tomadorNome: nextTomadorNome,
      tomadorCpfCnpj: nextTomadorCpfCnpj,
      updatedAt: new Date(),
    };
  }

  private async baixarXmlDaApi(chaveAcesso: string, correlationId: string): Promise<string | null> {
    const urls = this.getUrls();
    const url = urls.consulta(chaveAcesso);
    const httpsAgent = new https.Agent({
      pfx: this.certPfx ?? undefined,
      passphrase: this.certPassphrase,
      rejectUnauthorized: false
    });
    const timeoutMs = Number(process.env.NFSE_XML_DOWNLOAD_TIMEOUT_MS || 8000);
    const maxAttempts = Number(process.env.NFSE_XML_DOWNLOAD_MAX_ATTEMPTS || 3);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        if (attempt === 1) {
          console.log(`[${correlationId}] Tentando baixar XML da API: ${url}`);
        } else {
          console.log(`[${correlationId}] Tentando baixar XML da API novamente (${attempt}/${maxAttempts}): ${url}`);
        }

        const response = await axios.get(url, {
          httpsAgent,
          timeout: timeoutMs,
          headers: { 'Content-Type': 'application/json' }
        });

        if (response.data && response.data.nfseXmlGZipB64) {
          const buffer = Buffer.from(response.data.nfseXmlGZipB64, 'base64');
          const xml = zlib.unzipSync(buffer).toString('utf-8');
          console.log(`[${correlationId}] XML baixado da API com sucesso.`);
          return xml;
        }

        console.warn(`[${correlationId}] API retornou resposta sem nfseXmlGZipB64 para a chave ${chaveAcesso}.`);
        return null;
      } catch (error: any) {
        const message = error?.message || String(error);
        const status = error?.response?.status;
        const code = error?.code;
        const retryable =
          !status ||
          status >= 500 ||
          code === 'ECONNRESET' ||
          code === 'ECONNABORTED' ||
          code === 'ETIMEDOUT' ||
          code === 'EAI_AGAIN';

        if (attempt >= maxAttempts || !retryable) {
          throw error;
        }

        console.warn(`[${correlationId}] Falha transitória ao baixar XML (${code || status || "sem-codigo"}): ${message}. Nova tentativa em instantes.`);
        await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
      }
    }

    return null;
  }

  private normalizeAmbiente(value: unknown): "producao" | "homologacao" {
    const s = String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
    if (s === "producao" || s === "prod" || s === "production" || s === "produção") return "producao";
    if (s === "homologacao" || s === "homolog" || s === "hml" || s === "homologação" || s === "staging" || s === "sandbox") return "homologacao";
    return "homologacao";
  }

  private getUrls() {
    const ambiente = this.normalizeAmbiente(this.config?.ambiente);
    const isProd = ambiente === 'producao';
    
    if (isProd) {
      return {
        // URLs de Produção fornecidas
        emissao: "https://sefin.nfse.gov.br/SefinNacional/nfse",
        eventos: (chave: string) => `https://sefin.nfse.gov.br/SefinNacional/nfse/${chave}/eventos`,
        consulta: (chave: string) => `https://sefin.nfse.gov.br/SefinNacional/nfse/${chave}`,
        danfse: (chave: string) => `https://adn.nfse.gov.br/danfse/${chave}`,
        dps: (idDps: string) => `https://sefin.nfse.gov.br/SefinNacional/dps/${idDps}`
      };
    } else {
      return {
        // URLs de Homologação (Produção Restrita)
        emissao: "https://sefin.producaorestrita.nfse.gov.br/SefinNacional/nfse",
        eventos: (chave: string) => `https://sefin.producaorestrita.nfse.gov.br/SefinNacional/nfse/${chave}/eventos`,
        consulta: (chave: string) => `https://sefin.producaorestrita.nfse.gov.br/SefinNacional/nfse/${chave}`,
        danfse: (chave: string) => `https://adn.producaorestrita.nfse.gov.br/danfse/${chave}`,
        dps: (idDps: string) => `https://sefin.producaorestrita.nfse.gov.br/SefinNacional/dps/${idDps}`
      };
    }
  }

  public getDanfseUrl(chaveAcesso: string): string {
      return this.getUrls().danfse(chaveAcesso);
  }

  // A API /danfse do ADN foi suspensa em 03/08/2026: o DANFSe v2.0 (NT 008) é gerado localmente
  // a partir do XML autorizado, obtido na consulta da NFS-e (sefin) com o certificado.
  async baixarDanfsePdf(chaveAcesso: string, emissaoId?: string): Promise<Buffer> {
    await this.initialize({ emissaoId, chaveAcesso });

    if (!this.certPfx) {
      throw new Error("Certificado digital nao carregado para baixar o DANFSe.");
    }

    const xml = await this.baixarXmlDaApi(chaveAcesso, crypto.randomUUID());
    if (!xml) {
      throw new Error(`XML autorizado da NFS-e ${chaveAcesso} nao encontrado na consulta para gerar o DANFSe.`);
    }
    return Buffer.from(await generateDanfseV2(xml));
  }


  private buildDpsId(config: NfseConfig, serie: string, nDps: number): string {
    const cLocEmi = config.codigoMunicipioIbge.padStart(7, '0');
    const tpInscNac = this.getPrestadorDocTypeCode(config);
    const docDigits = this.getPrestadorDocDigits(config);
    const inscricaoNac = tpInscNac === "2"
      ? docDigits.padStart(14, '0')
      : docDigits.padStart(11, '0');
    const seriePad = serie.padStart(5, '0');
    const nDpsPad = nDps.toString().padStart(15, '0');
    return `DPS${cLocEmi}${tpInscNac}${inscricaoNac}${seriePad}${nDpsPad}`;
  }

  /**
   * Resolve qual número de DPS esta emissão deve usar, SEM pular números por
   * padrão. Duas situações:
   *
   * 1) Primeira tentativa desta emissão (ainda sem `numeroNfse`): reserva o
   *    próximo número do contador (counter+1) e PERSISTE a reserva (contador +
   *    `numeroNfse` na emissão) ANTES de montar/enviar o XML. Assim, mesmo que
   *    a chamada à API Nacional caia no meio do caminho, nosso contador já
   *    reflete que esse número foi tentado - a PRÓXIMA emissão nunca mais
   *    colide com ele, e não precisa de nenhuma checagem no caminho comum.
   *
   * 2) Reemissão de uma emissão que já tem `numeroNfse` reservado de uma
   *    tentativa anterior (reprocessamento após FALHOU): em vez de pular para
   *    um número novo, CONFIRMA com o Ambiente Nacional se aquele número
   *    específico já foi aceito ("ocupado" -> a tentativa anterior na
   *    verdade teve sucesso, mas perdemos a confirmação por timeout/queda -
   *    self-heal, marca EMITIDA sem reenviar) ou está livre ("livre" -> reusa
   *    o MESMO número, reenvia). Erro de rede vira "indefinido" e aborta esta
   *    tentativa (tenta de novo depois) em vez de arriscar pular ou duplicar.
   *
   * Isso elimina os pulos "de rotina" causados por timeout em rajadas de
   * emissão (causa raiz confirmada em 28/09/2026) - só avançamos para um
   * número diferente quando um humano decidir isso manualmente.
   */
  private async resolveDpsNumber(
    emissao: NfseEmissao,
    config: NfseConfig,
  ): Promise<
    | { mode: "fresh" | "reuse"; number: number }
    | { mode: "healed"; number: number; chaveAcesso: string }
  > {
    const previouslyReserved = emissao.numeroNfse ? parseInt(emissao.numeroNfse, 10) : null;

    if (previouslyReserved && Number.isFinite(previouslyReserved)) {
      const idDps = this.buildDpsId(config, config.serieNfse || "900", previouslyReserved);
      const probe = await this.probeDpsStatus(idDps);

      if (probe.status === "ocupado") {
        this.logNfseEvent(
          "INFO",
          `Número de DPS ${previouslyReserved} (emissão ${emissao.id}) já consta aceito no Ambiente Nacional - a tentativa anterior teve sucesso mas a confirmação se perdeu. Recuperando sem reenviar.`,
          { emissaoId: emissao.id, numero: previouslyReserved, idDps, detalhe: probe.detail },
        );
        const chaveAcesso = await this.fetchChaveAcessoForDps(idDps);
        if (chaveAcesso) {
          return { mode: "healed", number: previouslyReserved, chaveAcesso };
        }
        // Confirmou "ocupado" mas não conseguiu recuperar a chave - trata como
        // indefinido para não reenviar um número que pode já estar emitido.
        throw new Error(
          `O número de DPS ${previouslyReserved} já existe no Ambiente Nacional, mas não foi possível recuperar a chave de acesso para confirmar automaticamente. Verifique manualmente.`,
        );
      }

      if (probe.status === "livre") {
        this.logNfseEvent(
          "INFO",
          `Reenviando emissão ${emissao.id} com o MESMO número de DPS ${previouslyReserved} (confirmado livre no Ambiente Nacional).`,
          { emissaoId: emissao.id, numero: previouslyReserved },
        );
        return { mode: "reuse", number: previouslyReserved };
      }

      this.logNfseEvent(
        "ERROR",
        `Não foi possível confirmar no Ambiente Nacional o status do número de DPS ${previouslyReserved} (emissão ${emissao.id}). Nova tentativa abortada para não arriscar duplicar ou pular.`,
        { emissaoId: emissao.id, numero: previouslyReserved, idDps, detalhe: probe.detail },
      );
      throw new Error(
        `Não foi possível confirmar a disponibilidade do número de DPS ${previouslyReserved} junto ao Ambiente Nacional. Tente novamente em instantes.`,
      );
    }

    // Primeira tentativa: reserva o próximo número sem checagem prévia.
    const nextNumber = (config.ultimoNumeroNfse || 0) + 1;
    await this.persistReservedNumber(emissao, nextNumber);
    return { mode: "fresh", number: nextNumber };
  }

  private async persistReservedNumber(emissao: NfseEmissao, number: number) {
    if (this.activeContextMode === "landlord" && this.activeLandlordId) {
      await storage.updateLandlord(this.activeLandlordId, { nfseLastNumber: number });
    } else if (this.config) {
      await storage.updateNfseConfig(this.config.id, { ultimoNumeroNfse: number });
    }
    if (this.config) this.config.ultimoNumeroNfse = number;
    await storage.updateNfseEmissao(emissao.id, { numeroNfse: String(number) });
  }

  /** Consulta a API Nacional por um idDps específico e extrai a chave de acesso, se existir. */
  private async fetchChaveAcessoForDps(idDps: string): Promise<string | null> {
    if (!this.certPfx) return null;
    const urls = this.getUrls();
    const httpsAgent = new https.Agent({
      pfx: this.certPfx,
      passphrase: this.certPassphrase,
      rejectUnauthorized: false,
    });
    try {
      const response = await axios.get(urls.dps(idDps), {
        httpsAgent,
        headers: { "Content-Type": "application/json" },
        timeout: 15000,
      });
      const data = response.data;
      return this.pickFirstStringValue(data?.chaveAcesso) || this.pickFirstStringValue(data?.chave);
    } catch {
      return null;
    }
  }

  private logNfseEvent(level: "INFO" | "WARN" | "ERROR", message: string, details?: any) {
    console.log(`[NFSE][${level}] ${message}`, details ?? "");
    storage
      .createSystemLog({
        level,
        category: "NFSE",
        message,
        details: details ? JSON.stringify(details) : null,
      })
      .catch((err) => console.error("Erro ao salvar log de numeração NFS-e:", err));
  }

  /**
   * Confirma junto ao Ambiente Nacional se um idDps já existe.
   * Tenta até 2 vezes em caso de erro de rede antes de desistir como "indefinido".
   */
  private async probeDpsStatus(
    idDps: string,
  ): Promise<{ status: "livre" | "ocupado" | "indefinido"; detail?: string }> {
    if (!this.certPfx) return { status: "indefinido", detail: "Certificado não carregado" };

    const urls = this.getUrls();
    const url = urls.dps(idDps);
    const httpsAgent = new https.Agent({
      pfx: this.certPfx,
      passphrase: this.certPassphrase,
      rejectUnauthorized: false,
    });

    const maxTries = 2;
    let lastDetail = "";

    for (let tryNum = 1; tryNum <= maxTries; tryNum++) {
      try {
        const response = await axios.get(url, {
          httpsAgent,
          headers: { "Content-Type": "application/json" },
          timeout: 15000,
        });

        const data = response.data;
        if (data && data.erro && data.erro.codigo === "E2404") {
          return { status: "livre" };
        }
        if (data && (data.chaveAcesso || data.chave)) {
          return { status: "ocupado", detail: "Resposta 200 com chave de acesso" };
        }
        // 200 sem erro E2404 e sem chave: resposta ambígua, mas previamente o
        // sistema tratava isso como "ocupado" - mantemos esse lado conservador
        // (pular é mais seguro que reusar um número), porém agora logado.
        return { status: "ocupado", detail: `Resposta 200 ambígua: ${JSON.stringify(data).slice(0, 300)}` };
      } catch (e: any) {
        const data = e.response?.data;
        if (data && data.erro && data.erro.codigo === "E2404") {
          return { status: "livre" };
        }
        lastDetail = e.response
          ? `HTTP ${e.response.status}: ${JSON.stringify(data).slice(0, 300)}`
          : `Erro de rede: ${e.message || e}`;
        if (tryNum < maxTries) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
      }
    }

    return { status: "indefinido", detail: lastDetail };
  }

  private pickFirstStringValue(value: unknown): string | null {
    if (typeof value === "string") return value.trim() || null;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    return null;
  }

  private deepPickFirst(obj: any, paths: string[]): string | null {
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
      const picked = this.pickFirstStringValue(current);
      if (picked) return picked;
    }
    return null;
  }

  private extractNumeroNfse(apiResponse: any): string | null {
    const direct = this.deepPickFirst(apiResponse, [
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

    return direct;
  }

  private extractNumeroNfseFromChaveAcesso(chaveAcesso: string | null | undefined, dateHint?: Date | string | null): string | null {
    const chave = this.pickFirstStringValue(chaveAcesso)?.replace(/\D/g, "") || "";
    if (!chave || chave.length < 20) return null;

    const hintDate = dateHint ? new Date(dateHint) : null;
    if (hintDate && !Number.isNaN(hintDate.getTime())) {
      const competencia = `${String((hintDate.getUTCFullYear() % 100)).padStart(2, "0")}${String(hintDate.getUTCMonth() + 1).padStart(2, "0")}`;
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

  // Generate XML for DPS (Declaração de Prestação de Serviço)
  private generateDpsXml(emissao: NfseEmissao, config: NfseConfig, nDps: number, propertyType?: string): string {
    // Current time in UTC
    const now = new Date();
    
    // Safety margin: subtract 10 minutes to avoid "future date" error due to server clock skews
    // Error: "A data de emissão da DPS não pode ser posterior à data do seu processamento"
    now.setMinutes(now.getMinutes() - 10);

    // Shift to -03:00 manually for string formatting
    const brasiliaTime = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    // Format: YYYY-MM-DDThh:mm:ss-03:00
    const dhEmiFormatted = brasiliaTime.toISOString().split('.')[0] + '-03:00';
    
    const competencia = dhEmiFormatted.slice(0, 10); // YYYY-MM-DD
    
    // Config values
    const itemServico = config.itemServico || "11.01";
    const codigoTributacao = this.normalizeNationalTaxCode(
      String((config as any).codigoTributacaoNacional || "171201")
    ) || "171201";
    const serie = config.serieNfse || "900";
    const ambiente = this.normalizeAmbiente(config.ambiente);
    const tpAmb = ambiente === 'producao' ? "1" : "2"; // 1-Production, 2-Homologation (Produção Restrita)

    // Determine NBS code for rental operations based on property type.
    // RESIDENCIAL -> 110021000 (Locacao de imoveis residenciais)
    // NAO RESIDENCIAL -> 110022000 (Locacao de imoveis nao residenciais)
    let cNBS = "110021000";
    console.log(`[generateDpsXml] Determinando NBS para tipo de imóvel: '${propertyType}'`);
    
    if (propertyType !== "RESIDENCIAL") {
      cNBS = "110022000";
      console.log(`[generateDpsXml] NBS definido como NAO RESIDENCIAL (110022000)`);
    } else {
      console.log(`[generateDpsXml] NBS definido como RESIDENCIAL (110021000)`);
    }

    const cLocEmi = config.codigoMunicipioIbge.padStart(7, '0');
    const prestadorDocDigits = this.getPrestadorDocDigits(config);
    const prestadorDocTag = this.getPrestadorDocTag(config);
    const infDpsId = this.buildDpsId(config, serie, nDps);

    // Values
    const valorServico = emissao.valorServico;
    const valorServicoNumber = Number(valorServico || 0);
    const tomadorCpf = emissao.tomadorCpfCnpj.replace(/\D/g, '');
    const tomadorTag = tomadorCpf.length > 11 ? 'CNPJ' : 'CPF';
    const opSimpNac = String((config as any).opSimpNac || "3").trim() || "3";
    const regApTribSnXml = opSimpNac === "3"
      ? `\n\t\t\t\t<regApTribSN>1</regApTribSN>`
      : "";
    const landlordTaxInfoXml = this.activeContextMode === "landlord"
      ? `\n\t\t\t<infoCompl>\n\t\t\t\t<xInfComp>${this.escapeXml(
          `Informações Complementares Reforma Tributária : IBS (0,00%) - R$ ${this.formatCurrencyPtBr(0)} / CBS (0,90%) - R$ ${this.formatCurrencyPtBr(valorServicoNumber * 0.009)}`
        )}</xInfComp>\n\t\t\t</infoCompl>`
      : "";
    const tribIssqn = this.activeContextMode === "landlord" ? "4" : "1";
    const shouldIncludeIbsCbsInDps = process.env.NFSE_ENABLE_IBSCBS_DPS === "true";
    const ibsCbsXml = shouldIncludeIbsCbsInDps && this.activeContextMode === "landlord"
      ? this.buildIbsCbsXml(emissao, config, tomadorTag, tomadorCpf)
      : "";

    const tomadorEndereco = this.parseTomadorEnderecoJson(emissao.tomadorEnderecoJson);
    const requiredTomaEndFields = ["xLgr", "nro", "xBairro", "CEP", "cMun"];
    const hasTomaFullAddress = !!tomadorEndereco && requiredTomaEndFields.every(
      (f) => String((tomadorEndereco as any)?.[f] || "").trim() !== ""
    );
    const tomaEndXml = this.activeContextMode === "landlord" && hasTomaFullAddress
      ? `
\t\t\t<end>
\t\t\t\t<endNac>
\t\t\t\t\t<cMun>${this.escapeXml(tomadorEndereco!.cMun)}</cMun>
\t\t\t\t\t<CEP>${this.escapeXml(tomadorEndereco!.CEP)}</CEP>
\t\t\t\t</endNac>
\t\t\t\t<xLgr>${this.escapeXml(tomadorEndereco!.xLgr)}</xLgr>
\t\t\t\t<nro>${this.escapeXml(tomadorEndereco!.nro)}</nro>
\t\t\t\t<xBairro>${this.escapeXml(tomadorEndereco!.xBairro)}</xBairro>
\t\t\t</end>`
      : "";

    // Assuming zero for others as per example (Simples Nacional)
    
    // Replicating the structure from d:\Imob_Simple\XML\xml_assinado.xml
    // Root: DPS with xmlns and versao
    // Child: infDPS with Id only
    
    const infDpsContent = `
\t<infDPS Id="${infDpsId}">
\t\t<tpAmb>${tpAmb}</tpAmb>
\t\t<dhEmi>${dhEmiFormatted}</dhEmi>
\t\t<verAplic>POC_0.0.0</verAplic>
\t\t<serie>${serie}</serie>
\t\t<nDPS>${nDps}</nDPS>
\t\t<dCompet>${competencia}</dCompet>
\t\t<tpEmit>1</tpEmit>
\t\t<cLocEmi>${cLocEmi}</cLocEmi>
\t\t<prest>
\t\t\t<${prestadorDocTag}>${prestadorDocDigits}</${prestadorDocTag}>
\t\t\t<regTrib>
\t\t\t\t<opSimpNac>${this.escapeXml(opSimpNac)}</opSimpNac>
\t\t\t\t${regApTribSnXml}
\t\t\t\t<regEspTrib>0</regEspTrib>
\t\t\t</regTrib>
\t\t</prest>
\t\t<toma>
\t\t\t<${tomadorTag}>${tomadorCpf}</${tomadorTag}>
\t\t\t<xNome>${this.escapeXml(emissao.tomadorNome)}</xNome>
\t\t\t${tomaEndXml}
\t\t</toma>
\t\t<serv>
\t\t\t<locPrest>
\t\t\t\t<cLocPrestacao>${cLocEmi}</cLocPrestacao>
\t\t\t</locPrest>
\t\t\t<cServ>
\t\t\t\t<cTribNac>${codigoTributacao}</cTribNac>
\t\t\t\t<xDescServ>${this.escapeXml(emissao.descricaoServico)}</xDescServ>
\t\t\t\t<cNBS>${cNBS}</cNBS>
\t\t\t</cServ>
\t\t\t${landlordTaxInfoXml}
\t\t</serv>
\t\t<valores>
\t\t\t<vServPrest>
\t\t\t\t<vServ>${valorServico}</vServ>
\t\t\t</vServPrest>
\t\t\t<trib>
\t\t\t\t<tribMun>
\t\t\t\t\t<tribISSQN>${tribIssqn}</tribISSQN>
\t\t\t\t\t<tpRetISSQN>1</tpRetISSQN>
\t\t\t\t</tribMun>
\t\t\t\t<totTrib>
\t\t\t\t\t<pTotTrib>
\t\t\t\t\t\t<pTotTribFed>0.00</pTotTribFed>
\t\t\t\t\t\t<pTotTribEst>0.00</pTotTribEst>
\t\t\t\t\t\t<pTotTribMun>0.00</pTotTribMun>
\t\t\t\t\t</pTotTrib>
\t\t\t\t</totTrib>
\t\t\t</trib>
\t\t</valores>
\t\t${ibsCbsXml}
\t</infDPS>`;

    return `<DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01">${infDpsContent}\n</DPS>`;
  }

  private signXml(xml: string, rootTag: string = "DPS"): string {
    if (!this.keyPem || !this.certPem) {
      console.warn("Chave/Certificado ausentes. Operando em modo de simulação (sem assinatura real).");
      return xml;
    }

    try {
      const sig = new SignedXml();
      // Configure algorithms to match Java XmlSigner (SHA1 + Enveloped)
      sig.canonicalizationAlgorithm = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
      sig.signatureAlgorithm = "http://www.w3.org/2000/09/xmldsig#rsa-sha1";

      // Add reference to the element being signed
      // Reference URI="" means signing the containing resource (the root element DPS)
      sig.addReference({
        xpath: `//*[local-name(.)='${rootTag}']`, 
        transforms: [
          "http://www.w3.org/2000/09/xmldsig#enveloped-signature"
        ],
        digestAlgorithm: "http://www.w3.org/2000/09/xmldsig#sha1",
        uri: "",
        isEmptyUri: true
      });
      
      sig.privateKey = this.keyPem;

      // Add KeyInfo with X509Data containing SubjectName and Certificate
      // NOTE: In xml-crypto v6, keyInfoProvider is replaced by overriding getKeyInfoContent
      sig.getKeyInfoContent = (args) => {
          const prefix = args.prefix ? args.prefix + ":" : "";
          
          const certBody = this.certPem!
              .replace(/-----BEGIN CERTIFICATE-----/g, "")
              .replace(/-----END CERTIFICATE-----/g, "")
              .replace(/\s/g, "");
          
          const subjectElement = this.certSubject 
            ? `<${prefix}X509SubjectName>${this.certSubject}</${prefix}X509SubjectName>` 
            : "";
            
          return `<${prefix}X509Data>${subjectElement}<${prefix}X509Certificate>${certBody}</${prefix}X509Certificate></${prefix}X509Data>`;
      };

      sig.computeSignature(xml, {
        location: {
          reference: "//*[local-name(.)='infDPS']",
          action: "after"
        }
      });
      
      let signedXml = sig.getSignedXml();

      // WARNING: Do NOT manually insert newlines or spaces inside the signed element (DPS)
      // after signature generation, as this invalidates the digital signature hash.
      // signedXml = signedXml.replace('</infDPS><Signature', '</infDPS>\n<Signature');

      // Add XML Declaration if missing
      if (!signedXml.startsWith('<?xml')) {
        signedXml = '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' + signedXml;
      }

      // Post-process XML to enforce specific base64 formatting (chunked at 76 chars with &#13;\n)
      // This is required to match the exact format expected by the national API/compression tools
      const formatBase64 = (str: string) => {
          const clean = str.replace(/\s/g, '');
          const chunks = clean.match(/.{1,76}/g) || [];
          return chunks.join('&#13;\n');
      };

      signedXml = signedXml.replace(
        /<SignatureValue>(.*?)<\/SignatureValue>/s,
        (match, p1) => `<SignatureValue>${formatBase64(p1)}</SignatureValue>`
      );

      signedXml = signedXml.replace(
        /<X509Certificate>(.*?)<\/X509Certificate>/s,
        (match, p1) => `<X509Certificate>${formatBase64(p1)}</X509Certificate>`
      );

      return signedXml;
    } catch (e) {
      console.error("Erro ao assinar XML:", e);
      throw new Error("Falha na assinatura digital do XML");
    }
  }

  private logTransaction(type: 'EMISSAO' | 'CANCELAMENTO' | 'CONSULTA', data: any, response: any, success: boolean, correlationId?: string) {
    const finalCorrelationId = correlationId || crypto.randomUUID();
    // Mask sensitive data
    const safeData = JSON.parse(JSON.stringify(data));
    // User requested full XML in logs for debugging
    // if (safeData.xml) safeData.xml = '[XML CONTENT]'; 
    
    const logData = {
      timestamp: new Date().toISOString(),
      correlationId: finalCorrelationId,
      type,
      success,
      request: safeData,
      response: response
    };
    
    console.log(JSON.stringify(logData));

    // Save to DB
    storage.createSystemLog({
      level: success ? 'INFO' : 'ERROR',
      category: 'NFSE',
      message: `${type} - ${success ? 'Sucesso' : 'Falha'}`,
      details: JSON.stringify(logData),
      correlationId: finalCorrelationId
    }).catch(err => console.error("Erro ao salvar log no banco:", err));
  }

  // Generate XML for Cancellation
  private generateCancelamentoXml(emissao: NfseEmissao, config: NfseConfig, motivo: string): string {
    // Current time in UTC - 10 min safety margin
    const now = new Date();
    now.setMinutes(now.getMinutes() - 10);
    const brasiliaTime = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    const dhEvento = brasiliaTime.toISOString().split('.')[0] + '-03:00';

    const chNFSe = emissao.chaveAcesso || "35540032257431088000113000000000000626015071335984"; // Fallback to example if missing
    // ID format: PRE + chNFSe (50) + EventCode (101101) = 59 chars
    const id = `PRE${chNFSe}101101`;
    const prestadorDocDigits = this.getPrestadorDocDigits(config);
    const autorDocTag = this.getPrestadorDocTag(config) === "CNPJ" ? "CNPJAutor" : "CPFAutor";

    // Ensure Motivo meets minimum length (usually 15 or 20 chars).
    // The user reported "Teste" (5 chars) is too short.
    // We will ensure at least 20 chars by appending a suffix if needed.
    let xMotivo = motivo.trim();
    if (xMotivo.length < 20) {
        xMotivo += " - Solicitação de cancelamento enviada pelo sistema.";
    }
    // Truncate to safe max length (usually 255)
    xMotivo = xMotivo.slice(0, 255);

    // Structure matching d:\Imob_Simple\XML\xml_cancelamento.xml
    return `<pedRegEvento xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01">
\t<infPedReg Id="${id}">
\t\t<tpAmb>${this.normalizeAmbiente(config.ambiente) === 'producao' ? '1' : '2'}</tpAmb>
\t\t<verAplic>POC_0.0.0</verAplic>
\t\t<dhEvento>${dhEvento}</dhEvento>
\t\t<${autorDocTag}>${prestadorDocDigits}</${autorDocTag}>
\t\t<chNFSe>${chNFSe}</chNFSe>
\t\t<e101101>
\t\t\t<xDesc>Cancelamento de NFS-e</xDesc>
\t\t\t<cMotivo>1</cMotivo>
\t\t\t<xMotivo>${xMotivo}</xMotivo>
\t\t</e101101>
\t</infPedReg>
</pedRegEvento>`;
  }

  // Sign XML for Event (Cancellation) using SHA1 (matching Java implementation)
  private signEventoXml(xml: string): string {
    if (!this.keyPem || !this.certPem) {
      console.warn("Chave/Certificado ausentes. Operando em modo de simulação (sem assinatura real).");
      return xml;
    }

    try {
      const sig = new SignedXml();
      // Use SHA1 as per Java implementation (XmlSigner.java uses SignatureMethod.RSA_SHA1 and DigestMethod.SHA1)
      sig.canonicalizationAlgorithm = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
      sig.signatureAlgorithm = "http://www.w3.org/2000/09/xmldsig#rsa-sha1";

      // Sign the root element (pedRegEvento) just like Java does with URI=""
      sig.addReference({
        xpath: `//*[local-name(.)='pedRegEvento']`,
        transforms: [
          "http://www.w3.org/2000/09/xmldsig#enveloped-signature"
        ],
        digestAlgorithm: "http://www.w3.org/2000/09/xmldsig#sha1",
        uri: "",
        isEmptyUri: true
      });
      
      sig.privateKey = this.keyPem;

      // Add KeyInfo (same as signXml)
      sig.getKeyInfoContent = (args) => {
          const prefix = args.prefix ? args.prefix + ":" : "";
          const certBody = this.certPem!
              .replace(/-----BEGIN CERTIFICATE-----/g, "")
              .replace(/-----END CERTIFICATE-----/g, "")
              .replace(/\s/g, "");
          const subjectElement = this.certSubject 
            ? `<${prefix}X509SubjectName>${this.certSubject}</${prefix}X509SubjectName>` 
            : "";
          return `<${prefix}X509Data>${subjectElement}<${prefix}X509Certificate>${certBody}</${prefix}X509Certificate></${prefix}X509Data>`;
      };

      sig.computeSignature(xml, {
        location: {
          reference: "//*[local-name(.)='infPedReg']",
          action: "after"
        }
      });
      
      let signedXml = sig.getSignedXml();

      // Add XML Declaration if missing
      if (!signedXml.startsWith('<?xml')) {
        signedXml = '<?xml version="1.0" encoding="UTF-8"?>\n' + signedXml;
      }

      // Base64 formatting (same as signXml)
      const formatBase64 = (str: string) => {
          const clean = str.replace(/\s/g, '');
          const chunks = clean.match(/.{1,76}/g) || [];
          return chunks.join('&#13;\n');
      };

      signedXml = signedXml.replace(
        /<SignatureValue>(.*?)<\/SignatureValue>/s,
        (match, p1) => `<SignatureValue>${formatBase64(p1)}</SignatureValue>`
      );

      signedXml = signedXml.replace(
        /<X509Certificate>(.*?)<\/X509Certificate>/s,
        (match, p1) => `<X509Certificate>${formatBase64(p1)}</X509Certificate>`
      );

      return signedXml;
    } catch (e) {
      console.error("Erro ao assinar XML de evento:", e);
      throw new Error("Falha na assinatura digital do XML de evento");
    }
  }

  async emitirNfse(emissaoId: string): Promise<{ success: boolean; message?: string; data?: any }> {
    assertSideEffectsAllowed("NFS-e emitirNfse");
    const correlationId = crypto.randomUUID();
    console.log(`[${correlationId}] Iniciando emissão NFS-e ${emissaoId}`);

    await this.initialize({ emissaoId });
    if (!this.config) throw new Error("Configuração ausente");

    let emissao = await storage.getNfseEmissao(emissaoId);
    if (!emissao) throw new Error("Emissão não encontrada");

    // #region debug-point C:provider-entry
    this.debugNfseReprocess("pre-fix", "C", "server/providers/NfseNationalProvider.ts:emitirNfse:entry", "Provider carregou emissao para emitir/reprocessar", {
      emissaoId,
      correlationId,
      status: emissao.status,
      erroCodigo: emissao.erroCodigo || null,
      erroMensagem: emissao.erroMensagem || null,
      updatedAt: emissao.updatedAt ? new Date(emissao.updatedAt).toISOString() : null,
    });
    // #endregion

    // Prevent double processing/race conditions
    if (emissao.status === 'ENVIANDO' || emissao.status === 'EMITIDA' || emissao.status === 'CANCELADA') {
      // #region debug-point C:provider-guard-block
      this.debugNfseReprocess("pre-fix", "C", "server/providers/NfseNationalProvider.ts:emitirNfse:guard", "Provider bloqueou emissao pelo guard de status", {
        emissaoId,
        correlationId,
        status: emissao.status,
      });
      // #endregion
      console.warn(`[${correlationId}] Emissão ${emissaoId} já está no estado ${emissao.status}. Ignorando processamento.`);
      return { success: false, message: `Emissão já está no estado ${emissao.status}` };
    }

    await storage.updateNfseEmissao(emissao.id, { status: "ENVIANDO" });

    let xmlContext = "";

    try {
      emissao = await this.refreshTomadorSnapshot(emissao);

      const resolved = await this.resolveDpsNumber(emissao, this.config);

      if (resolved.mode === "healed") {
        // A tentativa anterior na verdade foi aceita pelo Ambiente Nacional;
        // recuperamos a confirmação em vez de reenviar (evitaria duplicidade).
        await storage.updateNfseEmissao(emissao.id, {
          status: "EMITIDA",
          numeroNfse: String(resolved.number),
          chaveAcesso: resolved.chaveAcesso,
          erroCodigo: null,
          erroMensagem: null,
          updatedAt: new Date(),
        });
        if (
          emissao.origemTipo === 'INVOICE' ||
          emissao.origemTipo === 'COMISSAO' ||
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
        return { success: true, data: { healed: true, chaveAcesso: resolved.chaveAcesso } };
      }

      const nextNumber = resolved.number;

      // Determine property type for NBS selection
      let propertyType: string | undefined;
      if (emissao.origemTipo === 'INVOICE' || emissao.origemTipo === LANDLORD_NFSE_ORIGIN_TYPE) {
         // Using originId which stores the invoice ID
         propertyType = await storage.getPropertyTypeByInvoiceId(emissao.origemId);
      }
      
      const xml = this.generateDpsXml(emissao, this.config, nextNumber, propertyType);
      
      // 2. Sign XML
      // The signature should be placed inside DPS, after infDPS.
      // xml-crypto will insert the signature based on the location configured in signXml.
      
      const signedXml = this.signXml(xml, "DPS");
      
      xmlContext = signedXml;

      await storage.updateNfseEmissao(emissao.id, {
        apiRequestRaw: signedXml,
        erroCodigo: null,
        erroMensagem: null,
        updatedAt: new Date(),
      });

      // 4. Send to National API (Using the user requested URL and logic)
      const apiResponse = await this.sendToNationalApi(signedXml);
      
      this.logTransaction('EMISSAO', { 
        emissaoId, 
        xml: signedXml,
        requestSent: apiResponse.requestSent 
      }, apiResponse, apiResponse.success, correlationId);

      // 4. Handle Response
      if (apiResponse.success) {
        let chaveAcesso = null;
        let numeroNfse = this.extractNumeroNfse(apiResponse);
        if (apiResponse.raw) {
            if (typeof apiResponse.raw === 'object') {
                chaveAcesso = apiResponse.raw.chaveAcesso || apiResponse.raw.chave || apiResponse.raw.nfse?.chave;
            } 
        }

        if (!chaveAcesso && apiResponse.chave) {
            chaveAcesso = apiResponse.chave;
        }

        if (!numeroNfse) {
          numeroNfse = this.extractNumeroNfseFromChaveAcesso(chaveAcesso, emissao.updatedAt || emissao.createdAt || new Date());
        }

        const temChaveValida = typeof chaveAcesso === 'string' && chaveAcesso.replace(/\D/g, '').length >= 20;
        const numeroXml = (typeof apiResponse === 'object' && (apiResponse as any).numeroNfse) || numeroNfse;
        const temNumeroValido = typeof numeroXml === 'string' && numeroXml.replace(/\D/g, '').length >= 1;

        if (!temChaveValida && !temNumeroValido) {
          const rawText = typeof apiResponse.raw === 'object' ? JSON.stringify(apiResponse.raw) : String(apiResponse.raw ?? '');
          await storage.updateNfseEmissao(emissao.id, {
            status: "FALHOU",
            erroCodigo: "NO_CONFIRMATION_DATA",
            erroMensagem: "A API Nacional retornou HTTP 200, mas sem chave de acesso ou número de NFS-e válidos na resposta. A emissão NÃO foi confirmada pela SEFAZ. Verifique a aba Detalhes da Emissão para ler a resposta RAW.",
            apiRequestRaw: signedXml,
            apiResponseRaw: JSON.stringify(apiResponse),
            updatedAt: new Date()
          });
          return { success: false, message: "Emissão não confirmada pela SEFAZ. (sem chave/nº na resposta)", data: apiResponse };
        }

        // Contador já foi persistido em resolveDpsNumber/persistReservedNumber
        // antes do envio - não repetir aqui.

        await storage.updateNfseEmissao(emissao.id, {
          status: "EMITIDA",
          numeroNfse: numeroXml || String(nextNumber),
          chaveAcesso: chaveAcesso,
          xmlUrl: (typeof apiResponse === 'object' && (apiResponse as any).xmlUrl) || undefined,
          pdfUrl: (typeof apiResponse === 'object' && (apiResponse as any).pdfUrl) || undefined,
          apiRequestRaw: signedXml,
          apiResponseRaw: JSON.stringify(apiResponse),
          erroCodigo: null,
          erroMensagem: null,
          updatedAt: new Date()
        });
        
        if (
          emissao.origemTipo === 'INVOICE' ||
          emissao.origemTipo === 'COMISSAO' ||
          emissao.origemTipo === LANDLORD_NFSE_ORIGIN_TYPE
        ) {
             const invoice = await storage.updateInvoice(emissao.origemId, { status: "issued" });
             if (invoice?.receiptId && emissao.origemTipo !== LANDLORD_NFSE_ORIGIN_TYPE) {
               await storage.updateReceipt(invoice.receiptId, {
                 isInvoiceGenerated: true,
                 isInvoiceIssued: true,
                 isInvoiceCancelled: false
               });
             }
        }

        return { success: true, data: apiResponse };
      } else {

        await storage.updateNfseEmissao(emissao.id, {
          status: "FALHOU",
          erroCodigo: apiResponse.erroCodigo,
          erroMensagem: apiResponse.erroMensagem,
          apiRequestRaw: signedXml,
          apiResponseRaw: JSON.stringify(apiResponse),
          updatedAt: new Date()
        });
        return { success: false, message: apiResponse.erroMensagem };
      }

    } catch (error: any) {
      console.error(`[${correlationId}] Erro na emissão:`, error);
      
      this.logTransaction('EMISSAO', { emissaoId, xml: xmlContext }, { error: error.message || error.toString() }, false, correlationId);

      await storage.updateNfseEmissao(emissao.id, {
        status: "FALHOU",
        erroCodigo: error.code || "EMISSION_ERROR",
        erroMensagem: error.message,
        apiRequestRaw: xmlContext || null,
        updatedAt: new Date()
      });
      return { success: false, message: error.message };
    }
  }

  async consultarNfse(emissaoId: string): Promise<{ success: boolean; data?: any; message?: string }> {
    const correlationId = crypto.randomUUID();
    console.log(`[${correlationId}] Consultando status NFS-e ${emissaoId}`);

    const emissao = await storage.getNfseEmissao(emissaoId);
    if (!emissao) throw new Error("Emissão não encontrada");

    // Mock implementation for "consultar status"
    // In production, we would call the API with the protocol number or emission ID
    
    const mockStatus = {
       status: emissao.status,
       mensagem: "Consulta realizada com sucesso (Simulação)"
    };

    this.logTransaction('CONSULTA', { emissaoId }, mockStatus, true, correlationId);
    
    return { success: true, data: mockStatus };
  }

  async baixarXml(emissaoId: string): Promise<string | null> {
    const correlationId = crypto.randomUUID();
    console.log(`[${correlationId}] Baixando XML NFS-e ${emissaoId}`);
    
    await this.initialize({ emissaoId });
    if (!this.config) throw new Error("Configuração ausente");

    const emissao = await storage.getNfseEmissao(emissaoId);
    if (!emissao) throw new Error("Emissão não encontrada");

    // Regenerate the signed XML (or retrieve from storage if we had stored it)
    // Attempt to fetch from API first using the consultation URL
    try {
        if (emissao.chaveAcesso) {
            const xmlFromApi = await this.baixarXmlDaApi(emissao.chaveAcesso, correlationId);
            if (xmlFromApi) return xmlFromApi;
        }
    } catch (e: any) {
        console.warn(`[${correlationId}] Falha ao baixar XML da API, usando fallback local:`, e.message);
    }

    // Fallback: Regenerate locally
    const nDps = parseInt(emissao.numeroNfse || "0");
    const xml = this.generateDpsXml(emissao, this.config, nDps);
    const signedXml = this.signXml(xml);
    
    return signedXml;
  }


  async cancelarNfse(emissaoId: string, motivo: string): Promise<{ success: boolean; message?: string }> {
    assertSideEffectsAllowed("NFS-e cancelarNfse");
    const correlationId = crypto.randomUUID();
    console.log(`[${correlationId}] Iniciando cancelamento NFS-e ${emissaoId}`);

    await this.initialize({ emissaoId });
    if (!this.config) throw new Error("Configuração ausente");
    
    const emissao = await storage.getNfseEmissao(emissaoId);
    if (!emissao) throw new Error("Emissão não encontrada");
    if (emissao.status !== 'EMITIDA') throw new Error("NFS-e não está emitida para ser cancelada");

    let xmlContext = "";

    try {
        console.log(`[${correlationId}] Cancelando NFS-e ${emissao.numeroNfse} - Motivo: ${motivo}`);
        
        // 1. Generate Cancellation XML
        const xml = this.generateCancelamentoXml(emissao, this.config, motivo);

        // 2. Sign XML
        const signedXml = this.signEventoXml(xml);
        xmlContext = signedXml;

        // 3. Compress and Encode (GZip + Base64)
        const compressed = zlib.gzipSync(Buffer.from(signedXml, 'utf-8')).toString('base64');

        // 4. Send to API
        if (!emissao.chaveAcesso) {
            throw new Error("Chave de Acesso não encontrada na emissão. Não é possível cancelar.");
        }
        const chNFSe = emissao.chaveAcesso;
        
        const urls = this.getUrls();
        const url = urls.eventos(chNFSe);

        const httpsAgent = new https.Agent({
          pfx: this.certPfx ?? undefined,
          passphrase: this.certPassphrase,
          rejectUnauthorized: false
        });

        console.log(`[${correlationId}] Enviando POST para: ${url}`);
        
        const response = await axios.post(url, {
          pedidoRegistroEventoXmlGZipB64: compressed
        }, {
          httpsAgent,
          headers: {
            'Content-Type': 'application/json'
          }
        });

        this.logTransaction('CANCELAMENTO', { 
          emissaoId, 
          xml: signedXml,
          url
        }, response.data, true, correlationId);

        // Check response content for errors
        if (response.data && response.data.erros && response.data.erros.length > 0) {
            throw new Error(`Erro na API: ${JSON.stringify(response.data.erros)}`);
        }
        
        await storage.updateNfseEmissao(emissao.id, {
            status: "CANCELADA",
            updatedAt: new Date(),
            apiResponseRaw: JSON.stringify(response.data)
        });
        
        // Se a emissão for de uma Invoice, atualiza o status da Invoice e do Recibo
        if (
          (emissao.origemTipo === 'INVOICE' || emissao.origemTipo === LANDLORD_NFSE_ORIGIN_TYPE) &&
          emissao.origemId
        ) {
             const invoice = await storage.getInvoice(emissao.origemId);
             if (invoice) {
                 // 1. Cancelar a Invoice
                 await storage.updateInvoice(invoice.id, { status: "cancelled" });

                 // 2. Atualizar o Recibo para permitir nova emissão
                 // isInvoiceIssued = false (não está mais emitida)
                 // isInvoiceGenerated = false (permite gerar nova)
                 // isInvoiceCancelled = true (histórico)
                 if (invoice.receiptId && emissao.origemTipo !== LANDLORD_NFSE_ORIGIN_TYPE) {
                     await storage.updateReceipt(invoice.receiptId, { 
                         isInvoiceIssued: false,
                         isInvoiceGenerated: false,
                         isInvoiceCancelled: true
                     });
                 }

             }
        }

        return { success: true, message: "NFS-e cancelada com sucesso" };

    } catch (error: any) {
        console.error(`[${correlationId}] Erro no cancelamento:`, error);
        
        const errorData = error.response ? error.response.data : (error.message || error);
        this.logTransaction('CANCELAMENTO', { emissaoId, xml: xmlContext }, { error: errorData }, false, correlationId);

        // Update emission with error details
        await storage.updateNfseEmissao(emissao.id, {
            erroMensagem: JSON.stringify(errorData),
            updatedAt: new Date()
        });

        return { success: false, message: typeof errorData === 'string' ? errorData : JSON.stringify(errorData) };
    }
  }

  private async sendToNationalApi(xml: string): Promise<any> {
    if (!this.certPfx) {
      throw new Error("Certificado Digital obrigatório para envio real ao ambiente de homologação.");
    }

    // Configuração do Agente HTTPS com o Certificado PFX
    // Isso autentica a requisição (mTLS) exigida pela maioria dos serviços governamentais
    const httpsAgent = new https.Agent({
      pfx: this.certPfx,
      passphrase: this.certPassphrase,
      rejectUnauthorized: false // Em homologação às vezes é necessário aceitar certificados auto-assinados da receita
    });

    let requestBody = null;

    try {
      const urls = this.getUrls();
      const url = urls.emissao;
      const ambiente = this.normalizeAmbiente(this.config?.ambiente);
      const ambienteLabel = ambiente === 'producao' ? 'Produção' : 'Homologação';
      console.log(`Enviando para Ambiente de ${ambienteLabel} Nacional...`);
      
      // Limpeza e Debug do XML
      // O XML já vem minificado e envelopado em <DPS> do método emitirNfse
      let cleanXml = xml;
      
      // Adicionar cabeçalho XML apenas se não existir, sem quebras de linha
      if (!cleanXml.startsWith('<?xml')) {
          cleanXml = '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' + cleanXml;
      }
      
      console.log("XML Assinado (Início):", cleanXml.substring(0, 100));

      // Compactar (GZip) e Codificar (Base64) o XML conforme padrão Nacional
      // IMPORTANTE: zlib.gzipSync usa as configurações padrão.
      const xmlBuffer = Buffer.from(cleanXml, 'utf-8');
      const compressedXml = zlib.gzipSync(xmlBuffer).toString('base64');

      // Debug do conteúdo compactado (primeiros caracteres)
      console.log("Conteúdo GZip Base64 (Início):", compressedXml.substring(0, 50));
      
      requestBody = { 
            dpsXmlGZipB64: compressedXml 
        };

      console.log(`Enviando POST para: ${url}`);

      const response = await axios.post(
        url,
        // Enviar o XML Compactado diretamente como body, ou envolvido?
        // O erro anterior foi "Estrutura descompactada mal formada". Isso sugere que o endpoint recebeu o zip, abriu, mas o XML dentro (infDPS) estava ruim.
        // Como ajustamos o XML interno para seguir o modelo exato, vamos manter o envio no formato JSON conforme solicitado:
        // { "dpsXmlGZipB64": "XML ASSINADO" }
        requestBody,
        {
          headers: {
            "Content-Type": "application/json",
            // "Authorization": "Basic ...", // Removed: mTLS auth only as per user instruction
          },
          httpsAgent: httpsAgent,
          timeout: 60000 
        }
      );

      console.log("Resposta da API Nacional:", response.status, response.data);

      const data: any = response.data;

      const errosArray: any[] =
        (Array.isArray(data?.erros) && data.erros.length > 0 ? data.erros : [])
          .concat(Array.isArray(data?.error) ? data.error : [])
          .concat(Array.isArray(data?.messages) ? data.messages : []);

      const primeiroErro = errosArray[0] || null;
      const normalizedErroCodigo = primeiroErro
        ? (String(primeiroErro.Codigo || primeiroErro.codigo || primeiroErro.code || "").trim() || String(response.status))
        : null;
      const normalizedErroMensagem = errosArray.length > 0
        ? errosArray.map((e: any) => {
          const c = String(e.Codigo || e.codigo || e.code || "").trim();
          const d = String(e.Descricao || e.descricao || e.message || e.mensagem || "").trim();
          return c || d ? [c, d].filter(Boolean).join(": ") : String(e);
        }).join(" | ")
        : null;

      if (normalizedErroCodigo || normalizedErroMensagem) {
        return {
          success: false,
          erroCodigo: normalizedErroCodigo || String(response.status),
          erroMensagem: normalizedErroMensagem || "A API Nacional retornou erros de validação.",
          raw: typeof data === "object" ? JSON.stringify(data) : String(data ?? ""),
          requestSent: requestBody
        };
      }

      const chaveAcesso =
        this.pickFirstStringValue(data?.chaveAcesso) ||
        this.pickFirstStringValue(data?.chave) ||
        this.pickFirstStringValue(data?.nfse?.chaveAcesso) ||
        this.pickFirstStringValue(data?.nfse?.chave) ||
        this.pickFirstStringValue(data?.data?.chaveAcesso) ||
        this.pickFirstStringValue(data?.data?.chave);

      const numeroNfse = this.extractNumeroNfse(data);

      return {
        success: true,
        chave: chaveAcesso || undefined,
        numero: numeroNfse || undefined,
        numeroNfse: numeroNfse || undefined,
        codigoVerificacao:
          this.pickFirstStringValue(data?.codigoVerificacao) ||
          this.pickFirstStringValue(data?.data?.codigoVerificacao) ||
          this.pickFirstStringValue(data?.nfse?.codigoVerificacao) ||
          undefined,
        xmlUrl:
          this.pickFirstStringValue(data?.xmlUrl) ||
          this.pickFirstStringValue(data?.urlXml) ||
          this.pickFirstStringValue(data?.data?.xmlUrl) ||
          undefined,
        pdfUrl:
          this.pickFirstStringValue(data?.pdfUrl) ||
          this.pickFirstStringValue(data?.urlPdf) ||
          this.pickFirstStringValue(data?.danfseUrl) ||
          this.pickFirstStringValue(data?.data?.pdfUrl) ||
          undefined,
        raw: data,
        requestSent: requestBody
      };

    } catch (error: any) {
      console.error("Erro na comunicação com API Nacional:", error.message, error.code);
      if (error.response) {
        console.error("Dados do erro:", error.response.data);
        const formattedError = this.formatApiErrorDetails(error.response.data);
        return {
          success: false,
          erroCodigo: formattedError.erroCodigo || String(error.response.status),
          erroMensagem: formattedError.erroMensagem,
          raw: formattedError.raw,
          requestSent: requestBody
        };
      }
      // Sem error.response: não sabemos se a Receita chegou a processar a DPS
      // antes da conexão cair (timeout, rede). Resultado AMBÍGUO - diferente de
      // uma rejeição confirmada (que tem error.response com o motivo da Receita).
      return {
        success: false,
        ambiguous: true,
        erroCodigo: error.code || "CONNECTION_ERROR",
        erroMensagem: error.message || "Erro de conexão desconhecido",
        requestSent: requestBody
      };
    }
  }

  private async mockSendToApi(xml: string): Promise<any> {
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Simulate Success (90% chance)
    const isSuccess = true; 
    
    if (isSuccess) {
      const uuid = crypto.randomUUID();
      return {
        success: true,
        numero: Math.floor(Math.random() * 10000).toString(),
        codigoVerificacao: crypto.randomBytes(4).toString('hex').toUpperCase(),
        xmlUrl: `/api/nfse/emissoes/download/${uuid}.xml`, // Local route to serve the XML
        pdfUrl: `https://api.nfse.gov.br/mock/pdf/${uuid}`,
      };
    } else {
      return {
        success: false,
        erroCodigo: "E123",
        erroMensagem: "Erro na validação do schema XSD",
      };
    }
  }
}

export const nfseProvider = new NfseNationalProvider();

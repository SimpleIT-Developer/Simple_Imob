import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "zlib";
import axios from "axios";
import { PDFDocument } from "pdf-lib";
import { CHAVE_FICTICIA, NFSE_XML_FICTICIO } from "../services/danfse/fixture-nfse";

process.env.DATABASE_URL = "postgres://invalid:invalid@127.0.0.1:1/none";
const { NfseNationalProvider } = await import("./NfseNationalProvider");

const urls: string[] = [];
axios.defaults.adapter = async (config) => {
  const url = String(config.url);
  urls.push(url);
  if (url.includes("/danfse/")) throw new Error("chamou o serviço DANFSE do ADN (suspenso)");
  if (url.endsWith(`/SefinNacional/nfse/${CHAVE_FICTICIA}`)) {
    const nfseXmlGZipB64 = zlib.gzipSync(Buffer.from(NFSE_XML_FICTICIO, "utf-8")).toString("base64");
    return { data: { nfseXmlGZipB64 }, status: 200, statusText: "OK", headers: {}, config };
  }
  throw new Error(`URL inesperada: ${url}`);
};

function providerComCertificado() {
  const p = new NfseNationalProvider() as any;
  p.initialize = async () => {
    p.certPfx = Buffer.from("pfx-ficticio");
    p.certPassphrase = "x";
    p.config = { ambiente: "producao" };
  };
  return p as InstanceType<typeof NfseNationalProvider>;
}

test("DANFSe é gerado localmente a partir do XML autorizado (sem o ADN /danfse)", async () => {
  urls.length = 0;
  const pdf = await providerComCertificado().baixarDanfsePdf(CHAVE_FICTICIA);
  assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.equal((await PDFDocument.load(pdf)).getPageCount(), 1);
  assert.deepEqual(urls, [`https://sefin.nfse.gov.br/SefinNacional/nfse/${CHAVE_FICTICIA}`]);
});

test("sem XML autorizado na consulta, erro claro", async () => {
  axios.defaults.adapter = async (config) => ({ data: {}, status: 200, statusText: "OK", headers: {}, config });
  await assert.rejects(providerComCertificado().baixarDanfsePdf(CHAVE_FICTICIA), /XML autorizado/);
});

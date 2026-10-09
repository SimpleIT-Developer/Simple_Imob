import path from "path";

// Certificado e-CNPJ A1 vigente. Renovado em 09/10/2026 (válido até 08/10/2027);
// o arquivo anterior (IMOBILIARIA_SIMOES_LTDA_1009005362.pfx) venceu em 09/10/2026.
export const DEFAULT_PFX_PATH = path.join(process.cwd(), "cert", "IMOBILIARIA SIMOES LTDA 1011627503 senha 1234.pfx");

export function resolveSicoobPfx(
  env: NodeJS.ProcessEnv,
  readFile: (p: string) => Buffer | null,
): { pfx: Buffer; passphrase: string; source: "env" | "file" } | null {
  const sicoobB64 = env.SICOOB_CERT_PFX_B64?.trim();
  const nfseB64 = env.NFSE_CERT_PFX_B64?.trim();
  if (sicoobB64) {
    return { pfx: Buffer.from(sicoobB64, "base64"), passphrase: env.SICOOB_CERT_PFX_PASSPHRASE || "1234", source: "env" };
  }
  if (nfseB64) {
    return { pfx: Buffer.from(nfseB64, "base64"), passphrase: env.NFSE_CERT_PFX_PASSPHRASE || "1234", source: "env" };
  }
  const pfx = readFile(DEFAULT_PFX_PATH);
  return pfx ? { pfx, passphrase: "1234", source: "file" } : null;
}

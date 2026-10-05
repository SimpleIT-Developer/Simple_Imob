// Teste automático da homologação Cloudflare (gravações, ações bloqueadas, webhook).
// Cria um usuário admin temporário SOMENTE no banco de homologação e o remove ao final.
import bcrypt from "bcrypt";
import crypto from "crypto";
import pg from "pg";
import { required, targetDirectUrl } from "./load-env";

// A tela chama /api no próprio endereço (imob-web encaminha à API); SMOKE_API_BASE permite testar a API direto.
const API = process.env.SMOKE_API_BASE || "https://imob.simpleit.app.br";
const WEB = "https://imob.simpleit.app.br";
const ORIGIN = { Origin: WEB };

const db = new pg.Client({ connectionString: targetDirectUrl("homolog") });
await db.connect();
if (!(await db.query("select current_database() d")).rows[0].d.includes("homolog")) throw new Error("Não é o banco de homologação");

const email = `teste.migracao.${Date.now()}@simpleit.local`;
const password = crypto.randomBytes(12).toString("base64url");
const user = await db.query(
  "insert into users (name, email, password_hash, role) values ($1, $2, $3, 'admin') returning id",
  ["TESTE MIGRAÇÃO (automático)", email, await bcrypt.hash(password, 10)],
);
const results: { item: string; ok: boolean; detalhe: string }[] = [];
const check = (item: string, ok: boolean, detalhe: string) => results.push({ item, ok, detalhe });
let cookie = "";

async function call(method: string, path: string, body?: unknown, base = API) {
  const t = Date.now();
  const res = await fetch(base + path, {
    method,
    headers: { ...ORIGIN, ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, ms: Date.now() - t, cors: res.headers.get("access-control-allow-origin") };
}

try {
  // 1. Login
  const login = await call("POST", "/api/auth/login", { email, password });
  check("Login (cookie no mesmo endereço)", login.status === 200 && !!cookie, `HTTP ${login.status}, cookie=${!!cookie}, ${login.ms}ms`);
  const me = await call("GET", "/api/auth/me");
  check("Sessão mantida (/api/auth/me)", me.status === 200, `HTTP ${me.status}`);

  // 2. Gravação: criar, editar, auditoria, excluir
  const created = await call("POST", "/api/providers", { name: "TESTE MIGRAÇÃO", serviceType: "Teste", email: "teste@simpleit.local" });
  const providerId = created.json?.id;
  check("Criar prestador", created.status < 300 && !!providerId, `HTTP ${created.status} ${created.ms}ms`);
  if (providerId) {
    const edited = await call("PATCH", `/api/providers/${providerId}`, { name: "TESTE MIGRAÇÃO EDITADO" });
    check("Editar prestador", edited.status < 300 && edited.json?.name === "TESTE MIGRAÇÃO EDITADO", `HTTP ${edited.status}`);
    const audit = await db.query("select field_name, old_value, new_value from audit_logs where entity_id = $1 order by timestamp", [providerId]);
    const nameChange = [...audit.rows].reverse().find((r) => r.field_name === "name");
    check("Auditoria De/Para", !!nameChange && nameChange.new_value?.includes("EDITADO"), `${audit.rowCount} registro(s); name: ${nameChange?.old_value} → ${nameChange?.new_value}`);
    const deleted = await call("DELETE", `/api/providers/${providerId}`);
    const gone = (await db.query("select 1 from service_providers where id = $1", [providerId])).rowCount === 0;
    check("Excluir prestador", deleted.status < 300 && gone, `HTTP ${deleted.status}`);
  }

  // 3. Ações com efeito externo devem ser bloqueadas
  const blocked = (r: { status: number; text: string }) => /Bloqueado neste ambiente/i.test(r.text);
  const nfse = await db.query("select id, status from nfse_emissoes where coalesce(status::text,'') not in ('EMITIDA','CANCELADA') order by created_at desc limit 1");
  if (nfse.rowCount) {
    const r = await call("POST", `/api/nfse/emissoes/${nfse.rows[0].id}/processar`);
    check("NFS-e processar → bloqueado", blocked(r), `HTTP ${r.status} status=${nfse.rows[0].status} ${r.text.slice(0, 160)}`);
  } else check("NFS-e processar → bloqueado", false, "nenhuma emissão não-emitida para testar");

  const rec = await db.query("select id from receipts where coalesce(is_slip_issued,false) = false and slip_digitable_line is null order by ref_year desc, ref_month desc limit 1");
  if (rec.rowCount) {
    const r = await call("POST", `/api/receipts/${rec.rows[0].id}/slip`);
    check("Boleto emitir no Sicoob → bloqueado", blocked(r), `HTTP ${r.status} ${r.text.slice(0, 160)}`);
  } else check("Boleto emitir → bloqueado", false, "nenhum recibo sem boleto para testar");

  const tr = await db.query("select t.id from landlord_transfers t join landlords l on l.id = t.landlord_id where t.status in ('pending','failed') and coalesce(l.pix_key,'') <> '' and not exists (select 1 from pix_transfer_attempts a where a.transfer_id = t.id) order by t.created_at desc limit 1");
  if (tr.rowCount) {
    const r = await call("POST", `/api/transfers/${tr.rows[0].id}/pix-execute`);
    check("PIX executar → bloqueado", blocked(r), `HTTP ${r.status} ${r.text.slice(0, 160)}`);
  } else check("PIX executar → bloqueado", false, "nenhum repasse pendente para testar");

  // 4. Webhook Sicoob pelo endereço web (service binding web → api)
  const wh = await fetch(`${WEB}/webhook/sicoob`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pix: [], teste: "migracao" }) });
  check("Webhook Sicoob via imob.simpleit.app.br", wh.status < 300, `HTTP ${wh.status} ${(await wh.text()).slice(0, 120)}`);

  // 5. Saúde do Container
  const h = await call("GET", "/api/health");
  check("Health (efeitos desligados, banco homolog)", h.json?.sideEffectsEnabled === false && /imob_homolog/.test(h.json?.database ?? ""), JSON.stringify(h.json));
} finally {
  await db.query("delete from session where sess::text like $1", [`%${user.rows[0].id}%`]).catch(() => {});
  await db.query("delete from users where id = $1", [user.rows[0].id]);
  await db.end();
}

for (const r of results) console.log(`${r.ok ? "✅" : "❌"} ${r.item} — ${r.detalhe}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
void required;

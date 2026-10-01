# Runbook da virada — Replit → Cloudflare + Neon SP

**Data/hora agendada:** ____/____/______ às ____h (fora do horário de emissão)
**Responsáveis:** SimpleIT: ______________ · Acesso Replit (Secrets + Deploy): ______________
**Pré-requisitos:** checklist de paridade aprovado (`docs/migracao/checklist-paridade.md`); `validate.ts --target=homolog` verde; aviso aos usuários enviado.

Duração estimada da janela de somente leitura: ____ min (medida no ensaio da Task 1).

---

## 0. Antes da janela (sem efeito para os usuários)

- [ ] Merge de `migracao-cloudflare` em `main` e publicar no Replit **sem** variáveis novas (comportamento idêntico).
- [ ] Conferir login e uma tela em `sistema.imobiliariasimoes.com.br`.

## 1. T0 — Replit em somente leitura

- [ ] Replit → Secrets: `READ_ONLY=true` → Redeploy.
- [ ] Verificar: login ok; telas abrem; salvar algo mostra "Sistema em manutenção programada"; log sem `[NfseWorker] Iniciando`.
- Horário: ____:____

## 2. Fila de NFS-e

- [ ] No banco antigo (leitura): `select status, count(*) from nfse_emissoes group by status;` → anotar: ______________
  Pendentes ficam como estão e serão processadas pelo novo sistema após a virada.

## 3. Carga final em produção

```powershell
$env:CONFIRM_PRODUCTION = "SIM"
npx tsx scripts/migration/copy-db.ts --target=production
npx tsx scripts/migration/validate.ts --target=production
```
- [ ] Resultado: `✅ production: idêntico à origem`. **Qualquer diferença → Rollback (seção 8).**
- Horário: ____:____

## 4. Cloudflare em produção

```powershell
cd cloudflare/api
(Select-String -Path ../../scripts/migration/.env.migration -Pattern '^PRODUCTION_POOLER_URL=(.*)').Matches[0].Groups[1].Value | npx wrangler secret put DATABASE_URL
```
- [ ] Em `cloudflare/api/wrangler.jsonc`: `"SIDE_EFFECTS_ENABLED": "true"` → `npx wrangler deploy`.

## 5. Smoke test

- [ ] `curl https://api.imob.simpleit.app.br/api/health` → `{"ok":true}`
- [ ] Login em `https://imob.simpleit.app.br`; abrir recibos do mês; gerar um PDF de relatório
- [ ] Criar e excluir o prestador "TESTE MIGRAÇÃO"
- [ ] `npx wrangler tail imob-api`: tick por minuto; `[NfseWorker]` processando normalmente

## 6. Replit em modo legado

- [ ] Replit → Secrets: remover `READ_ONLY`; adicionar `SIDE_EFFECTS_ENABLED=false`, `LEGACY_REDIRECT_URL=https://imob.simpleit.app.br`, `LEGACY_PROXY_API_URL=https://api.imob.simpleit.app.br` → Redeploy.
- [ ] `https://sistema.imobiliariasimoes.com.br/recibos` redireciona para `https://imob.simpleit.app.br/recibos`
- [ ] Link público antigo (`/api/public/receipts/<id>/boleto`) abre via proxy
- [ ] `curl -X POST https://sistema.imobiliariasimoes.com.br/webhook/sicoob -H "content-type: application/json" -d "{}"` → mesma resposta do novo sistema

## 7. Comunicação

- [ ] Enviar aos usuários: **https://imob.simpleit.app.br** — mesmos usuários e senhas.
- Fim da janela: ____:____

## 8. Rollback (somente se 3–5 falharem)

1. Replit → Secrets: remover `READ_ONLY` e as variáveis de legado → Redeploy. O Replit volta a operar sobre o banco antigo, que não foi alterado.
2. `cloudflare/api/wrangler.jsonc`: `"SIDE_EFFECTS_ENABLED": "false"` → `npx wrangler deploy`.
3. Registrar a causa abaixo e remarcar.

Causa (se houve rollback): ______________________________________________

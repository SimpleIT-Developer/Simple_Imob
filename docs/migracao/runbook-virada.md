# Runbook da virada — Replit → Cloudflare + Neon SP

**Data/hora agendada:** ____/____/______ às ____h (fora do horário de emissão)
**Responsáveis:** SimpleIT: ______________ · Acesso Replit (Deploy): ______________ · Fornecedor do domínio (DNS): ______________
**Pré-requisitos:** checklist de paridade aprovado (`docs/migracao/checklist-paridade.md`); Custom Hostname `sistema.imobiliariasimoes.com.br` com **SSL ativo** (seção 0); aviso aos usuários enviado.

Endereço dos usuários **não muda**: `https://sistema.imobiliariasimoes.com.br`. O Replit é **descontinuado** na virada.
Duração estimada: ~40 min (cópia do banco ~70 s; build do `imob-api` ~8 min; conferências; propagação do CNAME com TTL 300 s).

---

## 0. Dias antes (sem efeito para os usuários)

- [x] Secrets do Replit conferidos em 01/10/2026: só `SESSION_SECRET`. Config vem do `.env` versionado (`DATABASE_URL`, `NFSE_ENABLE_IBSCBS_DPS=true`) — paridade com o Container OK.
- [ ] Custom Hostname `sistema.imobiliariasimoes.com.br` criado na zona `simpleit.app.br` (fallback origin `saas-imob.simpleit.app.br`, rota `sistema.imobiliariasimoes.com.br/*` → `imob-web`).
- [ ] Fornecedor do domínio criou os **TXT de validação** e baixou o **TTL** do registro `sistema` para 300 s.
- [ ] Custom Hostname com status `active` e SSL `active` (certificado emitido antes da troca do CNAME).
- [ ] Véspera: renovar a cópia de homologação e rodar `npx tsx scripts/migration/smoke-homolog.ts` → tudo ✅.
- [ ] Fornecedor do domínio confirmado para o horário da janela (passo 6).

## 1. Aviso

- [ ] Avisar os usuários do horário (o sistema fica fora por ~40 min; depois, mesmo endereço e novo login).

## 2. T0 — Desligar o Replit

- [ ] Replit → Deployments → **parar/desligar** o deploy de `sistema.imobiliariasimoes.com.br`.
- [ ] Conferir que o endereço não responde mais pelo Replit (sem escritas no banco antigo; `nfseWorker` antigo parado).
- Horário: ____:____

## 3. Fila de NFS-e e carga final

- [ ] No banco antigo (leitura): `select status, count(*) from nfse_emissoes group by status;` → anotar: ______________
  Pendentes serão processadas pelo novo sistema após a virada.

```powershell
$env:CONFIRM_PRODUCTION = "SIM"
npx tsx scripts/migration/copy-db.ts --target=production
npx tsx scripts/migration/validate.ts --target=production --tolerar-logs
Remove-Item Env:CONFIRM_PRODUCTION
```
- [ ] Resultado: `✅ production: idêntico à origem`. **Qualquer ❌ → Rollback (seção 8).**
- Horário: ____:____

## 4. Cloudflare em produção

```powershell
cd cloudflare/api
(Select-String -Path ../../scripts/migration/.env.migration -Pattern '^PRODUCTION_POOLER_URL=(.*)').Matches[0].Groups[1].Value | npx wrangler secret put DATABASE_URL
```
- [ ] Em `cloudflare/api/wrangler.jsonc`: `"SIDE_EFFECTS_ENABLED": "true"` → **commit e push** na branch de produção do Workers Builds (não usar `wrangler deploy` local: não há Docker, e o próximo build reverteria a alteração). O deploy reinicia o Container com o novo `DATABASE_URL` e a nova flag.
- [ ] Aguardar o build (aba Implantações do `imob-api`) e conferir:
  `curl https://api.imob.simpleit.app.br/api/health` → `"sideEffectsEnabled":true` e `"database":"ep-wild-mountain-b68tblk0-pooler/neondb"`

## 5. Smoke test em `imob.simpleit.app.br`

- [ ] Login; abrir recibos do mês; gerar um PDF de relatório; abrir uma DANFSe
- [ ] Criar e excluir o prestador "TESTE MIGRAÇÃO"
- [ ] `npx wrangler tail imob-api`: tick por minuto; `[NfseWorker]` processando normalmente

## 6. Troca do CNAME (fornecedor do domínio)

- [ ] Fornecedor altera: `sistema.imobiliariasimoes.com.br` **CNAME → `saas-imob.simpleit.app.br`**
- [ ] Conferir (aguardar até ~5 min): `https://sistema.imobiliariasimoes.com.br` abre com cadeado (SSL), login funciona, uma tela carrega
- [ ] `nslookup sistema.imobiliariasimoes.com.br` resolve para a Cloudflare
- Horário: ____:____

## 7. Comunicação

- [ ] Avisar os usuários: sistema liberado no mesmo endereço, com o mesmo usuário e senha (é preciso entrar de novo).
- Fim da janela: ____:____

## 8. Rollback

**Antes do passo 6** (CNAME ainda no Replit):
1. Religar o deploy do Replit. Ele volta a operar sobre o banco antigo, que não foi alterado.
2. `cloudflare/api/wrangler.jsonc`: `"SIDE_EFFECTS_ENABLED": "false"` → commit e push; conferir `/api/health` → `"sideEffectsEnabled":false`.

**Depois do passo 6:**
1. Fornecedor volta o CNAME `sistema` para o Replit; religar o deploy do Replit.
2. Mesmo passo 2 acima na Cloudflare.
3. Gravações feitas no Neon SP depois da virada precisam ser reconciliadas manualmente no banco antigo.

Causa (se houve rollback): ______________________________________________

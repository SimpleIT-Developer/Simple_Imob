# Migração Imob_Simple: Replit + Neon US → Cloudflare + Neon SP

**Data:** 2026-10-01
**Status:** Aprovado. **Revisão 05/10/2026** (aprovada): Replit descontinuado na virada; sistema servido em `sistema.imobiliariasimoes.com.br` via Cloudflare for SaaS (Custom Hostname); API no mesmo endereço (`/api` via `imob-web`); DANFSe gerado localmente.
**Cliente:** Imobiliária Simões (`https://sistema.imobiliariasimoes.com.br/`)

## 1. Objetivo e regras

Tirar o sistema do Replit + Neon (us-east-1) e levá-lo para Cloudflare (Workers `imob-web` / `imob-api` + Container) + Neon (sa-east-1), com **paridade total de funcionalidades**.

Regras inegociáveis:

1. **Paralelo, sem parar nada.** O Replit continua atendendo normalmente durante toda a montagem, cópia de dados e homologação. Nenhuma ação desta migração altera o sistema ou o banco atuais até a virada.
2. **O endereço dos usuários não muda:** `sistema.imobiliariasimoes.com.br` passa a ser servido pela Cloudflare na virada (troca do CNAME pelo fornecedor do domínio), só depois do checklist de paridade aprovado.
3. **Banco atual nunca é apagado nem alterado** — é a fonte e o rollback. Fica congelado ≥ 30 dias após a virada.
4. **Homologação nunca gera efeito externo real** (NFS-e, PIX) — ver §5.
5. Única janela inevitável: alguns minutos com o Replit desligado para a sincronização final do banco e a troca do CNAME (§7). Sem ela, os dois sistemas gravariam em bancos diferentes e poderiam emitir NFS-e/PIX em duplicidade.
6. **O Replit é descontinuado na virada** (desligado no início da janela; religado só em caso de rollback).

Fora de escopo: mover os nameservers de `imobiliariasimoes.com.br` (o domínio é administrado por outro fornecedor; só o subdomínio `sistema` é apontado, via CNAME); reescrever a API em Hono nativo (decisão: Container).

## 2. Situação atual (levantada em 2026-10-01)

- Um processo Express (`server/index.ts`, `server/routes.ts` ≈ 8 mil linhas) serve API + build do Vite; Replit Autoscale (`node dist/index.cjs`).
- Banco: Neon PostgreSQL **16**, us-east-1, **297 MB**, 22 tabelas, ~45 mil linhas (maiores: `system_logs`, `audit_logs`, `cash_transactions`). Destino: Neon PostgreSQL **18**, sa-east-1, vazio.
- Schema evolui por funções `ensure*` no boot (`server/db.ts`) além de `drizzle-kit push`.
- Dependências de ambiente Node que impedem Worker puro (motivo do Container):
  - mTLS com certificado A1 via `https.Agent({ pfx })` — NFS-e Nacional (`NfseNationalProvider.ts`) e PIX Sicoob (`SicoobProvider.ts`); há certificados por proprietário no banco (`landlords.nfse_certificate_pfx_base64`).
  - PDF (DANFSE/relatórios) via Chrome headless com `child_process.execFile`.
  - Escrita em disco: boletos em `client/public/boletos`, log `webhook_sicoob.log`.
  - `nfseWorker` com `setInterval` de 30 s.
  - `bcrypt` nativo.
- Sessão `express-session` **sem store** (memória) — hoje todo restart já desloga os usuários.
- Webhook Sicoob: `POST /webhook/sicoob` em `sistema.imobiliariasimoes.com.br`.
- `.env`, `cert/*.pfx` e `webhook_sicoob.log` estão versionados no Git (repo privado).

## 3. Arquitetura alvo

```
navegador ─► sistema.imobiliariasimoes.com.br (Custom Hostname) ─┐
navegador ─► imob.simpleit.app.br ─────────────────────────────────┴► [imob-web]  Worker + Static Assets (build Vite, fallback SPA)
                                              │ /api/* e /webhook/* → service binding → imob-api
cron / diagnóstico ─► api.imob.simpleit.app.br ─► [imob-api]  Worker Hono fino (CORS, /health, cron)
                                              │ repassa requisições → Container (instância única "main")
                                              ▼
                                      [imob-server] Cloudflare Container
                                      Node 20 + Chromium + Express atual
                                              ▼
                                      Neon sa-east-1 (branch main = produção, homolog = testes)
```

Zona: `simpleit.app.br` (já na Cloudflare). Plano Workers Paid (exigido por Containers).

### 3.1 `imob-web`
- Worker com `assets` apontando para o build do Vite; `not_found_handling: single-page-application`.
- `/api/*` e `/webhook/*` repassados ao `imob-api` via service binding: a tela chama a API **no mesmo endereço** em que foi aberta, então o cookie de login é do próprio domínio (sem CORS e sem cookie de terceiros), e links públicos já enviados (`/api/public/...`) e a URL do webhook continuam válidos.
- Build **sem** `VITE_API_URL` (API relativa).
- Rotas: custom domain `imob.simpleit.app.br` e rota `sistema.imobiliariasimoes.com.br/*` na zona `simpleit.app.br` (Custom Hostname, §7.1).

### 3.2 `imob-api`
- Worker Hono (padrão dos demais sistemas), rota `api.imob.simpleit.app.br/*`.
- CORS: origem permitida `https://imob.simpleit.app.br` (e `sistema.imobiliariasimoes.com.br` para o futuro), `credentials: true`.
- Repassa toda requisição ao Container `getByName("main")` — **instância única**, para que `nfseWorker` rode uma só vez e não haja concorrência de fila.
- **Cron `* * * * *`**: chama um endpoint interno do Container (`POST /internal/tick`, autenticado por `INTERNAL_TOKEN`) que mantém o Container acordado e dispara `nfseWorker.processQueue()`. O `setInterval` interno continua existindo enquanto o Container está acordado.
- `/health` no Worker + `/api/health` no Container (verifica conexão com o banco).

### 3.3 `imob-server` (Container)
Express atual com mudanças mínimas, cada uma isolada atrás de variável de ambiente cujo **valor ausente reproduz exatamente o comportamento atual** — o Replit publica a partir do mesmo repositório e não pode mudar de comportamento:

| Mudança (variável) | Motivo |
|---|---|
| Não servir estáticos quando `SERVE_STATIC=false` | Web fica no `imob-web` |
| Sessão em Postgres quando `SESSION_STORE=pg` (`connect-pg-simple`, já nas deps; tabela `session`) | Login sobrevive a restart/hibernação do Container |
| Cookie `secure: true` quando `SESSION_COOKIE_SECURE=true`, `sameSite: "lax"`, host-only; `trust proxy` | `imob.` e `api.imob.` são *same-site*, então `Lax` funciona sem depender de cookie de terceiros |
| `SicoobProvider` aceita `SICOOB_CERT_PFX_B64` (cai para `NFSE_CERT_PFX_B64`) antes do arquivo `cert/` | Certificado vem de secret, não do Git |
| `bcrypt` mantido (prebuild Linux na imagem) | Sem troca de lib = sem risco nos hashes |
| Endpoint `POST /internal/tick` (exige `INTERNAL_TOKEN`) | Cron |
| `SIDE_EFFECTS_ENABLED=false` (§5) | Segurança da homologação |
| `READ_ONLY=true` e `LEGACY_REDIRECT_URL`/`LEGACY_PROXY_API_URL` | Implementados, mas **não usados** desde a revisão de 05/10/2026 (Replit desligado na virada) |

Boletos: a gravação em `client/public/boletos` continua como está (o PDF exibido ao usuário já vem da 2ª via do Sicoob em `/api/receipts/:id/boleto-pdf`, e o arquivo em disco não é servido nem hoje no Replit em produção). O log em arquivo do webhook também fica como está (disco efêmero, mas gravável). Nenhum R2 é necessário.

DANFSe: a API `/danfse` do ADN foi suspensa em 03/08/2026; `baixarDanfsePdf` baixa o XML autorizado na consulta `sefin` (mTLS) e gera o DANFSe v2.0 (NT 008 v1.02) localmente com o gerador portado do SimpleDFe (`server/services/danfse/`, `pdf-lib`). O link público serve o PDF em vez de redirecionar.

Mantidos **sem alteração**: mTLS com `https.Agent({ pfx })` (NFS-e e Sicoob), Chromium para PDF de relatórios, `xml-crypto`, `node-forge`, `pdf-parse`. O proxy mTLS do fly.io **não é usado** nesta arquitetura.

Imagem: `Dockerfile` com `node:20-bookworm-slim` + `chromium` + fontes; `BROWSER_PATH=/usr/bin/chromium`; build via `npm run build` (só o bundle do servidor).

### 3.4 Frontend
- `apiUrl()`/`absoluteApiUrl()` e o wrapper de `fetch` continuam no código, mas o build de produção não define `VITE_API_URL`: tudo vai para `/api` no mesmo endereço (§3.1).

### 3.5 Secrets e configuração
- `wrangler secret` (nunca no Git): `DATABASE_URL`, `SESSION_SECRET`, `INTERNAL_TOKEN`, `NFSE_CERT_PFX_B64`, `NFSE_CERT_PFX_PASSPHRASE`.
- `vars`: `SIDE_EFFECTS_ENABLED`, `NFSE_ENABLE_IBSCBS_DPS`, `CORS_ORIGINS`.
- `.dockerignore` exclui `.env`, `cert/`, `*.log`, `.dbg/`, `node_modules`, `dist` da imagem.
- **Remoção de `.env`, `cert/*` e `webhook_sicoob.log` do Git só depois da virada** (§9): até lá o Replit (que lê `DATABASE_URL` do `.env` versionado) precisa poder ser religado para rollback.
- Replit continua usando seus próprios secrets — nada muda lá até a virada.

## 4. Migração do banco

Ferramenta: cliente PostgreSQL 18 (`pg_dump`/`pg_restore`) instalado na máquina de trabalho (dump 18 lendo servidor 16 é suportado). Formato custom, `--no-owner --no-privileges`.

Branches no Neon SP:
- `homolog` — recebe cópias para testes, quantas vezes forem necessárias.
- `main` — recebe **somente** a carga final da virada.

Script `scripts/migration/validate.ts` compara origem × destino e falha se houver qualquer diferença:
- lista de tabelas, colunas e tipos;
- contagem de linhas por tabela;
- valores atuais de sequences;
- enums e seus valores;
- índices, constraints e FKs;
- checksum por tabela (`md5(string_agg(row::text ORDER BY pk))`).

Ensaio: dump → restore em `homolog` → validação → registrar tempos (alimenta a janela da virada).

Observação: a tabela `_system.replit_database_migrations_v1` é copiada por fidelidade, sem uso fora do Replit.

## 5. Proteção contra efeitos externos (`SIDE_EFFECTS_ENABLED`)

Com `SIDE_EFFECTS_ENABLED=false` (padrão em homologação):
- `nfseWorker` não inicia e `/internal/tick` não processa fila;
- emissão e cancelamento de NFS-e (`emitirNfse`, `cancelarNfse`), emissão de boleto (`emitirBoleto`) e PIX (`initiatePixPayment`, `confirmPixPayment`, `confirmPixPaymentByAccount`) lançam erro explícito "Bloqueado em homologação" **antes** de qualquer chamada de rede;
- consultas (2ª via de boleto, consulta de NFS-e/PIX, download de XML/DANFSE) continuam liberadas — são somente leitura;
- geração de XML assinado, PDFs, cálculos e telas funcionam normalmente.

Só vale `true` na produção Cloudflare após a virada. Teste de mTLS real em homologação é feito apenas com chamadas **somente leitura** (consulta), via script dedicado.

## 6. Homologação (paralela, Replit intacto)

1. Deploy de `imob-web`, `imob-api`, `imob-server` apontando para `homolog`, `SIDE_EFFECTS_ENABLED=false`.
2. Checklist de paridade (documento `docs/migracao/checklist-paridade.md`), executado lado a lado Replit × Cloudflare:
   login/2FA, usuários e permissões por campo, proprietários, locatários, fiadores, prestadores, imóveis, contratos, serviços, recibos, caixa, repasses, controle de despesas (saldo anterior), notas, NFS-e (montagem/assinatura), PIX (montagem), relatórios, DIMOB, PDFs/DANFSE, exportação contábil ZIP, auditoria, boletos, webhook Sicoob simulado.
3. Teste mTLS somente leitura (NFS-e Nacional e Sicoob) dentro do Container.
4. Teste de hibernação: Container dormindo → requisição acorda → sessão preservada → cron reprocessa.
5. Medição de latência Container ↔ Neon SP (aceitável: páginas principais não mais lentas que no Replit).

Critério para seguir à virada: checklist 100% OK + validação do banco 100% OK + aprovação explícita do responsável.

## 7. Virada (janela curta, agendada fora do horário de emissão)

### 7.1 Domínio do cliente — Cloudflare for SaaS (Custom Hostname)
- O domínio `imobiliariasimoes.com.br` é administrado por **outro fornecedor**; ele só cria registros no subdomínio `sistema`.
- Na zona `simpleit.app.br`: ativar Cloudflare for SaaS; fallback origin `saas-imob.simpleit.app.br` (registro originless `AAAA 100::`, proxied); custom hostname `sistema.imobiliariasimoes.com.br` com **validação TXT** (pré-validação + certificado emitido antes da virada); rota de Worker `sistema.imobiliariasimoes.com.br/*` → `imob-web`.
- **Dias antes:** fornecedor cria os TXT de validação e baixa o TTL do `sistema` para 300 s. Nada muda para os usuários.
- **Na janela:** fornecedor troca `sistema` CNAME → `saas-imob.simpleit.app.br`.

### 7.2 Passos
1. Aviso prévio aos usuários (mesmo endereço; novo login após a virada).
2. **Desligar o deploy do Replit** (sem escritas no banco antigo; `nfseWorker` antigo parado).
3. Dump final → restore na `main` do Neon SP → `validate.ts --tolerar-logs` sem ❌.
4. Produção Cloudflare: `DATABASE_URL` da `main` (secret) + `SIDE_EFFECTS_ENABLED=true` (commit + Workers Builds) → conferir `/api/health`.
5. Smoke test em `imob.simpleit.app.br` (login, listar, gravar e remover registro de teste, PDF, DANFSe).
6. Fornecedor troca o CNAME `sistema`; conferir `https://sistema.imobiliariasimoes.com.br` (SSL ativo, login, uma tela).
7. Comunicar a conclusão aos usuários.

Tempo estimado: ~40 min (cópia ~70 s; build do `imob-api` ~8 min; conferências; propagação do CNAME com TTL 300 s).

## 8. Rollback
- Antes do passo 6: religar o Replit (banco antigo intocado) e voltar `SIDE_EFFECTS_ENABLED=false` na Cloudflare. Nada perdido.
- Depois do passo 6: fornecedor volta o CNAME para o Replit e o Replit é religado; gravações feitas no Neon SP nesse meio-tempo precisariam ser reconciliadas manualmente — por isso o critério de §6 é rígido e as primeiras 48 h têm monitoramento ativo.

## 9. Pós-virada

- Monitoramento 48 h: `wrangler tail`, observability, fila `nfse_emissoes`, `pix_transfer_attempts`.
- Rotacionar senhas dos dois bancos (expostas em chat) e atualizar secrets.
- Remover `.env`, `cert/*` e `webhook_sicoob.log` do índice do Git e adicioná-los ao `.gitignore`.
- Atualizar `DEPLOY.md` do projeto (padrão Gabinete/SimpleERP) e `replit.md`.
- Após ≥ 30 dias estáveis: excluir o deploy do Replit, arquivar o banco antigo (dump final guardado) e apagar o banco `imob_homolog`.

## 10. Riscos

| Risco | Mitigação |
|---|---|
| Homologação emitir NFS-e/PIX real | `SIDE_EFFECTS_ENABLED=false`, bloqueio antes da rede, branch `homolog` |
| Duas instâncias do Container processando fila | Instância única `getByName("main")`; Replit com worker desligado na virada |
| Container hibernar e parar a fila | Cron 1 min + `/internal/tick` |
| Diferença PG16 → PG18 | Ensaio completo + `validate.ts` + checklist funcional |
| Latência Container ↔ Neon SP | **Medido em 01/10/2026:** Cloudflare não permite fixar a região do Container (com `locationHint: "sam"` no DO ele subiu em BOM/Mumbai; `dbMs` ≈ 243 ms por consulta; telas mais lentas que no Replit). **Decisão do responsável: aceitar por ora e reavaliar.** Alternativa avaliada e pronta para adotar: manter `imob-web`/`imob-api` na Cloudflare e mover só o Express (mesmo Dockerfile) para Fly.io região `gru`. Monitorar `colo` e `dbMs` em `/api/health`. |
| Cookie entre subdomínios | Same-site (`Lax; Secure`, host-only) + CORS com credentials; testado na homologação |
| Alteração no repo mudar o Replit | Toda mudança atrás de variável; ausente = comportamento atual; teste de regressão local sem variáveis |
| Segredos no Git | Fora da imagem via `.dockerignore`; removidos do índice após a virada; secrets na Cloudflare |
| Docker exigido pelo `wrangler deploy` do Container | Workers Builds (Linux) ou Docker Desktop local |

# Migração Imob_Simple: Replit + Neon US → Cloudflare + Neon SP

**Data:** 2026-10-01
**Status:** Design aprovado — aguardando revisão da spec escrita
**Cliente:** Imobiliária Simões (`https://sistema.imobiliariasimoes.com.br/`)

## 1. Objetivo e regras

Tirar o sistema do Replit + Neon (us-east-1) e levá-lo para Cloudflare (Workers `imob-web` / `imob-api` + Container) + Neon (sa-east-1), com **paridade total de funcionalidades**.

Regras inegociáveis:

1. **Paralelo, sem parar nada.** O Replit continua atendendo normalmente durante toda a montagem, cópia de dados e homologação. Nenhuma ação desta migração altera o sistema ou o banco atuais até a virada.
2. **Usuários só recebem a URL nova quando tudo estiver OK** (checklist de paridade 100% aprovado).
3. **Banco atual nunca é apagado nem alterado** — é a fonte e o rollback. Fica congelado ≥ 30 dias após a virada.
4. **Homologação nunca gera efeito externo real** (NFS-e, PIX) — ver §5.
5. Única janela inevitável: alguns minutos de sistema antigo em somente leitura para a sincronização final do banco (§7). Sem ela, os dois sistemas gravariam em bancos diferentes e poderiam emitir NFS-e/PIX em duplicidade.

Fora de escopo: migrar o domínio `imobiliariasimoes.com.br` para a Cloudflare (DNS é do cliente/terceiro — fase futura); reescrever a API em Hono nativo (decisão: Container).

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
navegador ─► imob.simpleit.app.br ──────► [imob-web]  Worker + Static Assets (build Vite, fallback SPA)
                                              │ /webhook/* → service binding → imob-api
navegador ─► api.imob.simpleit.app.br ──► [imob-api]  Worker Hono fino (CORS, /health, cron)
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
- `/api/*` e `/webhook/*` repassados ao `imob-api` via service binding — links públicos já enviados (`/api/public/...`) e a URL do webhook continuam válidos quando o domínio do cliente for apontado no futuro.
- Build variable: `VITE_API_URL=https://api.imob.simpleit.app.br`.

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
| `READ_ONLY=true` e `LEGACY_REDIRECT_URL`/`LEGACY_PROXY_API_URL` (§7) | Usados só no Replit, na virada |

Boletos: a gravação em `client/public/boletos` continua como está (o PDF exibido ao usuário já vem da 2ª via do Sicoob em `/api/receipts/:id/boleto-pdf`, e o arquivo em disco não é servido nem hoje no Replit em produção). O log em arquivo do webhook também fica como está (disco efêmero, mas gravável). Nenhum R2 é necessário.

Mantidos **sem alteração**: mTLS com `https.Agent({ pfx })` (NFS-e e Sicoob), Chromium para PDF, `xml-crypto`, `node-forge`, `pdf-parse`. O proxy mTLS do fly.io **não é usado** nesta arquitetura.

Imagem: `Dockerfile` com `node:20-bookworm-slim` + `chromium` + fontes; `BROWSER_PATH=/usr/bin/chromium`; build via `npm run build` (só o bundle do servidor).

### 3.4 Frontend
- Um wrapper global de `fetch` (instalado em `main.tsx`) prefixa `import.meta.env.VITE_API_URL` em toda URL que começa com `/api` e usa `credentials: "include"` (vazio = comportamento atual, então o Replit não muda).
- `window.open('/api/...')` e os links públicos (`${window.location.origin}/api/public/...`) passam a usar `apiUrl()`.

### 3.5 Secrets e configuração
- `wrangler secret` (nunca no Git): `DATABASE_URL`, `SESSION_SECRET`, `INTERNAL_TOKEN`, `NFSE_CERT_PFX_B64`, `NFSE_CERT_PFX_PASSPHRASE`.
- `vars`: `SIDE_EFFECTS_ENABLED`, `NFSE_ENABLE_IBSCBS_DPS`, `CORS_ORIGINS`.
- `.dockerignore` exclui `.env`, `cert/`, `*.log`, `.dbg/`, `node_modules`, `dist` da imagem.
- **Remoção de `.env`, `cert/*` e `webhook_sicoob.log` do Git só depois da virada** (§9): o Replit puxa deste repositório, e apagar o `.pfx` do Git antes disso removeria o certificado do workspace do Replit, quebrando NFS-e e PIX em produção.
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

1. Aviso prévio aos usuários.
2. Replit em **somente leitura**: deploy de versão com `READ_ONLY=true` (bloqueia métodos de escrita na API com mensagem amigável) e `nfseWorker` desligado. Leitura continua disponível.
3. Dump final → restore na `main` do Neon SP → `validate.ts` 100% OK.
4. Produção Cloudflare: `DATABASE_URL` da `main`, `SIDE_EFFECTS_ENABLED=true`.
5. Smoke test (login, listar, gravar um registro de teste e removê-lo, gerar um PDF).
6. Replit passa ao **modo legado** (`LEGACY_REDIRECT_URL`, `LEGACY_PROXY_API_URL`):
   - `/webhook/*` e `/api/public/*` → **proxy reverso** para `api.imob.simpleit.app.br` (webhook do Sicoob e links já enviados a locatários continuam funcionando sem mexer no DNS do cliente);
   - páginas → **redirecionamento 302** para `https://imob.simpleit.app.br` + mesmo caminho (quem abrir o endereço antigo cai no novo);
   - demais `/api/*` → 410 com mensagem "Sistema mudou de endereço".
7. Comunicar a URL nova `https://imob.simpleit.app.br` aos usuários.

Tempo estimado: definido no ensaio (dados de 297 MB → poucos minutos de dump/restore).

## 8. Rollback

- Durante a janela (antes do passo 6): reverter o Replit para a versão normal (sem `READ_ONLY`), apontando para o banco antigo intocado. Nada perdido.
- Após a virada: há gravações novas apenas no Neon SP; rollback exige dump do Neon SP → banco antigo. Por isso o critério de §6 é rígido e as primeiras 48 h têm monitoramento ativo.

## 9. Pós-virada

- Monitoramento 48 h: `wrangler tail`, observability, fila `nfse_emissoes`, `pix_transfer_attempts`.
- Rotacionar senhas dos dois bancos (expostas em chat) e atualizar secrets.
- Remover `.env`, `cert/*` e `webhook_sicoob.log` do índice do Git e adicioná-los ao `.gitignore`.
- Atualizar `DEPLOY.md` do projeto (padrão Gabinete/SimpleERP) e `replit.md`.
- Após ≥ 30 dias estáveis: desligar Replit e arquivar o banco antigo.
- Fase futura: domínio do cliente na Cloudflare (nameservers ou Custom Hostname).

## 10. Riscos

| Risco | Mitigação |
|---|---|
| Homologação emitir NFS-e/PIX real | `SIDE_EFFECTS_ENABLED=false`, bloqueio antes da rede, branch `homolog` |
| Duas instâncias do Container processando fila | Instância única `getByName("main")`; Replit com worker desligado na virada |
| Container hibernar e parar a fila | Cron 1 min + `/internal/tick` |
| Diferença PG16 → PG18 | Ensaio completo + `validate.ts` + checklist funcional |
| Latência Container ↔ Neon SP | Medida na homologação; placement/região ajustados se necessário |
| Cookie entre subdomínios | Same-site (`Lax; Secure`, host-only) + CORS com credentials; testado na homologação |
| Alteração no repo mudar o Replit | Toda mudança atrás de variável; ausente = comportamento atual; teste de regressão local sem variáveis |
| Segredos no Git | Fora da imagem via `.dockerignore`; removidos do índice após a virada; secrets na Cloudflare |
| Docker exigido pelo `wrangler deploy` do Container | Workers Builds (Linux) ou Docker Desktop local |

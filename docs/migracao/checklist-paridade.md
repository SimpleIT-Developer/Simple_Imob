# Checklist de paridade — Replit × Cloudflare (homologação)

- **Replit (produção atual):** https://sistema.imobiliariasimoes.com.br
- **Cloudflare (homologação):** https://imob.simpleit.app.br — banco: database `imob_homolog` (projeto Neon novo), `SIDE_EFFECTS_ENABLED=false`
- **Sincronização automática a cada 10 min** (tarefa agendada `Imob-SyncHomolog` nesta máquina, `scripts/migration/sync-homolog.ts`): o `imob_homolog` é recriado a partir do banco do Replit (~100 s) e validado. Só lê a origem. O que for gravado na Cloudflare some na próxima renovação, e durante a renovação a homologação pode dar erro. Log: `scripts/migration/dumps/sync-homolog.log`. A máquina precisa estar ligada.
- Renovar na hora: `npx tsx scripts/migration/sync-homolog.ts`.
- Em homologação, ações que geram efeito externo (emitir/cancelar NFS-e, emitir boleto, enviar PIX) **devem** mostrar "Bloqueado neste ambiente". Isso é o resultado correto.

Legenda da coluna OK?: ✅ igual · ❌ diferente (descrever) · ➖ não se aplica

| # | Item | Replit | Cloudflare | OK? | Observação |
|---|---|---|---|---|---|
| 1 | Login, logout, 2FA (setup e login); sessão mantida ao recarregar e após 20 min parado (Container hibernado) | | | | |
| 2 | Usuários: criar, editar; permissões por campo (Todos/Nenhum/Personalizado) bloqueiam no front e no back | | | | |
| 3 | Proprietários, locatários, fiadores, prestadores, imóveis (incl. status do imóvel): listar, criar, editar, excluir | | | | |
| 4 | Contratos e itens recorrentes | | | | |
| 5 | Serviços e lançamentos do mês | | | | |
| 6 | Recibos: gerar, editar, desconto, split de proprietário, imprimir (`/print-receipt`), link público do recibo | | | | |
| 7 | Boleto: emitir → "Bloqueado neste ambiente"; 2ª via em PDF de boleto já existente abre | | | | |
| 8 | Caixa (`/cash`) e Controle de Despesas: saldo anterior e fechamento iguais ao Replit no mesmo mês | | | | |
| 9 | Repasses e PIX: montar repasse; enviar PIX → "Bloqueado neste ambiente" | | | | |
| 10 | NFS-e: listar emissões, XML, DANFSE (download), link público da DANFSE; emitir/cancelar → bloqueado | | | | |
| 11 | Relatórios: receita, seguros, repasses, notas emitidas (PDF via Chromium), DIMOB (tela e exportações) | | | | |
| 12 | Exportação contábil de NFS-e (ZIP) | | | | |
| 13 | Auditoria: alteração registrada com De/Para e campos sensíveis mascarados | | | | |
| 14 | Webhook Sicoob simulado: `POST https://imob.simpleit.app.br/webhook/sicoob` com payload de exemplo → mesma resposta do Replit | | | | |
| 15 | Tempo de resposta (ms): listas de recibos/contratos e dashboard — Cloudflare ≤ Replit | | | | |
| 16 | Cron: `npx wrangler tail imob-api` mostra 1 tick/min sem erro durante 30 min | | | | |
| 17 | mTLS real (somente leitura): `POST /__mtls-check` → `{"sicoob":"ok","nfse":"ok"}` | | | | |

## Critério de saída

- Todos os itens ✅ (ou ➖ justificado)
- `validate.ts --target=homolog` verde
- Aprovação explícita do responsável para agendar a virada

Aprovado por: ____________________  Data: ____/____/______

## Resultados — 01/10/2026

**Validado pelo responsável (manual):** itens 1 (login/2FA/permissões), 2–6 e 8 (telas de consulta e dados), 10–12 (relatórios, PDFs, DIMOB, ZIP, XML).
**Item 15 (tempo de resposta):** Cloudflare mais lenta que o Replit — Container sem região fixa (colo BOM, ~245 ms por consulta ao banco). Decisão: aceitar por ora (ver spec §10).

**Automático** (`npx tsx scripts/migration/smoke-homolog.ts`, usuário admin temporário criado e removido só no `imob_homolog`) — 11/11 ✅:

| Teste | Resultado |
|---|---|
| Login com cookie + CORS; sessão mantida | ✅ |
| Prestador: criar / editar / excluir | ✅ |
| Auditoria De/Para na edição | ✅ |
| NFS-e processar → "Bloqueado neste ambiente" | ✅ |
| Boleto (Sicoob, `POST /api/receipts/:id/slip`) → bloqueado | ✅ |
| PIX (`/api/transfers/:id/pix-execute`) → bloqueado | ✅ |
| Webhook Sicoob via `imob.simpleit.app.br/webhook/sicoob` | ✅ |
| Health: efeitos desligados, banco `imob_homolog` | ✅ |
| Cron 1/min sem erro (`wrangler tail`) | ✅ |
| mTLS real: Sicoob 2ª via `ok`; NFS-e consulta `sefin` HTTP 200 | ✅ |
| DANFSe (link público e botão) | ✅ gerado localmente (v2.0, NT 008) — conferido em 05/10/2026 com a NFS-e 1686 |

Observações:
- `POST /api/receipts/:id/emit-slip` só marca o recibo como "boleto emitido" (não chama o Sicoob) — mesmo comportamento do Replit.
- Repasse com PIX bloqueado fica com tentativa "pendente de confirmação" e o sistema recusa nova tentativa (proteção contra duplicidade) até a próxima renovação da cópia de homologação.

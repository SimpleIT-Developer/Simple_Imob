# Checklist de paridade — Replit × Cloudflare (homologação)

- **Replit (produção atual):** https://sistema.imobiliariasimoes.com.br
- **Cloudflare (homologação):** https://imob.simpleit.app.br — banco: branch Neon `homolog`, `SIDE_EFFECTS_ENABLED=false`
- Antes de cada sessão de testes, renovar a cópia: `npx tsx scripts/migration/copy-db.ts --target=homolog` e `npx tsx scripts/migration/validate.ts --target=homolog`.
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

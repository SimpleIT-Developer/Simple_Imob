# Debug Session: nfse-reprocess-lock

Status: OPEN

## Sintoma

- Ao clicar em `Reprocessar` na tela de `Notas Fiscais`, a UI mostra `Falha Emissão`, mas a ação retorna `EMISSÃO JÁ EM PROCESSAMENTO OU EMITIDA`.

## Contexto

- Projeto: `d:\Imob_Simple`
- Tela afetada: `client/src/pages/invoices.tsx`
- Backend suspeito: `server/routes.ts`, `server/providers/NfseNationalProvider.ts`

## Hipóteses

1. O endpoint `/api/nfse/emissoes/:id/processar` ainda está lendo um status bruto `ENVIANDO` e bloqueando antes da normalização efetiva.
2. A emissão é liberada no route handler, mas `emitirNfse()` recarrega do banco e reencontra `ENVIANDO`, barrando no guard interno.
3. O frontend está chamando o `emissaoId` errado ou usando um registro desatualizado após o refresh.
4. Existe outra atualização concorrente que recoloca o status em `ENVIANDO` entre o clique e a chamada ao provider.
5. O retorno `409` vem de um ramo diferente do esperado e a mensagem genérica esconde qual guard falhou.

## Plano

1. Iniciar servidor de debug e instrumentar frontend/backend.
2. Reproduzir o clique em `Reprocessar`.
3. Coletar logs pre-fix e identificar qual hipótese se confirma.
4. Aplicar correção mínima orientada por evidência.
5. Validar com logs post-fix.

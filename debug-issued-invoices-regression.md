# [OPEN] Debug Session: issued-invoices-regression

## Bug
- Sintoma: o relatório de Notas Fiscais emitidas voltou a não exibir NFs.
- Esperado: listar as NFS-e emitidas já existentes no sistema.

## Hipóteses
- H1: a rota `/api/reports/invoices-issued` está retornando zero itens por falha no filtro de período.
- H2: existem emissões, mas o filtro por `status` ou `emissionDate` está descartando registros válidos.
- H3: a API retorna itens, porém o frontend zera a lista em filtragem local/renderização.
- H4: alguma coleção auxiliar (`invoices`, `receipts`, `contracts`, `properties`) falha/interfere na montagem final do payload.
- H5: houve regressão de autenticação/resposta HTTP e o frontend não está consumindo o payload esperado.

## Evidence Plan
- Instrumentar backend no fluxo do relatório para registrar contagens, filtros aplicados e tamanho final da resposta.
- Instrumentar frontend para registrar query, resposta recebida e quantidade após filtro local.
- Reproduzir o problema e comparar logs `pre-fix` antes de qualquer ajuste de lógica.

## Evidence Collected
- `pre-fix`: a API respondeu itens normalmente quando o intervalo era valido, por exemplo `items = 167` para maio/2026 e `items = 53` para junho/2026.
- `pre-fix`: o frontend tambem recebeu e exibiu a mesma quantidade (`apiItems = 167`, `filteredItems = 167`; depois `apiItems = 53`, `filteredItems = 53`).
- `pre-fix`: os casos com zero itens observados nesta sessao coincidiram com filtros sem resultados ou intervalo invertido (`startDate > endDate`), nao com quebra geral da API.
- Confirmado nesta reproducao: a principal divergencia visivel era a ordenacao, que estava das mais novas para as mais antigas.

## Fix Applied
- Backend do relatorio ajustado para ordenar `emissionDate` em ordem crescente.
- Frontend da tabela ajustado para ordenar `emissionDate` em ordem crescente.
- Instrumentacao alterada para registrar a proxima reproducao como `post-fix`.

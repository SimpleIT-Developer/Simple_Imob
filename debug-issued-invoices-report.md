# [OPEN] Debug Session: issued-invoices-report

## Bug
- Sintoma: o relatório de Notas Fiscais Emitidas não mostra nenhuma NF.
- Esperado: listar as NFS-e emitidas já existentes no sistema.

## Hipóteses
- H1: não existem emissões com `status = EMITIDA` no conjunto que a rota lê.
- H2: existem emissões, mas o vínculo `origemTipo/origemId` não fecha com `invoice/receipt/contract/property`.
- H3: o filtro de período descarta as emissões por conversão de data.
- H4: o frontend recebe dados, mas a lista é zerada por filtragem/renderização.
- H5: a rota responde com erro ou payload diferente do esperado.

## Plano
- Adicionar instrumentação na rota do relatório e na tela.
- Reproduzir a consulta da tela.
- Analisar logs coletados.
- Aplicar a correção mínima baseada em evidência.
- Validar com comparação antes/depois.

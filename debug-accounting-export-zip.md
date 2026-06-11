# [OPEN] Debug Session: accounting-export-zip

## Bug
- Sintoma: a tela `Contabilidade > Exportar NF's` não está gerando o arquivo ZIP ao final.
- Esperado: baixar um ZIP contendo `XML/` e `DANFSE/` para o mês/ano selecionados.

## Hipóteses
- H1: o frontend recebe erro HTTP do endpoint `/api/accounting/export-nfse` e aborta antes do download.
- H2: o backend encontra notas, mas falha ao montar ou finalizar o `JSZip`.
- H3: XML e DANFSE falham para todas as notas, fazendo o endpoint retornar erro em vez do ZIP.
- H4: o `Content-Disposition`/blob chega incorreto no frontend e o download não é disparado.
- H5: o período selecionado não retorna emissões `EMITIDA`, então o endpoint termina sem gerar arquivo.

## Evidence Plan
- Instrumentar a tela para registrar requisição, status HTTP e metadados do blob recebido.
- Instrumentar o endpoint para registrar filtros, contagens de exportação e motivo de falha final.
- Reproduzir uma exportação e comparar os logs antes de qualquer ajuste de lógica.

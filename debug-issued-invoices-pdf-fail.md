# [OPEN] Debug Session: issued-invoices-pdf-fail

## Bug
- Sintoma: em ambiente publicado, o botão de gerar PDF do relatório de Notas Fiscais falha.
- Esperado: baixar o PDF do relatório com sucesso.

## Hipóteses
- H1: o servidor publicado não encontra um navegador headless disponível (Edge/Chrome) para renderizar o HTML em PDF.
- H2: o comando headless executa, mas falha por permissão/sandbox/paths no ambiente publicado.
- H3: a rota `/api/reports/invoices-issued/pdf` está falhando por timeout (relatório grande, renderização lenta).
- H4: o endpoint retorna PDF, mas o frontend trata como erro por status/cors/cache (menos provável).
- H5: a publicação não inclui algum binário/dependência necessária (ex.: navegador instalado).

## Evidence Plan
- Instrumentar o backend na geração do PDF para registrar plataforma, browserPath detectado e códigos de erro do comando.
- Instrumentar o frontend para registrar status HTTP e mensagem quando falhar.
- Reproduzir em modo publicado (ou local em `NODE_ENV=production`) e coletar logs `pre-fix`.

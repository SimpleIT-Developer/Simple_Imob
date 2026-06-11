# [OPEN] Debug Session: accounting-danfse-prod

## Bug
- Sintoma: na exportacao `Contabilidade > Exportar NF's`, as DANFSE falham apenas em producao (deploy).
- Esperado: baixar DANFSE de todas as NFs; sem fallback; insistir ate obter o PDF mesmo que demore.

## Hipoteses
- H1: o deploy tem timeout de requisicao (proxy/load balancer) e o ZIP nunca chega ao final, mesmo com retries.
- H2: o certificado PFX nao esta disponivel/legivel no deploy, causando falhas ao baixar DANFSE (retries nao ajudam).
- H3: a rede do deploy para `adn.nfse.gov.br`/`adn.producaorestrita.nfse.gov.br` esta instavel/bloqueada e gera 502/ECONNRESET frequentes.
- H4: o endpoint retorna HTML/erro no lugar de PDF (content-type), e o fluxo atual fica retryando sem nunca convergir.
- H5: o processo do deploy reinicia/escala durante a exportacao e interrompe o processamento.

## Evidence Plan
- Instrumentar a exportacao para registrar: tempo total, tentativas por emissao, status/httpCode, e se chegou a gerar ZIP.
- Registrar esses eventos em um local visivel no deploy (Logs do Sistema), ja que o Debug Server local nao esta acessivel a partir do deploy.
- Reproduzir no deploy, coletar evidencias e entao aplicar o fix minimo.

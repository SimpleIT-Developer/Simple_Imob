# [OPEN] Debug Session: update-nfse-number-json-error

## Bug
- Sintoma: ao clicar no botão para atualizar o número da NFS-e pelo XML em `Notas Fiscais`, a UI mostra `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.
- Esperado: a API deve retornar JSON com `numeroNfse` atualizado, e a tela deve exibir toast de sucesso.

## Hipóteses
- H1: a rota `POST /api/nfse/emissoes/:id/atualizar-numero-xml` não está sendo registrada no servidor publicado/local e a requisição está caindo em uma página HTML de 404.
- H2: a requisição está sendo redirecionada para HTML de login/autenticação, então o frontend tenta fazer `res.json()` em uma resposta não-JSON.
- H3: a rota existe, mas está lançando uma exceção antes de retornar JSON e o servidor está respondendo com uma página HTML de erro.
- H4: o helper `apiRequest()` está tratando incorretamente respostas não-JSON e mascarando o erro real da API.
- H5: o clique está chamando um endpoint diferente do esperado por causa de algum problema no `emissao.id` ou na montagem da URL.

## Plano
- Instrumentar frontend e backend para capturar URL, status HTTP, `content-type` e corpo parcial da resposta.
- Reproduzir o clique no botão `Atualizar NFS-e`.
- Confirmar qual hipótese explica o retorno HTML.
- Aplicar a correção mínima.

## Evidência Coletada
- O frontend registrou resposta `200` com `content-type: text/html; charset=utf-8`.
- O corpo começou com `<!DOCTYPE html>` e incluiu o runtime do Vite (`createHotContext` / `__dummy__runtime-error-plugin`).
- O terminal mostrou `POST /api/nfse/emissoes/<id>/atualizar-numero-xml 200`, o que é compatível com o fallback do app respondendo HTML para uma rota de API ainda não carregada no processo atual.

## Conclusão Atual
- H1 confirmada: o processo do backend em execução ainda não carregou a rota nova `POST /api/nfse/emissoes/:id/atualizar-numero-xml`.
- H2 rejeitada: não é redirecionamento para login.
- H3 rejeitada: não é exceção JSON da rota nova, porque a resposta recebida é HTML do Vite, não erro JSON do Express.

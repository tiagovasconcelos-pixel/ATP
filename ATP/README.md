# ATP Investimentos — painel de aporte

Painel do aporte mensal do fundo. Qualquer pessoa com o link abre, toca no
próprio nome e marca o depósito. **Não precisa de conta em lugar nenhum.**

## Arquivos

- `index.html` — a página
- `api/estado.js` — lê a configuração e os depósitos de um mês
- `api/marcar.js` — grava o clique e a edição da conta
- `package.json` — marca o projeto como ESM. Sem dependências.

## Banco

Upstash Redis, criado pelo Marketplace da Vercel. As credenciais são injetadas
pela própria Vercel; nenhuma chave fica no código.

Aceita os dois padrões de nome de variável:
`KV_REST_API_URL` / `KV_REST_API_TOKEN` ou
`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`.

Chaves usadas: `atp:config` e `atp:dep:AAAA-MM`.

**Sem o banco conectado a página abre e mostra os dados padrão, mas gravar
responde 503 com a instrução.** Isso é de propósito: falha visível, não calada.

## Quem pode marcar

Quem tem o link. Para três sócios num grupo fechado isso é o que torna a coisa
simples — e é decisão dele, de 23/10/2026.

# Fiscal Digital — Collectors

## Hierarquia de contexto (lê PRIMEIRO)

Antes de qualquer trabalho aqui, **abrir e ler [`../fiscal-digital/CLAUDE.md`](../fiscal-digital/CLAUDE.md)**.

Esse e o documento mestre do projeto. Principios inegociaveis, regras de ouro
(TypeScript strict, Node 24, OIDC, kebab-case AWS), governanca open source,
contrato de brand pack — tudo la. **Nao duplicar conteudo aqui.**

---

## Escopo local

Este repo hospeda **adapters** que coletam dados de fontes publicas brasileiras
e normalizam para o formato consumido pela engine.

Cada collector e um **workspace npm** em `collectors/<source>/`, com seu proprio
`package.json`, `tsconfig.json` e bundle Lambda. O codigo compartilhado vem do
pacote `@fiscal-digital/engine` (GitHub Packages — ver runbook em
`../fiscal-digital/docs/operations/publish-engine.md`).

### Estrutura

```
collectors/
  <source>/
    src/
    src/__tests__/
    package.json
    tsconfig.json
terraform/
  main.tf
  variables.tf
  backend.tf
  environments/prod.tfvars
  modules/<source>/         # criados por PR a partir do PR 3
.github/workflows/
  plan.yml                  # gate de PR (lint + typecheck + test + tf valida)
  deploy.yml                # apply + update Lambda code em main
sources/
  <source>/README.md        # documentacao do contrato de cada fonte
```

### Como adicionar um collector novo

1. `mkdir -p collectors/<nome>/src/__tests__`
2. Criar `collectors/<nome>/package.json` no padrao do monorepo (ex:
   `fiscal-digital/packages/collector/package.json`). Nome do pacote:
   `@fiscal-digital/collector-<nome>`. Adicionar `@fiscal-digital/engine`
   como dependency (versao `^0.x` — semver, NAO `*`).
3. Criar `collectors/<nome>/tsconfig.json` estendendo `../../tsconfig.json`.
4. Bootstrap minimo de `src/index.ts` + 1 teste em `__tests__/`.
5. Criar `terraform/modules/<nome>/` com `main.tf`, `variables.tf` e
   `outputs.tf` definindo Lambda + EventBridge + DLQ + tabela cache DDB.
6. Wire o modulo em `terraform/main.tf`.
7. Atualizar `deploy.yml` se precisar de logica especifica (o loop generico
   ja cobre o caso comum: `fiscal-digital-collector-<nome>-prod`).

### Convencoes especificas

- **Naming AWS:** `fiscal-digital-collector-<source>-prod` (kebab-case)
- **Idempotencia obrigatoria:** todo collector e seguro para re-execucao
- **Cache antes de fetch:** consultar DynamoDB primeiro, bater na fonte so se cache miss
- **Rate limits:** respeitar limites das APIs externas (60 req/min Querido Diario, etc.)
- **Logs estruturados JSON** com ID de execucao via `@aws-lambda-powertools/logger`
- **Variaveis de ambiente:** usar `requireEnv()` do engine (LRN TEC-ENG-001 — nao usar `process.env.X!`)
- **GSI keys nunca `?? null`:** omitir campo se ausente; null causa `ValidationException` em prod (LRN-20260502-019)

### Stack

- TypeScript strict, Node.js 24.x
- AWS Lambda agendada via EventBridge
- DynamoDB para cache de respostas idempotentes
- SQS para rate limiting
- Terraform com estado remoto (sera configurado no PR 3 quando primeiro collector for migrado)
- Jest 30 + ts-jest para testes
- esbuild para bundle Lambda

### Politica de testes (DoD)

- **Novo collector:** unit test cobrindo happy path + erro de upstream + cache hit
- **Bug fix em prod:** regression test que **falha** antes do fix, **passa** apos
- **PR-gate `plan` verde** e obrigatorio para merge em `main`

### Politica de commits

- Sem `Co-Authored-By: Claude` ou qualquer outra atribuicao a IA generativa
  (LLM como **modelo de producao** — Nova, Haiku — e OK e esta documentado;
  o que e vetado e atribuir ao agente de desenvolvimento)
- Conventional Commits: `feat(<scope>):`, `fix(<scope>):`, `chore(repo):`, etc.
- Sempre commitar TODOS os arquivos relacionados — nunca commit parcial
- Terraform: commitar `.tf` antes de aplicar (CI aplica o que esta no codigo)
- Git identity local: usar email pessoal (`diegovieira.ti@gmail.com`),
  nunca global (que aponta para outro empregador)

### Politica de citacao juridica

O hook em `.claude/hooks/check-legal-citation.js` bloqueia citacoes legais
(`Lei N/AAAA`, `Art. N`, `Sumula`, `STF/STJ/TSE/TCU/CGU/RFB`) sem o marcador
`[legal-verified: <fonte>]` (em body de `gh issue|pr`) ou `<!-- legal-verified -->`
(em markdown publico). Vale para README.md, ROADMAP.md, docs/**/*.md e
mensagens estruturadas.

Replicado bit-perfect do monorepo. **Mudancas na regra: PR no monorepo primeiro,
depois sync.**

### Como consumir `@fiscal-digital/engine`

Pacote privado em GitHub Packages. Runbook completo em
[`../fiscal-digital/docs/operations/publish-engine.md`](../fiscal-digital/docs/operations/publish-engine.md).

Resumo:

- `.npmrc` deste repo aponta o scope `@fiscal-digital` para
  `https://npm.pkg.github.com`
- Local: `gh auth setup-git` (uma vez) + `npm ci`
- CI: workflows ja injetam `NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` e o
  step `setup-node` com `registry-url` e `scope` corretos
- Pin de versao: `@fiscal-digital/engine: ^0.1.0` em cada
  `collectors/<x>/package.json` — **NAO usar `*`** (resolveria para qualquer
  versao publicada)

### Brand pack

Nao usado neste repo (sem UI). Brand pack mestre vive em
`fiscal-digital-web/brand/`. Se precisar de tokens (improvavel para collectors),
seguir o padrao de consumo definido no CLAUDE.md mestre.

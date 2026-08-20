# CATALOG ENGINE — HANDOFF COMPLETO DE DESENVOLVIMENTO

**Snapshot técnico:** 2026-08-20 14:27 BRT  
**Repositório:** `lucasvenancio0110/catalog-engine`  
**Projeto:** CATALOG ENGINE  
**Stack:** Vite + JavaScript ES Modules + Cloudflare Workers + D1 + Workers for Platforms + Cloudflare Queues  
**Node:** >= 22  
**Package:** `0.9.0`

> **REGRA DE CONTINUIDADE:** este arquivo é o handoff técnico canônico para outro chat/software. Antes de qualquer write, merge, deploy ou mutação Cloudflare, revalidar `main`, PRs, Actions e estado real do Cloudflare. Atualizar este arquivo sempre que um slice/milestone relevante for concluído ou uma decisão arquitetural importante mudar.

---

# 0. RESUMO EXECUTIVO

Catalog Engine é uma plataforma SaaS B2B multi-tenant white-label para transformar fontes privadas de catálogo em vitrines profissionais independentes da origem do fornecedor.

Não tratar o produto como “um site que lê Yupoo”. Yupoo é apenas o provider de lançamento.

Arquitetura já comprovada:

- storefront + customer portal;
- Worker principal `catalog-engine`;
- control plane em D1;
- D1 isolado por tenant;
- Workers for Platforms / Dispatch Namespace;
- User Worker por tenant;
- custom hostnames/domínios;
- Provider Engine source-neutral;
- Yupoo adapter inicial;
- sync incremental;
- publicação pública D1 atômica;
- deploy de aplicação separado de publicação de catálogo;
- Design Foundation com Lucide / Motion / Swiper;
- Cloudflare Queues scan/detail;
- DLQs;
- consumers dedicados;
- producers no Worker principal;
- isolamento real multi-tenant;
- retry -> DLQ -> repair -> replay real;
- scheduler automático de tenant import em produção;
- canário scheduler-driven real sem mensagem manual inicial;
- **CEI Normalized Evidence v1**, primeiro slice do M6.

## Milestones

| Milestone | Estado |
|---|---|
| M0 — verdade/documentação | substancialmente concluído |
| M1 — production safety | parcial; dívidas de governança permanecem |
| M2 — app deploy separado de catalog publication | concluído |
| M3 — Design Foundation | concluído |
| M4 — Provider Engine | concluído |
| M5 — automatic tenant Queue import | **CONCLUÍDO / production-proven** |
| M6 — CEI Core + Sports Knowledge Pack v1 | **EM DESENVOLVIMENTO** |
| M6A — CEI Normalized Evidence v1 | **CONCLUÍDO** |
| M6B — explicit runtime evidence + Sports Knowledge Pack boundary | **PRÓXIMO** |

---

# 1. PONTO EXATO DE RETOMADA

`main` no fechamento do M6A:

`ad35af43f5709d340c69cf2f5b32e9408bfb1b1a`

Commit:

`m6: establish versioned source-neutral CEI evidence boundary`

PR:

`#77 — m6: establish versioned source-neutral CEI evidence boundary`

CI do PR #77:

- `Frontend quality` = SUCCESS;
- `Validate SaaS control plane` = SUCCESS;
- `Validate tenant ingestion` = SUCCESS.

## M6A — o que foi criado

Novo arquivo:

`src/catalog-intelligence/core/evidence.js`

Contrato:

`CEI_NORMALIZED_EVIDENCE_VERSION = 1`

O Evidence v1 é estrito, versionado, limitado e source-neutral.

Campos atuais:

```text
schemaVersion
recordId
title
description
sourceCategoryName
categoryPathNames
structuredAttributes
provenance.providerKey
provenance.sourceKey
provenance.sourceLocalId
```

Regras importantes:

- provider-specific fields não entram livremente no cérebro;
- provenance identifica origem, mas não deve alterar semântica da classificação;
- structured attributes são bounded;
- o schema é validado por Zod;
- CEI deve receber evidence normalizado, não objetos Yupoo/Shopify/etc.

`src/domain/catalog-classifier.js` agora possui:

`classifyCatalogEvidence(evidenceValue, overrideValue)`

como entrada canônica do classifier.

`classifyCatalogRecord(...)` foi preservado como compatibility adapter, mas agora ele primeiro cria CEI Evidence e então chama `classifyCatalogEvidence`.

Isso permite migrar o runtime progressivamente sem quebrar comportamento existente.

Novo regression test:

`tests/cei-evidence.test.mjs`

Provas:

1. Evidence v1 é versionado/bounded;
2. campo provider-specific extra é rejeitado;
3. Yupoo vs provider hipotético com o mesmo conteúdo gera a mesma classificação;
4. legacy classifier path e normalized-evidence path geram o mesmo resultado;
5. attribute bag excessivo é rejeitado.

## Próximo slice recomendado — M6B

Objetivo:

**tornar o runtime de classificação explicitamente CEI-aware e extrair o Sports Knowledge Pack do arquivo de normalização monolítico.**

Sequência recomendada:

1. `worker/tenant-classification-runner.js` deve construir explicitamente CEI Evidence por produto, incluindo identidade/provenance privada, e chamar `classifyCatalogEvidence` diretamente;
2. preservar merchant override carregado do D1;
3. criar interface `KnowledgePack` versionada;
4. mover LEAGUES / TEAMS / FACETS / aliases / ambiguity rules para `src/catalog-intelligence/domains/sports/...`;
5. manter comportamento atual por regressão antes de introduzir novas regras;
6. depois evoluir confidence/conflicts/season/year/review thresholds em slices separados.

**Não começar segundo provider, pesquisa universal ou redesign no M6B.**

---

# 2. M5 ESTÁ FECHADO — NÃO REABRIR SEM REGRESSÃO REAL

Final M5 production commit:

`b917b023fde537baa0aa797d1230b7df7db5595e`

PR #75:

`m5: reactivate automatic import after canary Worker identity fix`

Production setting no fechamento:

```json
"TENANT_IMPORT_AUTOMATION_ENABLED": "1"
```

## Deploy final M5

Workflow:

`Deploy Catalog Engine application`

Run:

`32392783507`

Status:

`catalog-engine/application-deploy = success`

Worker version:

`a7923901-3463-44ac-b8f5-c4ba61804b9e`

Evidência:

- cron `*/5 * * * *`;
- automation `1`;
- scan/detail producers presentes;
- scan/detail consumers presentes;
- 65 test files / 298 tests passed;
- 0 npm vulnerabilities;
- default catalog = 17.018 produtos;
- 49.004 proxy routes verificadas;
- supplier leak false;
- private state published false;
- opaque IDs;
- media mode edge-proxy.

## Automatic canary final

Workflow:

`Cloudflare automatic tenant import canary`

Run:

`32392875597`

Job:

`96502874428`

Status:

`catalog-engine/tenant-import-auto-canary = success`

Resultado:

```json
{
  "automaticTenantImportCanaryPassed": true,
  "automationEnabled": true,
  "manualQueueMessagesProduced": false,
  "schedulerDiscovered": true,
  "schedulerJobCreatedAt": "2026-08-20 16:40:40",
  "schedulerAttemptCount": 1,
  "discovered": 1,
  "completed": 1,
  "deferred": 0,
  "published": 1,
  "catalog": {
    "products": 1,
    "media": 2,
    "leaks": 0
  },
  "provisioning": {
    "runStatus": "running",
    "currentStep": "classify",
    "importStepStatus": "success",
    "importAttempts": 1
  },
  "defaultCatalogCountUnchanged": true,
  "queueBacklogsClean": true,
  "sourceScopeExpectedItems": 1
}
```

Interpretação:

```text
fresh isolated tenant
→ zero manual Queue messages
→ cron descobriu tenant sozinho
→ scan
→ details
→ publicação no D1 isolado
→ 1 produto / 2 mídias
→ 0 supplier leaks
→ import step success
→ provisioning avançou para classify
→ default catalog intacto
→ Queues/DLQs limpas
→ SUCCESS
```

M5 Definition of Done satisfeito.

Documento histórico dedicado:

`docs/M5-CLOSURE-2026-08-20.md`

---

# 3. M5 — REGRESSION LESSONS QUE NÃO PODEM SER PERDIDAS

## 3.1 Feature bit reversível

`TENANT_IMPORT_AUTOMATION_ENABLED` é bit operacional `0|1`.

- ON é produção no fechamento M5;
- OFF continua rollback/fail-safe válido;
- producers permanecem obrigatórios nos dois estados.

## 3.2 Race pending -> queued

Queue message pode chegar antes do scheduler terminar a transição do job para `queued`.

Consumer deve retry/busy, não marcar import como falha.

## 3.3 Canário somente pós-deploy

Production canary é acionado via `workflow_run` depois de application deploy SUCCESS.

Não rodar canário em paralelo com deploy.

## 3.4 Canonical tenant Worker identity

Tenant:

`t_<suffix>`

Worker canônico:

`ce-<suffix>`

Não voltar a criar `ce-auto-<suffix>` ou outro naming paralelo para runtime que usa `TENANT_DISPATCH`.

## 3.5 Não mascarar Queue evidence

- não purgar Queue global para fazer smoke passar;
- não produzir manualmente a primeira mensagem no automatic canary;
- preservar error evidence antes de cleanup.

## 3.6 Historical OFF-only smokes

Preflight e alguns smokes históricos OFF-only são provas controladas de fases anteriores. Não enfraquecer esses contratos só porque produção agora está ON.

---

# 4. PRs IMPORTANTES M5

- #65 — activation contracts / stale tests / initial activation
- #66 — scheduler-driven production canary
- #67 — rollback + reversible activation contracts
- #68 — pending/queued race fix + post-deploy canary
- #69 — reactivation pós race fix
- #70 — rollback pós segunda falha
- #71 — read-only retained-canary diagnostic
- #72 — diagnostic traceability
- #73 — canonical Worker identity fix
- #74 — targeted retained-canary cleanup
- #75 — final controlled reactivation
- #76 — M5 closure docs + canonical handoff

Historical runs:

- Queue one/two tenant: `32338235562`
- retry -> DLQ -> repair -> replay: `32338762195`
- OFF preflight: `32339540357`
- retained-canary diagnostic: `32376786224`
- targeted cleanup: `32377942895`

---

# 5. VISÃO DO PRODUTO

Fluxo alvo:

```text
merchant/account
→ tenant/store
→ connect source
→ Provider Engine
→ normalized evidence
→ tenant import
→ CEI
→ classification / verification / merchandising
→ merchant overrides
→ effective public view
→ tenant domain/custom domain
→ recurring sync
```

Modelo essencial:

```text
SOURCE DATA
+
MERCHANT OVERRIDE
=
EFFECTIVE VIEW
```

Fonte privada não pode vazar no storefront público.

Sync/classification rerun não pode destruir merchant overrides.

---

# 6. CLOUDFLARE CONFIRMADO

Runtime principal:

Cloudflare Workers + Static Assets.

Main Worker:

`catalog-engine`

Entrypoint:

`worker/entry-publish.js`

Hosts conhecidos:

- `catalog-engine.lucassantanals0110.workers.dev`
- `catalogoengine.com`
- `app.catalogoengine.com`

Control/default D1:

- binding `CATALOG_DB`
- database `catalog-engine-db`
- ID `12ac414c-4aef-4668-a8f9-dc63d57d449f`

Workers for Platforms:

- binding `TENANT_DISPATCH`
- namespace `catalog-engine-production`

Cron:

`*/5 * * * *`

Queues:

```text
catalog-engine-import-scan
catalog-engine-import-detail
catalog-engine-import-scan-dlq
catalog-engine-import-detail-dlq
```

Main Worker producers:

```text
TENANT_IMPORT_QUEUE -> catalog-engine-import-scan
TENANT_IMPORT_DETAIL_QUEUE -> catalog-engine-import-detail
```

Preferred tenant hot path:

```text
Queue consumer
→ TENANT_DISPATCH
→ Workers for Platforms
→ User Worker ce-<tenant suffix>
→ tenant CATALOG_DB
```

Private D1 command:

`/_catalog/internal/d1-batch`

---

# 7. SECURITY / CI BOUNDARY — NÃO REGREDIR

**PR comum não recebe Cloudflare production secrets.**

Pattern:

```text
PR
→ secret-free validation

trusted main / deliberate privileged dispatch
→ production credentials
→ production mutation/read evidence
```

Dívidas M1 abertas:

- branch protection / required checks;
- direct-push bot governance;
- Actions/toolchain governance;
- production schema parity;
- backup/rollback/recovery runbooks.

---

# 8. APP DEPLOY != CATALOG PUBLICATION

Application deploy:

`.github/workflows/deploy-catalog-api.yml`

Pipeline:

```text
quality
→ build
→ build:verify
→ remote migrations
→ Worker/assets deploy
→ Queue producer/automation verification
→ existing catalog smoke
```

Default catalog publication:

`.github/workflows/publish-default-catalog.yml`

Mudança de CSS/Worker não deve implicar replace dos produtos do catálogo.

---

# 9. PROVIDER ENGINE — M4 COMPLETE

Provider Engine é source-neutral.

Yupoo é adapter inicial.

Contrato conceitual:

```text
validate source
→ discover / scan
→ fetch detail
→ normalize evidence
→ stable identity/fingerprint
→ provider-safe media/leak rules
```

Não implementar segundo provider durante M6 apenas para “provar arquitetura”. O Evidence v1 já possui regression test com provenance hipotético para garantir neutralidade sem criar outro integration surface.

---

# 10. CEI BASELINE ANTES DO M6A

Normative contract:

`docs/CEI.md`

Current classifier files:

- `src/domain/catalog-classifier.js`
- `src/domain/catalog-normalization.js`
- `worker/tenant-classification-runner.js`
- `worker/tenant-data-plane-schema-v3.js`

Current tests:

- `tests/catalog-classifier.test.mjs`
- `tests/catalog-normalization.test.mjs`
- `tests/tenant-classification-runner.test.mjs`
- `tests/cei-evidence.test.mjs` após M6A.

## Current sports intelligence

`catalog-normalization.js` ainda concentra:

- LEAGUES;
- TEAMS;
- FACETS;
- aliases;
- league detection;
- team detection;
- facet detection;
- display normalization;
- coarse classification confidence;
- professional navigation definition.

Classifier:

- key `professional-v1`;
- version `1`;
- status `automatic | needs_review | unknown`;
- global confidence 0..1;
- merchant override support;
- URL/supplier leak guard.

Tenant classification runner:

- discovers tenants no provisioning step `classify`;
- reads isolated tenant D1;
- loads durable merchant override JSON;
- classifies in bounded pages;
- persists team/league/facets/status/confidence;
- persists classifier version/key/override state;
- advances provisioning `classify -> verify`.

Data-plane schema v3 already has:

- `catalog_product_classification_state`;
- `catalog_product_classification_overrides`.

---

# 11. M6 TARGET

M6 — CEI Core + Sports Knowledge Pack v1.

CEI Core launch capabilities:

- normalized evidence schema ✅ M6A;
- context/domain detection;
- Knowledge Pack interface;
- entity/attribute resolution;
- confidence representation;
- semantic conflict representation;
- versioned classification;
- merchant overrides;
- verification;
- merchandising output;
- tenant memory boundary;
- schema-validated persistence.

Sports Knowledge Pack v1:

- competitions/leagues;
- clubs;
- national teams;
- product types;
- audience/version/style facets;
- season/year evidence quando confiável;
- ambiguity rules;
- merchandising hierarchy;
- review thresholds.

M6 DoD:

- CEI recebe normalized evidence, não Yupoo objects;
- supplier folder/category é evidence, não truth;
- merchant overrides sobrevivem reruns;
- low-confidence/conflicting cases viram review/unknown;
- classification + merchandising possuem regression fixtures.

Universal autonomous research **não é requisito M6**.

---

# 12. ROADMAP

```text
M0 truth/governance
→ M1 safety foundations (partial)
→ M2 code/data separation ✅
→ M3 Design Foundation ✅
→ M4 Provider Engine ✅
→ M5 automatic tenant Queue import ✅ production-proven
→ M6 CEI Core + Sports Knowledge Pack v1 ← AGORA
    M6A Normalized Evidence v1 ✅
    M6B Runtime Evidence + Knowledge Pack boundary ← PRÓXIMO
→ M7 Intelligent Sync v2
→ M8 Media hardening
→ M9+ Storefront/Theme/Portal productization
→ beta
→ RC
→ launch
```

---

# 13. DÍVIDAS IMPORTANTES

- branch protection / required checks;
- direct-push bot governance;
- catastrophic sync circuit breaker;
- media redirect/hop/byte/timeout hardening;
- schema parity / backup / rollback runbook;
- Actions supply-chain/toolchain governance;
- browser E2E/a11y/performance;
- SEO/deep links;
- fleet-level observability;
- lifecycle dos workflows diagnósticos temporários M5.

Warning atual:

`actions/checkout@v4` / `actions/setup-node@v4` usam action runtime legado e estão sendo forçados pelo runner para Node 24.

Não misturar toolchain upgrade com feature M6 sem necessidade.

---

# 14. DOCUMENTOS IMPORTANTES

- `CATALOG_ENGINE_HANDOFF_2026-08-20.md`
- `docs/CURRENT-STATE.md`
- `docs/M5-CLOSURE-2026-08-20.md`
- `docs/DEVELOPMENT-ROADMAP.md`
- `docs/CEI.md`
- `docs/PROVIDER-ENGINE.md`
- `docs/TENANT-IMPORT-QUEUES.md`
- `docs/DESIGN-SYSTEM.md`
- `docs/DEPLOYMENT-PIPELINES.md`

---

# 15. CHECKLIST PARA OUTRO SOFTWARE/CHAT

1. Revalidar `main`.
2. Ler este handoff inteiro.
3. Não reabrir M5 sem nova regressão real.
4. Confirmar automation flag se for mexer no import pipeline.
5. M6A está concluído no PR #77 / commit `ad35af43...`.
6. Continuar por M6B.
7. Fazer runtime construir CEI Evidence explicitamente.
8. Extrair Sports Knowledge Pack mantendo comportamento atual por regression tests.
9. Depois evoluir context/conflict/confidence/season/review em slices separados.
10. Não criar segundo provider, universal research ou grande redesign durante esses slices.
11. Preservar merchant overrides.
12. Atualizar este handoff após cada slice relevante.

---

# 16. PROMPT CURTO DE RETOMADA

> Leia `CATALOG_ENGINE_HANDOFF_2026-08-20.md` inteiro e revalide `main`. M5 foi concluído em produção: deploy run `32392783507`, automatic canary run `32392875597`. M6 está em desenvolvimento. M6A — CEI Normalized Evidence v1 — foi concluído no PR #77 / commit `ad35af43f5709d340c69cf2f5b32e9408bfb1b1a`, com Frontend quality, SaaS control plane e tenant ingestion verdes. Continue por M6B: faça o tenant classification runtime construir CEI Evidence explicitamente e extraia um Sports Knowledge Pack versionado do classifier atual, preservando comportamento por regression fixtures. Não inicie segundo provider, universal research ou redesign.
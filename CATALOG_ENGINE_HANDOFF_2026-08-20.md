# CATALOG ENGINE — HANDOFF COMPLETO DE DESENVOLVIMENTO

**Snapshot técnico:** 2026-08-20 ~21:08 BRT  
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
- CEI Normalized Evidence v1;
- runtime de classificação explicitamente CEI-native;
- Sports Knowledge Pack v1 versionado;
- M6C de confidence/conflicts/season já implementado em PR e com todos os gates PR verdes, aguardando gate de produção anterior antes do merge.

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
| M6B — runtime CEI + Sports Knowledge Pack v1 | **MERGEADO / deploy production SUCCESS** |
| M6C — field confidence + semantic conflicts + reliable season | **PR #80 READY / 5 gates verdes / ainda não mergeado neste snapshot** |

---

# 1. PONTO EXATO DE RETOMADA

## `main` atual deste snapshot

`5f8b0e09b118b69087a45bce70f4dcea53f731dd`

Commit:

`m6: make tenant classification CEI-native and extract Sports Knowledge Pack v1`

PR:

`#79 — m6: make tenant classification CEI-native and extract Sports Knowledge Pack v1`

## M6B está mergeado

PR #79 passou antes do merge:

- `Frontend quality` = SUCCESS;
- `Validate tenant ingestion` = SUCCESS;
- `Validate tenant provisioning` = SUCCESS;
- `Validate SaaS control plane` = SUCCESS.

Production deploy após merge:

- workflow: `Deploy Catalog Engine application`;
- run: `32430935803`;
- status context: `catalog-engine/application-deploy = success`;
- job `deploy` = SUCCESS;
- quality = success;
- build + verify = success;
- D1 migrations = success;
- Worker/assets deploy = success;
- Queue producer/automation verification = success;
- existing catalog smoke = success.

### Gate ainda sem status publicado neste snapshot

O workflow `Cloudflare automatic tenant import canary` é acionado por `workflow_run` após deploy SUCCESS e compartilha o concurrency group `catalog-engine-production-d1`.

No momento deste snapshot, o commit `5f8b0e0...` ainda mostrava apenas:

`catalog-engine/application-deploy = success`

O status:

`catalog-engine/tenant-import-auto-canary`

ainda não havia sido publicado.

**Antes de mergear M6C, revalidar esse status.**

Se o canário M6B falhar: NÃO mergear M6C até diagnosticar.  
Se ficar SUCCESS: M6C pode avançar normalmente.

---

# 2. M6A — CEI NORMALIZED EVIDENCE V1 — CONCLUÍDO

PR:

`#77`

Merge commit:

`ad35af43f5709d340c69cf2f5b32e9408bfb1b1a`

Arquivo principal:

`src/catalog-intelligence/core/evidence.js`

Contrato:

`CEI_NORMALIZED_EVIDENCE_VERSION = 1`

Evidence v1 atual:

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

Regras:

- strict Zod schema;
- bounded fields/attributes;
- provider-specific root fields são rejeitados;
- provenance identifica origem mas não determina semântica;
- CEI recebe normalized evidence, não Yupoo objects.

Classifier passou a ter entrada canônica:

`classifyCatalogEvidence(evidenceValue, overrideValue)`

`classifyCatalogRecord(...)` permanece como compatibility adapter.

Regression tests provam que o mesmo conteúdo com provenance Yupoo ou provider hipotético gera a mesma classificação.

---

# 3. M6B — RUNTIME CEI + SPORTS KNOWLEDGE PACK — CONCLUÍDO EM CÓDIGO

PR:

`#79`

Merge commit:

`5f8b0e09b118b69087a45bce70f4dcea53f731dd`

## Runtime CEI boundary

Novo arquivo:

`src/catalog-intelligence/core/runtime-evidence.js`

O `worker/tenant-classification-runner.js` agora:

- carrega `provider` do tenant source;
- carrega source-local album identity;
- constrói CEI Evidence explicitamente;
- chama `classifyCatalogEvidence()` diretamente;
- continua carregando merchant override durável do tenant D1;
- falha fechado quando runtime evidence é inválido.

O runtime não depende mais de `classifyCatalogRecord()` como entrada principal.

## Knowledge Pack contract

Novo arquivo:

`src/catalog-intelligence/core/knowledge-pack.js`

Contrato versionado/fail-closed para:

- pack key;
- domain;
- version;
- competitions;
- entities;
- facets;
- review thresholds.

## Sports Knowledge Pack v1

Novo arquivo:

`src/catalog-intelligence/domains/sports/knowledge-pack.js`

Identity:

```text
key: sports-v1
domain: sports
version: 1
```

Moveu do normalizador monolítico para o pack:

- leagues/competitions;
- clubs;
- national teams;
- aliases;
- product/facet vocabulary;
- audience/version/style facets;
- review thresholds.

`catalog-normalization.js` continua exportando aliases compatíveis para evitar quebra, mas os dados controlados agora pertencem ao Sports Knowledge Pack.

Regression guarantee: extração mudou arquitetura, não comportamento consolidado.

---

# 4. M6C — PR #80 READY, AINDA NÃO MERGEADO NESTE SNAPSHOT

PR:

`#80 — m6: add evidence-aware sports confidence, conflicts and season`

Branch:

`m6c/cei-confidence-conflicts-season-v1`

Head atual:

`cafa89f2d94b9f5a2fe9b77358896f32d2ad810c`

Estado do PR neste snapshot:

- open;
- ready for review;
- mergeable;
- 5 pipelines SUCCESS.

Gates verdes:

- `Frontend quality`;
- `Validate tenant publish checkpoint`;
- `Validate SaaS control plane`;
- `Validate tenant provisioning`;
- `Validate tenant ingestion`.

## Mudança deliberada de versão

M6C altera comportamento de classificação, portanto a identidade foi corretamente avançada para:

```text
CATALOG_CLASSIFIER_VERSION = 2
CATALOG_CLASSIFIER_KEY = professional-v2
```

Não reverter para v1 apenas para manter fixture antiga verde.

O publish checkpoint exige verification da mesma classifier version atual; o fixture foi corrigido para usar `CATALOG_CLASSIFIER_VERSION` e ganhou regressão que prova que verification antiga bloqueia publish.

## Inteligência adicionada no PR #80

Novo arquivo:

`src/catalog-intelligence/domains/sports/resolution.js`

Capacidades:

### Domain hypothesis

Retorna domínio `sports` ou `unknown` com confidence e identity do Knowledge Pack.

### Field-level confidence

Atualmente representa confidence por:

- team;
- league;
- facets;
- season.

### Semantic conflicts

Conflitos explícitos já cobertos:

- `sports_team_conflict`;
- `sports_league_conflict`;
- `sports_season_conflict`;
- `sports_version_conflict`.

Regra central:

**conflito explícito não deve ser escondido por first-match.**

Quando há conflito:

- `reviewRequired = true`;
- `classificationStatus = needs_review`;
- automatic classification confidence é limitado a `<= 0.5`.

### Season extraction

Só cria season quando existe evidência de intervalo de temporada confiável:

- `26/27` -> `2026/27`;
- `2026/27` -> `2026/27`;
- `1999/00` -> `1999/00`.

Não transforma ano isolado em season:

`Retro 1999` -> season `null`.

Structured attribute `season`/`seasonYear`/`season_year` recebe confiança maior.

Se fontes fortes discordam, season fica `null` e surge `sports_season_conflict`.

### Merchant override resolution

Override explícito de team/league/facets:

- continua durável no mecanismo existente;
- remove conflitos do campo que realmente resolveu;
- confidence do campo override vai para `1`;
- não apaga conflitos de campos não resolvidos.

## Regression fixtures M6C

Novo teste:

`tests/cei-sports-resolution.test.mjs`

Cobre:

1. Barcelona clear classification;
2. Sports domain + pack identity;
3. field confidence;
4. `26/27` season;
5. `Retro 1999` não vira season;
6. structured season;
7. Barcelona x Real Madrid -> team conflict;
8. merchant override resolve team conflict;
9. Barcelona + Premier League -> league conflict;
10. 26/27 x 25/26 -> season conflict;
11. Player Version + Fan Version -> version conflict;
12. unknown domain explícito;
13. `99/00` normaliza para 1999/00.

## Falha CI encontrada e corrigida

Primeiro run do Frontend quality mostrou:

- novos CEI tests passavam;
- somente `tenant-publish-runner.test.mjs` falhava.

Causa:

fixture tinha `classifier_version: 1` hardcoded.

Como M6C subiu classifier para v2, publish bloqueou corretamente por stale verification.

Correção:

- fixture usa `CATALOG_CLASSIFIER_VERSION`;
- novo teste confirma que classifier stale bloqueia publish.

Depois da correção, 5/5 workflows ficaram SUCCESS.

---

# 5. PRÓXIMA AÇÃO EXATA

Ordem recomendada:

1. revalidar `main` e PR #80;
2. consultar combined status do commit `5f8b0e09...`;
3. aguardar `catalog-engine/tenant-import-auto-canary = success` do deploy M6B;
4. se SUCCESS, mergear PR #80 com `expected_head_sha=cafa89f2...`;
5. acompanhar application deploy do merge M6C;
6. acompanhar automatic tenant import canary pós-deploy M6C;
7. só então marcar M6C concluído no handoff;
8. iniciar M6D.

## M6D recomendado

Depois do M6C production-green, próximo slice deve focar **schema-validated CEI persistence + verification/merchandising integration**, não pesquisa universal.

Direção recomendada:

- persistir representação detalhada de domain/confidence/conflicts/season de forma versionada;
- preservar current storefront compatibility;
- verification deve considerar unresolved CEI conflicts;
- review feed deve poder identificar `needs_review` e causa;
- merchandising output deve ser derivado do Knowledge Pack + effective classification;
- merchant override continua separado da source inference;
- classificação rerun não pode destruir override;
- avaliar data-plane schema v4 apenas com migration backward-safe.

Não iniciar M7 antes de M6 Definition of Done.

---

# 6. M5 ESTÁ FECHADO — NÃO REABRIR SEM REGRESSÃO REAL

Final M5 production commit:

`b917b023fde537baa0aa797d1230b7df7db5595e`

PR #75:

`m5: reactivate automatic import after canary Worker identity fix`

Production setting no fechamento:

```json
"TENANT_IMPORT_AUTOMATION_ENABLED": "1"
```

Deploy final M5:

- workflow `Deploy Catalog Engine application`;
- run `32392783507`;
- `catalog-engine/application-deploy = success`.

Automatic canary final M5:

- workflow `Cloudflare automatic tenant import canary`;
- run `32392875597`;
- job `96502874428`;
- `catalog-engine/tenant-import-auto-canary = success`.

Resultado central:

```text
fresh isolated tenant
→ zero manual Queue messages
→ cron descobriu tenant sozinho
→ scan
→ detail
→ isolated D1 publish
→ 1 product / 2 media
→ 0 supplier leaks
→ import success
→ provisioning advanced to classify
→ default catalog unchanged
→ Queue/DLQ backlogs clean
→ SUCCESS
```

Documento histórico:

`docs/M5-CLOSURE-2026-08-20.md`

---

# 7. M5 REGRESSION LESSONS — NÃO PERDER

## Feature bit

`TENANT_IMPORT_AUTOMATION_ENABLED` é bit operacional reversível `0|1`.

- ON = production state no fechamento M5;
- OFF = rollback/fail-safe válido;
- producers obrigatórios nos dois estados.

## Queue pending race

Queue message pode chegar antes de job transicionar de pending para queued.

Consumer deve busy/retry, não falhar import.

## Canary sequencing

Automatic canary roda somente depois de application deploy SUCCESS via `workflow_run`.

## Canonical tenant Worker identity

```text
tenant = t_<suffix>
worker = ce-<suffix>
```

Não criar naming paralelo para runtime via TENANT_DISPATCH.

## Não mascarar evidence

- não purge Queue global para passar smoke;
- não produzir manualmente a primeira Queue message no auto canary;
- preservar failure evidence antes de cleanup.

---

# 8. CLOUDFLARE CONFIRMADO

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

- binding `CATALOG_DB`;
- database `catalog-engine-db`;
- ID `12ac414c-4aef-4668-a8f9-dc63d57d449f`.

Workers for Platforms:

- binding `TENANT_DISPATCH`;
- namespace `catalog-engine-production`.

Cron:

`*/5 * * * *`

Queues:

```text
catalog-engine-import-scan
catalog-engine-import-detail
catalog-engine-import-scan-dlq
catalog-engine-import-detail-dlq
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

# 9. SECURITY / CI BOUNDARY — NÃO REGREDIR

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

# 10. APP DEPLOY != CATALOG PUBLICATION

Application deploy:

`.github/workflows/deploy-catalog-api.yml`

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

# 11. PRODUCT / PROVIDER INVARIANTS

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

Provider Engine é source-neutral.

Yupoo é adapter de lançamento, não architecture boundary.

Não implementar segundo provider durante M6 apenas para “provar arquitetura”.

---

# 12. M6 DEFINITION OF DONE

M6 — CEI Core + Sports Knowledge Pack v1.

CEI Core launch capabilities:

- normalized evidence schema ✅;
- context/domain detection ✅ em M6C PR;
- Knowledge Pack interface ✅;
- entity/attribute resolution em evolução;
- field-level confidence ✅ em M6C PR;
- semantic conflict representation ✅ em M6C PR;
- versioned classification ✅;
- merchant overrides ✅;
- verification integration ⏳;
- merchandising output ⏳;
- tenant memory boundary parcial via durable overrides;
- schema-validated detailed CEI persistence ⏳.

Sports Knowledge Pack v1:

- competitions/leagues ✅;
- clubs ✅;
- national teams ✅;
- product types ✅;
- audience/version/style facets ✅;
- season evidence ✅ em M6C PR;
- ambiguity/conflict rules ✅ inicial em M6C PR;
- merchandising hierarchy parcial;
- review thresholds ✅ pack boundary, integração ainda evoluindo.

M6 DoD final exige:

- CEI recebe normalized evidence, não Yupoo objects;
- supplier folder/category é evidence, não public truth;
- merchant overrides sobrevivem reruns;
- low-confidence/conflicting cases viram review/unknown;
- classification + merchandising cobertos por regression fixtures;
- detailed intelligence persistence/verification não pode depender só de memória de processo.

Universal autonomous research **não é requisito M6**.

---

# 13. ROADMAP

```text
M0 truth/governance
→ M1 safety foundations (partial)
→ M2 code/data separation ✅
→ M3 Design Foundation ✅
→ M4 Provider Engine ✅
→ M5 automatic tenant Queue import ✅ production-proven
→ M6 CEI Core + Sports Knowledge Pack v1 ← AGORA
    M6A Normalized Evidence v1 ✅
    M6B Runtime CEI + Sports Knowledge Pack ✅ code/deploy
    M6C Confidence + conflicts + season ← PR #80 ready / production merge pending
    M6D Persistence + verification + merchandising ← NEXT after M6C production-green
→ M7 Intelligent Sync v2
→ M8 Media hardening
→ M9+ Storefront/Theme/Portal productization
→ beta
→ RC
→ launch
```

---

# 14. DÍVIDAS IMPORTANTES

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

`actions/checkout@v4` / `actions/setup-node@v4` usam action runtime legado e o runner informa execução forçada em Node 24.

Não misturar toolchain upgrade com feature M6 sem necessidade.

---

# 15. DOCUMENTOS IMPORTANTES

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

# 16. CHECKLIST PARA OUTRO SOFTWARE/CHAT

1. Revalidar `main` e PR #80.
2. Ler este handoff inteiro.
3. Não reabrir M5 sem regressão real.
4. Confirmar `TENANT_IMPORT_AUTOMATION_ENABLED` se tocar import pipeline.
5. M6A está concluído no PR #77.
6. M6B está mergeado no PR #79 / commit `5f8b0e09...`.
7. Application deploy M6B run `32430935803` ficou SUCCESS.
8. Antes de mergear M6C, confirmar auto canary do M6B.
9. PR #80 head esperado: `cafa89f2d94b9f5a2fe9b77358896f32d2ad810c`.
10. PR #80 possui 5 workflows SUCCESS neste snapshot.
11. Não rebaixar classifier v2 para satisfazer fixture v1.
12. Após M6C production-green, iniciar M6D persistence/verification/merchandising.
13. Não criar segundo provider, universal research ou redesign durante esses slices.
14. Preservar merchant overrides.
15. Atualizar este handoff após cada slice relevante.

---

# 17. PROMPT CURTO DE RETOMADA

> Leia `CATALOG_ENGINE_HANDOFF_2026-08-20.md` inteiro e revalide GitHub/Cloudflare. M5 está concluído em produção. M6A e M6B estão concluídos em código; M6B foi mergeado no commit `5f8b0e09b118b69087a45bce70f4dcea53f731dd` e application deploy run `32430935803` ficou SUCCESS. O automatic canary pós-deploy ainda não havia publicado status no snapshot. M6C está no PR #80, branch `m6c/cei-confidence-conflicts-season-v1`, head `cafa89f2d94b9f5a2fe9b77358896f32d2ad810c`, mergeable e com Frontend quality, tenant publish, SaaS control plane, tenant provisioning e tenant ingestion SUCCESS. Primeiro confirme `catalog-engine/tenant-import-auto-canary` do commit M6B; se SUCCESS, mergeie PR #80 com expected head SHA, acompanhe deploy + canary e então avance para M6D persistence/verification/merchandising. Não iniciar M7 ainda.
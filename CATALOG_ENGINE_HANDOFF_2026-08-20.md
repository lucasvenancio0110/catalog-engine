# CATALOG ENGINE — HANDOFF CANÔNICO DE DESENVOLVIMENTO

**Snapshot técnico:** 2026-08-20 ~21:15 BRT  
**Repositório:** `lucasvenancio0110/catalog-engine`  
**Projeto:** CATALOG ENGINE  
**Stack:** Vite + JavaScript ES Modules + Cloudflare Workers + D1 + Workers for Platforms + Cloudflare Queues  
**Node:** >= 22  
**Package:** `0.9.0`

> **REGRA DE CONTINUIDADE:** este arquivo é a fonte canônica de retomada para outro chat/software. Antes de qualquer write, merge, deploy ou mutação Cloudflare, revalidar `main`, PRs, Actions e estado real do Cloudflare. Atualizar este arquivo sempre que um slice relevante mudar de estado.

---

# 0. RESUMO EXECUTIVO

Catalog Engine é uma plataforma SaaS B2B multi-tenant white-label que transforma fontes privadas de catálogo em vitrines profissionais independentes da origem do fornecedor.

**Não tratar o produto como “um site que lê Yupoo”.** Yupoo é apenas o provider de lançamento.

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
- Cloudflare Queues scan/detail + DLQs;
- consumers dedicados + producers no Worker principal;
- isolamento real multi-tenant;
- retry -> DLQ -> repair -> replay comprovado;
- scheduler automático de tenant import em produção;
- canário scheduler-driven real sem mensagem manual inicial;
- CEI Normalized Evidence v1;
- runtime de classificação explicitamente CEI-native;
- Sports Knowledge Pack v1;
- classifier `professional-v2` com domain confidence, field confidence, semantic conflicts e season evidence.

## Milestones

| Milestone | Estado |
|---|---|
| M0 — truth/documentation | substancialmente concluído |
| M1 — production safety | parcial; dívidas de governança permanecem |
| M2 — app deploy separado de catalog publication | concluído |
| M3 — Design Foundation | concluído |
| M4 — Provider Engine | concluído |
| M5 — automatic tenant Queue import | **CONCLUÍDO / production-proven** |
| M6 — CEI Core + Sports Knowledge Pack v1 | **EM DESENVOLVIMENTO** |
| M6A — CEI Normalized Evidence v1 | **CONCLUÍDO** |
| M6B — runtime CEI + Sports Knowledge Pack v1 | **CONCLUÍDO / production-green** |
| M6C — confidence + conflicts + reliable season | **MERGEADO / deploy SUCCESS / auto-canary pós-deploy ainda aguardando neste snapshot** |
| M6D — persistence + verification + merchandising | **PRÓXIMO, somente após M6C auto-canary SUCCESS** |

---

# 1. PONTO EXATO DE RETOMADA

## `main` atual

`9b14cb2f2f1face251f348f9be8ca20cb4f66b6b`

Commit:

`m6: add evidence-aware sports confidence, conflicts and season`

PR:

`#80 — m6: add evidence-aware sports confidence, conflicts and season`

## M6C antes do merge

Head validado:

`cafa89f2d94b9f5a2fe9b77358896f32d2ad810c`

Gates PR após correção:

- `Frontend quality` = SUCCESS;
- `Validate tenant publish checkpoint` = SUCCESS;
- `Validate SaaS control plane` = SUCCESS;
- `Validate tenant provisioning` = SUCCESS;
- `Validate tenant ingestion` = SUCCESS.

O merge foi feito com expected head SHA travado.

## Production deploy M6C

Commit:

`9b14cb2f2f1face251f348f9be8ca20cb4f66b6b`

Status confirmado:

`catalog-engine/application-deploy = success`

Run:

`32431795992`

**Gate ainda aguardando neste snapshot:**

`catalog-engine/tenant-import-auto-canary`

O auto-canary só publica status ao concluir. Antes de iniciar M6D com writes/schema:

1. consultar combined status do commit `9b14cb2...`;
2. exigir `catalog-engine/tenant-import-auto-canary = success`;
3. se falhar, NÃO iniciar M6D; diagnosticar e preservar evidência;
4. se passar, marcar M6C como production-green e então abrir M6D.

---

# 2. M6B — PRODUCTION-GREEN

PR:

`#79 — m6: make tenant classification CEI-native and extract Sports Knowledge Pack v1`

Merge commit:

`5f8b0e09b118b69087a45bce70f4dcea53f731dd`

## CI PR #79

- Frontend quality = SUCCESS;
- Validate tenant ingestion = SUCCESS;
- Validate tenant provisioning = SUCCESS;
- Validate SaaS control plane = SUCCESS.

## Production evidence

Application deploy:

- run `32430935803`;
- `catalog-engine/application-deploy = success`.

Automatic tenant import canary:

- run `32431006844`;
- `catalog-engine/tenant-import-auto-canary = success`.

Conclusão: tornar a classificação CEI-native e extrair o Sports Pack não regrediu o pipeline automático M5.

## Runtime CEI boundary

Arquivo:

`src/catalog-intelligence/core/runtime-evidence.js`

`worker/tenant-classification-runner.js` agora:

- carrega provider/source identity privada;
- carrega source-local album identity;
- cria CEI Normalized Evidence explicitamente;
- chama `classifyCatalogEvidence()` diretamente;
- aplica merchant override durável do D1 depois da inferência automática;
- falha fechado para evidence inválido.

## Knowledge Pack contract

Arquivo:

`src/catalog-intelligence/core/knowledge-pack.js`

Contrato versionado para:

- key;
- domain;
- version;
- competitions;
- entities;
- facets;
- review thresholds.

## Sports Knowledge Pack v1

Arquivo:

`src/catalog-intelligence/domains/sports/knowledge-pack.js`

Identity:

```text
key: sports-v1
domain: sports
version: 1
```

Contém conhecimento controlado de:

- leagues/competitions;
- clubs;
- national teams;
- aliases;
- product/facet vocabulary;
- audience/version/style;
- review thresholds.

`src/domain/catalog-normalization.js` mantém exports compatíveis, mas não é mais o dono dos dicionários esportivos.

---

# 3. M6A — NORMALIZED EVIDENCE V1

PR:

`#77`

Merge commit:

`ad35af43f5709d340c69cf2f5b32e9408bfb1b1a`

Arquivo:

`src/catalog-intelligence/core/evidence.js`

Contrato:

`CEI_NORMALIZED_EVIDENCE_VERSION = 1`

Campos:

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

Invariantes:

- strict Zod schema;
- campos bounded;
- provider-specific fields não entram soltos no root;
- provenance identifica origem, mas não controla semântica;
- CEI recebe evidence normalizado, não Yupoo/Shopify objects.

Entrada canônica do classifier:

`classifyCatalogEvidence(evidenceValue, overrideValue)`

Compatibility adapter preservado:

`classifyCatalogRecord(...)`

Regression tests provam que provenance Yupoo vs provider hipotético não altera classificação para o mesmo conteúdo.

---

# 4. M6C — O QUE ENTROU NO MAIN

Classifier identity agora é deliberadamente:

```text
CATALOG_CLASSIFIER_VERSION = 2
CATALOG_CLASSIFIER_KEY = professional-v2
```

**Não rebaixar para v1.** A versão mudou porque a semântica mudou.

Novo arquivo:

`src/catalog-intelligence/domains/sports/resolution.js`

## Domain hypothesis

Resultado inclui:

- `domain.id` = `sports` ou `unknown`;
- `domain.confidence`;
- `knowledgePackKey`;
- `knowledgePackVersion`.

## Field-level confidence

Atualmente:

- team;
- league;
- facets;
- season.

Isso é adicional ao global `classificationConfidence` legado.

## Semantic conflicts

Tipos atuais:

- `sports_team_conflict`;
- `sports_league_conflict`;
- `sports_season_conflict`;
- `sports_version_conflict`.

Regra:

```text
contradictory strong evidence
→ do not silently first-match
→ record explicit conflict
→ reviewRequired=true
→ classificationStatus=needs_review
→ automatic classification confidence <= 0.5
```

## Reliable season extraction

Exemplos válidos:

```text
26/27 -> 2026/27
2026/27 -> 2026/27
99/00 -> 1999/00
1999/00 -> 1999/00
```

Ano isolado não vira temporada:

```text
Retro 1999 -> season=null
```

Structured attributes `season`, `seasonYear` e `season_year` recebem evidência mais forte.

Se sinais fortes discordam:

```text
season=null
sports_season_conflict
needs_review
```

## Merchant override

Override explícito:

- continua separado da inferência da fonte;
- persiste pelo mecanismo existente;
- resolve apenas os conflitos de campos que realmente sobrescreve;
- confidence do campo sobrescrito vai para `1`;
- outros conflitos permanecem.

## Regression fixtures

`tests/cei-sports-resolution.test.mjs` cobre:

- classificação clara Barcelona/La Liga;
- domain + pack identity;
- field confidence;
- season 26/27;
- Retro 1999 sem season inventada;
- structured season;
- Barcelona + Real Madrid conflict;
- override resolve team conflict;
- Barcelona + Premier League contradiction;
- season 26/27 vs 25/26 conflict;
- Player Version + Fan Version conflict;
- unknown domain;
- 99/00 histórico.

## Stale classifier verification guard

Primeiro CI M6C revelou um fixture `classifier_version: 1` hardcoded em `tenant-publish-runner.test.mjs`.

O publish runner bloqueou corretamente porque verification v1 não é suficiente para classifier v2.

Correção:

- fixture agora usa `CATALOG_CLASSIFIER_VERSION`;
- teste novo prova explicitamente que stale classifier verification bloqueia publish.

Isso é uma proteção real e deve ser preservada.

---

# 5. M6D — DESENHO JÁ MAPEADO, NÃO IMPLEMENTAR ATÉ CANÁRIO M6C VERDE

Objetivo:

**persistência detalhada do CEI + verification integration + merchandising contract**, mantendo storefront compatível.

## Lacuna confirmada

Schema tenant atual é v3:

`worker/tenant-data-plane-schema-v3.js`

Tabela atual:

`catalog_product_classification_state`

só persiste:

- product_id;
- classifier_version;
- classifier_key;
- override_applied;
- timestamps.

`catalog_products` persiste apenas visão efetiva simplificada:

- team_id;
- league_id;
- classification_status;
- classification_confidence;
- nomes/categoria/search text.

Portanto, hoje **domain, fieldConfidence, season, conflicts e reviewRequired do M6C não sobrevivem de forma detalhada no D1**.

## Verification atual

Arquivo:

`worker/tenant-verification-runner.js`

Hoje verifica:

- catalog non-empty;
- classifier version/key completeness;
- override state consistency;
- public source leak;
- category/media/facet orphans;
- product count consistency.

Ainda não verifica detailed CEI state/conflicts.

## M6D recomendado

Criar data-plane schema v4 backward-safe, provavelmente estendendo a classification state em vez de contaminar `catalog_products` com diagnóstico interno.

Persistir dados como JSON validado/bounded ou colunas mínimas + JSON versionado, por exemplo conceitualmente:

```text
product_id
classifier_version
classifier_key
knowledge_pack_key
knowledge_pack_version
domain_id
domain_confidence
field_confidence_json
season_json
conflicts_json
review_required
override_applied
classified_at
updated_at
```

A estrutura final deve ser definida por testes antes da migration.

Regras:

1. nenhum provenance privado no storefront;
2. conflict JSON bounded e schema-validated;
3. season schema-validated;
4. field confidence 0..1;
5. current public product API continua compatível;
6. merchant override separado da automatic inference;
7. verification deve falhar/segurar publish quando CEI state é inconsistente;
8. **não bloquear todo catálogo apenas porque existem produtos legítimos `needs_review`**, a menos que o product contract defina isso — review precisa ser exceção operacional, não transformar qualquer ambiguidade em outage;
9. merchandising deve consumir effective classification, não supplier folder como truth;
10. migration v4 precisa ser idempotente/backward-safe.

## Public runtime compatibility

`worker/tenant-catalog-runtime.js` atualmente expõe visão pública limpa:

- id;
- name;
- category/categoryId;
- teamId;
- leagueId;
- description;
- media;
- entityType.

Não expor field confidence/conflicts/provenance publicamente por default no M6D. Esses dados pertencem ao operational/review plane.

---

# 6. M5 — CONCLUÍDO EM PRODUÇÃO

Final commit M5:

`b917b023fde537baa0aa797d1230b7df7db5595e`

PR:

`#75`

Application deploy:

- run `32392783507`;
- `catalog-engine/application-deploy = success`.

Automatic scheduler canary:

- run `32392875597`;
- job `96502874428`;
- `catalog-engine/tenant-import-auto-canary = success`.

Provou:

```text
fresh isolated tenant
→ zero manual Queue messages
→ cron discovers tenant
→ scan Queue
→ detail Queue
→ isolated D1 publication
→ 1 product / 2 media
→ zero supplier leaks
→ import step success
→ provisioning advances to classify
→ default catalog unchanged
→ primary Queues/DLQs clean
→ SUCCESS
```

Documento histórico dedicado:

`docs/M5-CLOSURE-2026-08-20.md`

## Regressions que não podem voltar

- `TENANT_IMPORT_AUTOMATION_ENABLED` é reversível `0|1`;
- OFF continua rollback/fail-safe válido;
- Queue message pode chegar antes de job sair de pending: consumer deve retry/busy;
- auto-canary roda somente depois de application deploy SUCCESS;
- tenant Worker canônico: `ce-<tenant suffix>`;
- não usar `ce-auto-*` no hot path;
- não purgar Queue nem produzir mensagem manual para mascarar canário;
- preservar evidence antes de cleanup.

---

# 7. CLOUDFLARE / RUNTIME CONFIRMADO

Main Worker:

`catalog-engine`

Entrypoint:

`worker/entry-publish.js`

Known hosts:

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

Tenant hot path:

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

# 8. SECURITY / CI INVARIANTS

**Ordinary PRs não recebem Cloudflare production secrets.**

Pattern:

```text
PR
→ secret-free validation

trusted main / deliberate privileged workflow
→ Cloudflare production credentials
→ production mutation/read evidence
```

Não executar código arbitrário de PR com production token.

Dívidas M1:

- branch protection / required checks;
- direct-push bot governance;
- Actions/toolchain pinning/governance;
- production schema parity evidence;
- backup/rollback/recovery runbooks.

---

# 9. APP DEPLOY != CATALOG PUBLICATION

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

Mudança de código/CSS não deve substituir automaticamente business catalog data.

---

# 10. PRODUCT / PROVIDER INVARIANTS

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
→ effective view
→ tenant domain/custom domain
→ recurring sync
```

Modelo:

```text
SOURCE DATA
+
MERCHANT OVERRIDE
=
EFFECTIVE VIEW
```

Provider Engine é source-neutral.

Yupoo é provider de lançamento, não architecture boundary.

Não criar segundo provider no M6 apenas para provar abstração.

Universal autonomous research também não é requisito M6.

---

# 11. ROADMAP ATUAL

```text
M0 truth/governance
→ M1 safety foundations (partial)
→ M2 code/data separation ✅
→ M3 Design Foundation ✅
→ M4 Provider Engine ✅
→ M5 automatic tenant Queue import ✅ production-proven
→ M6 CEI Core + Sports Knowledge Pack v1 ← AGORA
    M6A Normalized Evidence v1 ✅
    M6B Runtime CEI + Sports Knowledge Pack ✅ production-green
    M6C Confidence + conflicts + reliable season ✅ merged + deploy green; auto-canary pending
    M6D Persistence + verification + merchandising ← NEXT after auto-canary green
→ M7 Intelligent Sync v2
→ M8 Media hardening
→ M9+ Storefront/Theme/Portal productization
→ beta
→ RC
→ launch
```

M6 Definition of Done ainda não está completo porque detailed persistence + verification/merchandising integration ainda faltam.

---

# 12. DÍVIDAS IMPORTANTES

- branch protection / required checks;
- direct-push bot governance;
- catastrophic sync circuit breaker;
- media redirect/hop/byte/timeout hardening;
- schema parity / backup / rollback runbook;
- Actions supply-chain/toolchain governance;
- browser E2E/a11y/performance;
- SEO/deep links;
- fleet-level observability;
- lifecycle de workflows diagnósticos temporários M5.

Warning observado:

`actions/checkout@v4` / `actions/setup-node@v4` usam action runtime legado e runners reportam execução forçada em Node 24.

Não misturar toolchain upgrade com feature M6 sem necessidade.

---

# 13. DOCUMENTOS IMPORTANTES

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

# 14. CHECKLIST PARA OUTRO SOFTWARE/CHAT

1. Ler este handoff inteiro.
2. Revalidar `main` e Actions.
3. M5 está fechado; não reabrir sem regressão real.
4. M6A concluído PR #77.
5. M6B concluído PR #79 / commit `5f8b0e09...`.
6. M6B deploy run `32430935803` SUCCESS.
7. M6B auto-canary run `32431006844` SUCCESS.
8. M6C mergeado PR #80 / commit `9b14cb2...`.
9. M6C application deploy run `32431795992` SUCCESS.
10. **Primeira ação:** consultar `catalog-engine/tenant-import-auto-canary` do commit `9b14cb2...`.
11. Se M6C auto-canary SUCCESS, marcar M6C production-green e iniciar M6D.
12. Se M6C auto-canary failure, preservar evidence e diagnosticar antes de qualquer M6D write.
13. M6D deve focar schema v4/detailed CEI persistence + verification + merchandising.
14. Não iniciar M7 ainda.
15. Não iniciar segundo provider/universal research/redesign durante M6D.
16. Preservar merchant overrides e source privacy.
17. Atualizar este handoff após cada checkpoint relevante.

---

# 15. PROMPT CURTO DE RETOMADA

> Leia `CATALOG_ENGINE_HANDOFF_2026-08-20.md` inteiro e revalide GitHub/Cloudflare. M5 está production-proven. M6A e M6B estão concluídos; M6B commit `5f8b0e09b118b69087a45bce70f4dcea53f731dd` teve application deploy run `32430935803` SUCCESS e auto-canary run `32431006844` SUCCESS. M6C foi mergeado pelo PR #80 no commit `9b14cb2f2f1face251f348f9be8ca20cb4f66b6b`; application deploy run `32431795992` está SUCCESS, mas o auto-canary pós-deploy ainda aguardava status neste snapshot. Primeiro confirme `catalog-engine/tenant-import-auto-canary` do commit M6C. Se SUCCESS, marque M6C production-green e avance para M6D: schema-validated detailed CEI persistence + verification + merchandising, preservando storefront compatibility, merchant overrides e source privacy. Não iniciar M7 ainda.
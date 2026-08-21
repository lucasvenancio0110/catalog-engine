# CATALOG ENGINE — HANDOFF CANÔNICO DE DESENVOLVIMENTO

**Snapshot técnico:** 2026-08-20 ~21:22 BRT  
**Repositório:** `lucasvenancio0110/catalog-engine`  
**Projeto:** CATALOG ENGINE  
**Stack:** Vite + JavaScript ES Modules + Cloudflare Workers + D1 + Workers for Platforms + Cloudflare Queues  
**Node:** >= 22  
**Package:** `0.9.0`

> **REGRA DE CONTINUIDADE:** este arquivo é a fonte canônica de retomada para outro chat/software. Antes de qualquer write, merge, deploy ou mutação Cloudflare, revalidar `main`, PRs, Actions e estado real do Cloudflare. Atualizar este arquivo sempre que um slice relevante mudar de estado.

---

# 0. ESTADO EXECUTIVO

Catalog Engine é uma plataforma SaaS B2B multi-tenant white-label que transforma fontes privadas de catálogo em vitrines profissionais independentes da origem do fornecedor.

**Yupoo é provider de lançamento, não architecture boundary.**

Arquitetura comprovada inclui:

- storefront + customer portal;
- Worker principal `catalog-engine`;
- control plane D1;
- D1 isolado por tenant;
- Workers for Platforms / Dispatch Namespace;
- User Worker por tenant;
- custom domains;
- Provider Engine source-neutral;
- Yupoo adapter inicial;
- Cloudflare Queues scan/detail + DLQs;
- automatic scheduler-driven tenant import;
- atomic catalog publication;
- source-private/public-safe separation;
- CEI Normalized Evidence v1;
- CEI-native tenant classification runtime;
- Sports Knowledge Pack v1;
- classifier `professional-v2` com domain confidence, field confidence, semantic conflicts e season evidence.

## Milestones

| Milestone | Estado |
|---|---|
| M0 — truth/documentation | substancialmente concluído |
| M1 — production safety | parcial |
| M2 — code/data deployment separation | concluído |
| M3 — Design Foundation | concluído |
| M4 — Provider Engine | concluído |
| M5 — automatic tenant Queue import | **CONCLUÍDO / production-proven** |
| M6 — CEI Core + Sports Knowledge Pack v1 | **EM DESENVOLVIMENTO** |
| M6A — Normalized Evidence v1 | **CONCLUÍDO** |
| M6B — CEI-native runtime + Sports Knowledge Pack | **CONCLUÍDO / production-green** |
| M6C — confidence + conflicts + reliable season | **CONCLUÍDO / production-green** |
| M6D — detailed persistence + verification + merchandising | **PRÓXIMO / LIBERADO** |

---

# 1. PONTO EXATO DE RETOMADA

`main` atual neste snapshot contém um commit documental acima do código M6C.

Current `main` antes deste handoff update:

`74aa7b58a201e0bc6ea9d2e65b6f640a8834dba3`

Último production code commit relevante:

`9b14cb2f2f1face251f348f9be8ca20cb4f66b6b`

Commit:

`m6: add evidence-aware sports confidence, conflicts and season`

PR:

`#80`

## M6C production evidence

Application deploy:

- run `32431795992`;
- `catalog-engine/application-deploy = success`.

Automatic tenant import canary:

- run `32431848821`;
- job `96624897449`;
- `catalog-engine/tenant-import-auto-canary = success`.

Canary steps confirmaram:

- trusted-main checkout;
- quality gate;
- automation enabled;
- Cloudflare credentials validated;
- **scheduler-driven isolated tenant import with zero manual Queue messages = SUCCESS**;
- successful canary evidence published.

Conclusão:

**M6C está production-green. M6D pode iniciar.**

---

# 2. M6A — NORMALIZED EVIDENCE V1

PR `#77`  
Merge `ad35af43f5709d340c69cf2f5b32e9408bfb1b1a`

Arquivo:

`src/catalog-intelligence/core/evidence.js`

Contrato:

`CEI_NORMALIZED_EVIDENCE_VERSION = 1`

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

Invariantes:

- strict Zod schema;
- bounded values;
- provider-specific root fields rejeitados;
- provenance identifica origem, mas não define classificação;
- CEI recebe normalized evidence, não Yupoo objects.

Classifier entry canônico:

`classifyCatalogEvidence(evidenceValue, overrideValue)`

Legacy adapter preservado:

`classifyCatalogRecord(...)`

---

# 3. M6B — RUNTIME CEI + SPORTS KNOWLEDGE PACK

PR `#79`  
Merge `5f8b0e09b118b69087a45bce70f4dcea53f731dd`

CI do PR:

- Frontend quality SUCCESS;
- tenant ingestion SUCCESS;
- tenant provisioning SUCCESS;
- SaaS control plane SUCCESS.

Production:

- application deploy run `32430935803` SUCCESS;
- automatic tenant import canary run `32431006844` SUCCESS.

## Runtime Evidence

`src/catalog-intelligence/core/runtime-evidence.js`

O tenant classifier agora:

```text
tenant source row
→ normalized CEI Evidence
→ classifyCatalogEvidence()
→ merchant override
→ effective classification
```

Merchant override continua durável no tenant D1.

## Knowledge Pack contract

`src/catalog-intelligence/core/knowledge-pack.js`

Versiona:

- key;
- domain;
- version;
- competitions;
- entities;
- facets;
- review thresholds.

## Sports Pack v1

`src/catalog-intelligence/domains/sports/knowledge-pack.js`

```text
key = sports-v1
domain = sports
version = 1
```

Contém:

- leagues/competitions;
- clubs;
- national teams;
- aliases;
- product types;
- audience/version/style facets;
- review thresholds.

---

# 4. M6C — CONFIDENCE / CONFLICTS / SEASON

Classifier identity:

```text
CATALOG_CLASSIFIER_VERSION = 2
CATALOG_CLASSIFIER_KEY = professional-v2
```

**Não rebaixar para v1.**

Arquivo principal:

`src/catalog-intelligence/domains/sports/resolution.js`

## Domain hypothesis

Retorna:

- `sports` ou `unknown`;
- domain confidence;
- Knowledge Pack key/version.

## Field-level confidence

Atualmente:

- team;
- league;
- facets;
- season.

## Semantic conflicts

Códigos atuais:

- `sports_team_conflict`;
- `sports_league_conflict`;
- `sports_season_conflict`;
- `sports_version_conflict`.

Contrato:

```text
strong contradictory evidence
→ explicit conflict
→ reviewRequired=true
→ classificationStatus=needs_review
→ automatic confidence <= 0.5
```

## Season evidence

Aceito quando há intervalo confiável:

```text
26/27 -> 2026/27
2026/27 -> 2026/27
99/00 -> 1999/00
1999/00 -> 1999/00
```

Não inventar season de ano isolado:

`Retro 1999 -> season=null`

Structured season evidence recebe confiança maior.

Strong season disagreement gera conflict e season `null`.

## Merchant overrides

- são separados da source inference;
- resolvem somente conflicts dos campos realmente sobrescritos;
- confidence do campo sobrescrito vai para `1`;
- conflicts não resolvidos permanecem.

## Regression importante

O publish checkpoint exige verification com a classifier version atual.

Uma fixture antiga hardcoded em version `1` falhou quando classifier virou v2. Isso era comportamento correto.

Teste agora prova explicitamente:

`stale classifier verification -> publish blocked`

Preservar essa regra.

---

# 5. M6D — PRÓXIMO SLICE

Objetivo:

**persistir o estado detalhado do CEI, integrar verification e produzir merchandising metadata versionada sem quebrar storefront público.**

## Lacuna atual confirmada

Tenant schema atual:

`worker/tenant-data-plane-schema-v3.js`

`TENANT_DATA_PLANE_SCHEMA_VERSION = 3`

`catalog_product_classification_state` persiste somente:

- product_id;
- classifier_version;
- classifier_key;
- override_applied;
- timestamps.

`catalog_products` guarda apenas effective/public-friendly fields, incluindo:

- team_id;
- league_id;
- classification_status;
- classification_confidence.

Portanto M6C produz em memória, mas ainda não persiste detalhadamente:

- domain;
- fieldConfidence;
- season;
- conflicts;
- reviewRequired;
- Knowledge Pack identity.

## Verification atual

`worker/tenant-verification-runner.js` já verifica:

- catalog non-empty;
- classifier version/key completeness;
- override state consistency;
- source leak;
- category/media/facet integrity;
- counts.

Ainda não verifica detailed CEI state.

## M6D arquitetura recomendada

Criar **tenant data-plane schema v4**, backward-safe e idempotente.

Preferência arquitetural: nova tabela de intelligence state, em vez de poluir `catalog_products` com diagnóstico interno.

Modelo conceitual recomendado:

```text
catalog_product_intelligence_state
  product_id PK
  evidence_schema_version
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
  automatic_state_json (se necessário para preservar source inference)
  effective_state_json (se necessário para separar merchant override)
  classified_at
  updated_at
```

A estrutura final deve ser validada por testes antes de migration/deploy.

### Regras M6D

1. source inference e merchant override continuam separados;
2. provenance privado NÃO entra no storefront;
3. JSON persisted é bounded + schema-validated;
4. confidence sempre 0..1;
5. conflict codes são controlados;
6. season é estruturada e nullable;
7. migration é idempotente;
8. existing storefront API permanece compatível;
9. verification detecta missing/stale/invalid CEI detailed state;
10. `needs_review` legítimo não deve derrubar toda a loja automaticamente;
11. review deve virar informação operacional rastreável;
12. merchandising deriva de Knowledge Pack + effective classification, não de supplier folder como public truth.

## Public runtime

`worker/tenant-catalog-runtime.js` atualmente retorna uma visão pública limpa.

Não expor por default:

- provenance;
- raw conflicts;
- internal confidence breakdown;
- supplier details.

Esses dados pertencem ao operational/review plane.

---

# 6. M5 — AUTOMATIC TENANT IMPORT PRODUCTION-PROVEN

Final M5 code commit:

`b917b023fde537baa0aa797d1230b7df7db5595e`

Application deploy:

- run `32392783507` SUCCESS.

Automatic scheduler canary:

- run `32392875597` SUCCESS;
- job `96502874428`.

Provou:

```text
fresh isolated tenant
→ zero manual Queue messages
→ cron discovers tenant
→ scan
→ detail
→ isolated D1 publish
→ product/media persisted
→ zero source leaks
→ default catalog unchanged
→ Queue/DLQ backlogs clean
→ SUCCESS
```

Histórico dedicado:

`docs/M5-CLOSURE-2026-08-20.md`

Não reabrir M5 sem regressão real.

---

# 7. M5 REGRESSION RULES

- `TENANT_IMPORT_AUTOMATION_ENABLED` é reversível `0|1`;
- OFF é rollback/fail-safe válido;
- pending/queued race deve retry/busy, não fail;
- automatic canary roda pós-deploy;
- tenant Worker canônico = `ce-<tenant suffix>`;
- não criar `ce-auto-*` no hot path;
- não purgar Queue para mascarar smoke;
- não produzir manualmente a primeira mensagem do auto-canary;
- preservar failure evidence antes de cleanup.

---

# 8. CLOUDFLARE CONFIRMADO

Main Worker:

`catalog-engine`

Entrypoint:

`worker/entry-publish.js`

Hosts:

- `catalog-engine.lucassantanals0110.workers.dev`
- `catalogoengine.com`
- `app.catalogoengine.com`

Control/default D1:

- binding `CATALOG_DB`;
- database `catalog-engine-db`;
- ID `12ac414c-4aef-4668-a8f9-dc63d57d449f`.

Workers for Platforms:

- `TENANT_DISPATCH`;
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
→ User Worker ce-<suffix>
→ tenant CATALOG_DB
```

---

# 9. SECURITY / CI INVARIANTS

**Ordinary PRs não recebem production Cloudflare secrets.**

```text
PR
→ secret-free validation

trusted main / deliberate privileged workflow
→ production credentials
→ production evidence/mutation
```

Dívidas M1:

- branch protection / required checks;
- direct-push bot governance;
- Actions/toolchain governance;
- schema parity evidence;
- backup/rollback/recovery runbooks.

---

# 10. CODE DEPLOY != CATALOG PUBLICATION

Application deploy:

`.github/workflows/deploy-catalog-api.yml`

Default catalog publication:

`.github/workflows/publish-default-catalog.yml`

Não acoplar mudança de código/CSS a replace de business catalog data.

---

# 11. PRODUCT INVARIANTS

```text
merchant
→ tenant
→ source connection
→ Provider Engine
→ normalized evidence
→ import
→ CEI inference
→ merchant override
→ effective classification
→ verification / merchandising
→ storefront
→ recurring sync
```

Modelo:

```text
SOURCE INFERENCE
+
MERCHANT OVERRIDE
=
EFFECTIVE VIEW
```

Não iniciar segundo provider, universal research ou redesign durante M6D.

---

# 12. ROADMAP

```text
M0 truth/governance
→ M1 safety foundations (partial)
→ M2 code/data separation ✅
→ M3 Design Foundation ✅
→ M4 Provider Engine ✅
→ M5 automatic tenant import ✅ production-proven
→ M6 CEI Core + Sports Knowledge Pack ← AGORA
    M6A Evidence ✅
    M6B Runtime + Sports Pack ✅ production-green
    M6C Confidence + conflicts + season ✅ production-green
    M6D Persistence + verification + merchandising ← START NOW
→ M7 Intelligent Sync v2
→ M8 Media hardening
→ M9+ Storefront/Theme/Portal productization
→ beta
→ RC
→ launch
```

M6 ainda não deve ser declarado completo antes do M6D/DoD final.

---

# 13. CHECKLIST DE RETOMADA

1. Ler este handoff.
2. Revalidar `main`.
3. M5 está fechado.
4. M6A PR #77 concluído.
5. M6B PR #79 production-green.
6. M6C PR #80 production-green.
7. M6C deploy `32431795992` SUCCESS.
8. M6C auto-canary `32431848821` SUCCESS.
9. Próximo: M6D.
10. Primeiro M6D slice deve ser schema v4 + validated intelligence persistence + verification contract.
11. Preservar public runtime compatibility.
12. Preservar overrides.
13. Não iniciar M7 ainda.
14. Atualizar este handoff ao fechar M6D ou qualquer gate importante.

---

# 14. PROMPT CURTO DE RETOMADA

> Leia `CATALOG_ENGINE_HANDOFF_2026-08-20.md` inteiro. Revalide GitHub/Cloudflare antes de writes. M5 está production-proven. M6A, M6B e M6C estão concluídos; M6C code commit `9b14cb2f2f1face251f348f9be8ca20cb4f66b6b`, application deploy run `32431795992` SUCCESS e scheduler-driven auto-canary run `32431848821` SUCCESS. Continue pelo M6D: criar tenant data-plane schema v4 backward-safe para persistir detailed CEI state (domain, field confidence, Knowledge Pack identity, season, conflicts/review), integrar verification e merchandising sem expor provenance/conflicts internos no storefront público. Preservar SOURCE INFERENCE + MERCHANT OVERRIDE = EFFECTIVE VIEW. Não iniciar M7 ainda.
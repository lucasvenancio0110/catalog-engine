# CATALOG ENGINE — HANDOFF COMPLETO DE DESENVOLVIMENTO

**Snapshot técnico:** 2026-08-20 13:46 BRT  
**Repositório:** `lucasvenancio0110/catalog-engine`  
**Projeto:** CATALOG ENGINE  
**Stack:** Vite + JavaScript ES Modules + Cloudflare Workers + D1 + Workers for Platforms + Cloudflare Queues  
**Node:** >= 22  
**Package:** `0.9.0`

> **REGRA DE CONTINUIDADE:** este arquivo é a fonte canônica de handoff para outro chat/software. Antes de qualquer write, merge, deploy ou mutação Cloudflare, revalidar `main`, PRs, Actions e estado real do Cloudflare. O repositório possui automações que podem avançar `main` depois deste snapshot.

---

# 0. RESUMO EXECUTIVO

O Catalog Engine já possui fundação real de SaaS B2B multi-tenant white-label e não deve mais ser tratado como “um site que lê Yupoo”.

Arquitetura comprovada:

- storefront e customer portal;
- Worker principal `catalog-engine`;
- control plane em D1;
- D1 isolado por tenant;
- Workers for Platforms / Dispatch Namespace;
- User Worker por tenant;
- custom hostnames/domínios;
- Provider Engine source-neutral;
- Yupoo como primeiro provider;
- sync incremental;
- publicação pública D1 atômica;
- deploy de aplicação separado da publicação de catálogo;
- design foundation / Lucide / Motion / Swiper;
- Cloudflare Queues de scan/detail;
- DLQs;
- consumers dedicados;
- producers no Worker principal;
- isolamento real multi-tenant;
- retry -> DLQ -> repair -> replay comprovado em infraestrutura real;
- scheduler automático de tenant import em produção;
- canário scheduler-driven comprovando import automático sem mensagem manual inicial.

## Milestones

| Milestone | Estado |
|---|---|
| M0 — verdade/documentação | substancialmente concluído |
| M1 — production safety | parcial; dívidas de governança permanecem |
| M2 — app deploy separado de catalog publication | concluído |
| M3 — design foundation | concluído |
| M4 — Provider Engine | concluído |
| **M5 — tenant Queue import automático** | **CONCLUÍDO EM PRODUÇÃO** |
| **M6 — CEI Core + Sports Knowledge Pack v1** | **PRÓXIMO / ponto atual de desenvolvimento** |

---

# 1. PONTO EXATO DE RETOMADA

## M5 ESTÁ FECHADO

Não repetir activation/preflight/canary como se o milestone ainda estivesse pendente. O Definition of Done foi provado no Cloudflare real.

`main` no momento da prova:

`b917b023fde537baa0aa797d1230b7df7db5595e`

Commit:

`m5: reactivate automatic import after canary Worker identity fix`

PR:

`#75 — m5: reactivate automatic import after canary Worker identity fix`

`wrangler.jsonc` em produção:

```json
"TENANT_IMPORT_AUTOMATION_ENABLED": "1"
```

## Deploy real que precedeu o canário

Workflow:

`Deploy Catalog Engine application`

Run:

`32392783507`

Status:

`catalog-engine/application-deploy = success`

Worker version:

`a7923901-3463-44ac-b8f5-c4ba61804b9e`

Comprovado no log:

- `TENANT_IMPORT_AUTOMATION_ENABLED="1"`;
- cron `*/5 * * * *`;
- producer de `catalog-engine-import-scan` presente;
- producer de `catalog-engine-import-detail` presente;
- scan consumer presente;
- detail consumer presente;
- 65 test files;
- 298 tests passed;
- 0 npm vulnerabilities;
- default catalog com 17.018 produtos;
- 49.004 proxy routes verificadas;
- `supplierLeak=false`;
- `privateStatePublished=false`;
- opaque public IDs;
- media mode `edge-proxy`.

## Prova final M5

Workflow:

`Cloudflare automatic tenant import canary`

Run:

`32392875597`

Job:

`96502874428`

Status:

`catalog-engine/tenant-import-auto-canary = success`

JSON relevante do run:

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

Interpretação operacional:

```text
fresh isolated tenant
→ nenhuma mensagem de Queue produzida manualmente pelo canário
→ cron encontrou o tenant sozinho
→ scan executou
→ detail executou
→ 1 produto + 2 mídias foram publicados no D1 isolado
→ 0 supplier leaks
→ etapa import do provisioning ficou success
→ provisioning avançou para classify
→ catálogo default permaneceu intacto
→ Queues/DLQs voltaram a backlog zero
→ SUCCESS
```

**Conclusão: M5 Definition of Done satisfeito.**

## Próximo trabalho

Começar **M6 — CEI Core + Sports Knowledge Pack v1**.

Antes de escrever código M6:

1. revalidar `main`;
2. ler `docs/DEVELOPMENT-ROADMAP.md`, `docs/CEI.md` se existir, documentos de classificação/normalização e Provider Engine;
3. mapear o classifier sports existente e todos os testes/fixtures relacionados;
4. separar o que já é CEI foundation do que M6 ainda precisa criar;
5. construir M6 em slices pequenos e testáveis, sem introduzir segundo provider nem pesquisa autônoma universal.

---

# 2. VISÃO DO PRODUTO

Catalog Engine v1 é um SaaS B2B multi-tenant recorrente que transforma uma fonte de catálogo suportada em uma vitrine profissional white-label para o lojista.

Fluxo alvo:

```text
merchant/account
→ tenant/store
→ connect source
→ Provider Engine
→ normalized evidence
→ tenant import
→ CEI classification/merchandising
→ merchant overrides
→ effective public view
→ tenant domain/custom domain
→ recurring sync
```

O produto NÃO deve ser arquitetado como plataforma de um fornecedor específico.

Provider de lançamento: Yupoo.  
Vertical inicial: sports/football.  
Futuro: outros providers sem reescrever ingestion/CEI central.

Modelo essencial:

```text
SOURCE DATA
+
MERCHANT OVERRIDE
=
EFFECTIVE VIEW
```

Fonte privada não pode vazar no storefront público e sync não pode apagar customizações do merchant.

---

# 3. STACK / REPOSITÓRIO

Repo: `lucasvenancio0110/catalog-engine`  
Default branch: `main`  
Framework frontend: Vite + vanilla ES Modules  
Não há React/Vue/Svelte/Angular no app de produção.

Runtime deps deliberadas:

- `cheerio`
- `lucide`
- `motion`
- `p-queue`
- `sharp`
- `swiper`
- `zod`

Dev:

- Vitest
- ESLint
- Vite
- Prettier

Não migrar framework por conveniência de UI sem uma decisão arquitetural explícita.

---

# 4. CLOUDFLARE CONFIRMADO

Runtime principal: Cloudflare Workers + Static Assets.

## Worker principal

`catalog-engine`

Entrypoint:

`worker/entry-publish.js`

## Hosts conhecidos

- `catalog-engine.lucassantanals0110.workers.dev`
- `catalogoengine.com`
- `app.catalogoengine.com`

Admin/customer portal:

`app.catalogoengine.com`

## Control/default D1

Binding: `CATALOG_DB`  
Database: `catalog-engine-db`  
ID: `12ac414c-4aef-4668-a8f9-dc63d57d449f`

## Workers for Platforms

Binding: `TENANT_DISPATCH`  
Namespace: `catalog-engine-production`

## Cron

`*/5 * * * *`

## Queues

```text
catalog-engine-import-scan
catalog-engine-import-detail
catalog-engine-import-scan-dlq
catalog-engine-import-detail-dlq
```

Dedicated consumers:

```text
catalog-engine-import-scan
catalog-engine-import-detail
```

Main Worker producers:

```text
TENANT_IMPORT_QUEUE -> catalog-engine-import-scan
TENANT_IMPORT_DETAIL_QUEUE -> catalog-engine-import-detail
```

Preferred data-plane hot path:

```text
Queue consumer
→ TENANT_DISPATCH
→ Workers for Platforms
→ User Worker `ce-<tenant suffix>`
→ tenant CATALOG_DB
```

Private D1 command path:

`/_catalog/internal/d1-batch`

---

# 5. M5 — PROVAS ANTERIORES AO CANÁRIO FINAL

## Real Queue happy path

Run histórico:

`32338235562`

Provou:

- Queue real;
- D1 isolado;
- User Worker;
- 1 tenant;
- 2 tenants simultâneos;
- cross-tenant isolation;
- products/media publicados.

## Resilience real

Run histórico:

`32338762195`

Provou:

```text
controlled failure
→ real retries
→ DLQ
→ zero mutation before recovery
→ repair
→ replay same message
→ products/media recovered
→ finalize
→ all four Queue/DLQ backlogs zero
```

## Preflight histórico

Run:

`32339540357`

Provou antes da primeira activation:

- 0 undispatched candidates;
- 0 due retry jobs;
- 0 due finalize jobs;
- 0 active imports;
- 0 disposable tenant leftovers;
- 4 backlogs = 0.

**Importante:** preflight/smokes históricos OFF-only continuam sendo provas controladas. Não alterá-los para aceitar ON apenas porque produção agora está ON.

---

# 6. M5 — FALHAS ENCONTRADAS E CORRIGIDAS

Essas decisões são importantes para não repetir bugs.

## 6.1 Tests stale impedindo activation/rollback

Alguns testes tratavam `TENANT_IMPORT_AUTOMATION_ENABLED=0` ou `=1` como invariável permanente.

Contrato correto:

- bit operacional válido: `0|1`;
- producers continuam obrigatórios;
- OFF é um estado de rollback/fail-safe válido;
- estado do bit pertence ao `wrangler.jsonc`, não aos workflows dos consumers.

## 6.2 Race `pending -> queued`

Problema original:

```text
scheduler envia Queue message
→ consumer recebe rápido demais
→ job ainda está pending
→ consumer falhava o import
```

Correção:

- consumer aceita observar `pending`;
- não adquire lease cedo;
- responde busy/retry;
- Queue tenta novamente com delay;
- teste de regressão cobre a chegada antecipada.

## 6.3 Canário concorria com deploy

Correção:

O canário production agora é acionado por `workflow_run` somente depois de:

`Deploy Catalog Engine application = success`

Com automation OFF ele registra skip sem mutar produção. Com ON executa a prova real.

## 6.4 Worker identity mismatch

Segundo canário real falhou em `phase=scan` com `tenant_import_scan_failed`.

Diagnóstico read-only do tenant retido:

`t_b866b2412c5a3404268a`

Run diagnóstico:

`32376786224`

Causa raiz confirmada:

```text
tenant = t_<suffix>
hot path espera Worker = ce-<suffix>
canário criava Worker = ce-auto-<suffix>
TENANT_DISPATCH procurava ce-<suffix>
Worker não existia nesse nome
→ scan falhava antes de descobrir álbum
```

Correção:

- canário passou a criar `ce-<suffix>`;
- regressão compara naming do canário com naming do hot path;
- canário preserva `jobErrorCode` seguro em futuras falhas.

## 6.5 Cleanup do fixture quebrado

Run:

`32377942895`

Resultado:

```json
{
  "retainedCanaryCleanupPassed": true,
  "automationEnabled": false,
  "controlStateRemoved": true,
  "workerRemoved": true,
  "databaseRemoved": true,
  "queueBacklogsCleanBefore": true,
  "queueBacklogsCleanAfter": true
}
```

Nunca houve purge global de Queue nem produção manual de mensagem para mascarar o teste.

---

# 7. PRs IMPORTANTES DO FECHAMENTO M5

- #65 — activation contracts / stale test cleanup / initial activation
- #66 — scheduler-driven production canary
- #67 — rollback pós primeira falha + reversible activation contracts
- #68 — pending/queued race fix + canary pós-deploy
- #69 — controlled reactivation pós race fix
- #70 — rollback pós segunda falha
- #71 — read-only retained-canary diagnostic
- #72 — diagnostic status traceability
- #73 — canonical Worker identity fix
- #74 — targeted cleanup do retained canary
- #75 — controlled final reactivation

M5 fechou no commit:

`b917b023fde537baa0aa797d1230b7df7db5595e`

---

# 8. SECURITY / CI BOUNDARY — NÃO REGREDIR

**Pull request comum NÃO recebe Cloudflare production secrets.**

Pattern obrigatório:

```text
PR
→ secret-free validation

trusted main / deliberate workflow_dispatch
→ Cloudflare credentials
→ production mutation/read evidence
```

Nunca executar código arbitrário de PR não confiável com token Cloudflare de produção.

Dívidas M1 que continuam abertas:

- `main` foi observado sem branch protection/required checks;
- governança de direct-push do bot de sync;
- Actions/toolchain pinning e runtime de Actions;
- backup/rollback/migration parity runbooks.

---

# 9. APP DEPLOY != CATALOG PUBLICATION

Aplicação:

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

Publicação default:

`.github/workflows/publish-default-catalog.yml`

Sync/import de dados não deve ser acoplado a mudança de CSS/Worker.

---

# 10. PROVIDER ENGINE

M4 concluído.

Central ingestion é source-neutral. Yupoo é adapter inicial, não arquitetura.

Contrato conceitual:

```text
validate source
→ discover/scan
→ fetch detail
→ normalize evidence
→ stable IDs/fingerprints
→ provider-safe media/leak rules
```

**Não implementar segundo provider durante M6.** Primeiro consolidar CEI Core + Sports Knowledge Pack v1 sobre normalized evidence já existente.

---

# 11. CEI — BASELINE E PRÓXIMO MILESTONE

O repo já contém classifier sports-oriented e infraestrutura de classification state/override. Isso é fundação, não o CEI final.

## M6 — CEI Core + Sports Knowledge Pack v1

Objetivo:

evoluir o classifier atual para um intelligence core source-neutral, determinístico e auditável.

CEI Core de lançamento deve cobrir:

- normalized evidence schema;
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
- season/year somente com evidência confiável;
- ambiguity rules;
- merchandising hierarchy;
- review thresholds.

M6 Definition of Done:

- CEI consome normalized evidence, não objetos Yupoo;
- folder/category do fornecedor é evidência, não verdade pública;
- merchant overrides sobrevivem reruns;
- baixa confiança/conflitos aparecem para review em vez de serem inventados;
- classification + merchandising cobertos por regression fixtures.

Não transformar M6 em “IA universal que pesquisa qualquer produto na internet”. Isso fica fora do launch scope até Sports v1 determinístico ser mensurável.

---

# 12. FRONTEND / UX

Direção vigente:

- storefront premium editorial e-commerce, não dashboard;
- mobile first;
- Lucide para iconografia;
- Motion para microinterações úteis;
- Swiper para mídia;
- API-backed search;
- shared responsive/accessibility foundation;
- customer portal separado visualmente do storefront.

Full redesign permanece para milestones posteriores (Storefront UX 2.0 / Portal UX 2.0).

---

# 13. ROADMAP APÓS M5

Ponto atual:

```text
M0 truth/governance
→ M1 safety foundations (parcial)
→ M2 code/data separation ✅
→ M3 Design Foundation ✅
→ M4 Provider Engine ✅
→ M5 automatic tenant Queue import ✅ PRODUCTION-PROVEN
→ M6 CEI Core + Sports Knowledge Pack v1 ← AGORA
→ M7 Intelligent Sync v2
→ M8 Media Engine hardening
→ M9+ Storefront/Theme/Portal/commercial productization
→ beta
→ release candidate
→ launch
```

---

# 14. DÍVIDAS IMPORTANTES

- branch protection / required checks;
- direct-push bot governance;
- catastrophic sync statistical circuit breaker;
- media redirect/hop/byte/timeout hardening;
- production schema parity / backup / rollback runbook;
- Actions supply-chain/toolchain governance;
- browser E2E/a11y/performance;
- SEO/deep links;
- fleet-level observability;
- decidir lifecycle de workflows diagnósticos temporários de M5, sem apagar evidência antes de documentá-la.

Warning atual de Actions:

`actions/checkout@v4` e `actions/setup-node@v4` estão sendo forçados pelo runner para Node 24 devido à depreciação do runtime Node 20 da action.

Wrangler deliberadamente usado no deploy M5:

`4.123.0`

Não misturar upgrades de toolchain com uma feature M6 sem necessidade.

---

# 15. DOCUMENTOS A LER ANTES DE GRANDES MUDANÇAS

- `CATALOG_ENGINE_HANDOFF_2026-08-20.md`
- `docs/CURRENT-STATE.md`
- `docs/DEVELOPMENT-ROADMAP.md`
- `docs/DESIGN-SYSTEM.md`
- `docs/DESIGN-AUDIT.md`
- `docs/DOCUMENT-MAP.md`
- `docs/DEPLOYMENT-PIPELINES.md`
- `docs/PROVIDER-ENGINE.md`
- `docs/TENANT-IMPORT-QUEUES.md`
- documentos CEI/classifier/normalization existentes no repo.

Quando implementação muda contrato, atualizar docs no mesmo ciclo.

---

# 16. CHECKLIST PARA OUTRO SOFTWARE/CHAT

1. Revalidar `main`; o SHA deste arquivo pode ter ficado antigo.
2. Confirmar que `TENANT_IMPORT_AUTOMATION_ENABLED` permanece `1`, salvo rollback deliberado posterior.
3. Não reabrir M5 sem nova evidência de regressão; M5 já possui run final SUCCESS `32392875597`.
4. Confirmar Queue topology antes de qualquer mudança no import pipeline.
5. Iniciar pelo **M6**, não por M7, redesign ou segundo provider.
6. Fazer inventário do CEI atual antes de escrever arquitetura nova.
7. Preservar normalized provider evidence como boundary de entrada do CEI.
8. Preservar merchant overrides e isolamento por tenant.
9. Implementar M6 em PRs pequenos com regression fixtures e quality gates.
10. Atualizar este handoff a cada milestone/gate/decisão arquitetural relevante.

---

# 17. PROMPT CURTO DE RETOMADA

> Leia `CATALOG_ENGINE_HANDOFF_2026-08-20.md` inteiro. Ele é o handoff técnico canônico do Catalog Engine. Revalide GitHub/Cloudflare antes de qualquer write. M5 foi concluído em produção no commit `b917b023fde537baa0aa797d1230b7df7db5595e`; deploy run `32392783507` e automatic scheduler canary run `32392875597` ficaram SUCCESS. Não refaça M5 sem evidência de regressão. Continue pelo M6 — CEI Core + Sports Knowledge Pack v1 — primeiro mapeando classifier/evidence/overrides/tests existentes e implementando o milestone em slices pequenos e testáveis.
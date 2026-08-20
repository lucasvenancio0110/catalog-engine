# CATALOG ENGINE — HANDOFF COMPLETO DE DESENVOLVIMENTO

**Snapshot técnico:** 2026-08-20 13:35 BRT  
**Repositório:** `lucasvenancio0110/catalog-engine`  
**Projeto:** CATALOG ENGINE  
**Stack:** Vite + JavaScript ES Modules + Cloudflare Workers + D1 + Workers for Platforms + Cloudflare Queues  
**Node:** >= 22  
**Package:** `0.9.0`

> **REGRA DE CONTINUIDADE:** este arquivo é a fonte de handoff para outro chat/software. Antes de qualquer write/merge/deploy/mutação Cloudflare, revalidar `main`, PRs, Actions e estado real do Cloudflare. O repositório possui sync automático que pode avançar `main`.

---

# 0. RESUMO EXECUTIVO

O Catalog Engine deixou de ser apenas um catálogo Yupoo e já possui fundação real de SaaS B2B multi-tenant white-label. A arquitetura comprovada inclui:

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
- Cloudflare Queues scan/detail;
- DLQs;
- consumers dedicados;
- producers no Worker principal;
- isolamento real multi-tenant;
- testes reais de retry -> DLQ -> repair -> replay;
- scheduler automático de tenant import com feature flag.

## Milestones

| Milestone | Estado no snapshot |
|---|---|
| M0 — verdade/documentação | substancialmente concluído |
| M1 — production safety | parcial |
| M2 — app deploy separado de catalog publication | concluído |
| M3 — design foundation | concluído |
| M4 — Provider Engine | concluído |
| M5 — tenant Queue import automático | **gate final em execução** |
| M6 — CEI Core + Sports Knowledge Pack v1 | próximo somente depois do M5 |

---

# 1. PONTO EXATO DE RETOMADA

**NÃO iniciar M6 até fechar formalmente o M5.**

`main` atual deste snapshot:

`b917b023fde537baa0aa797d1230b7df7db5595e`

Esse SHA é o squash merge do PR #75:

`m5: reactivate automatic import after canary Worker identity fix`

## Estado Git atual

`wrangler.jsonc` em `main`:

```json
"TENANT_IMPORT_AUTOMATION_ENABLED": "1"
```

Deploy trusted-main já concluiu com SUCCESS:

- workflow: `Deploy Catalog Engine application`
- run: `32392783507`
- status context: `catalog-engine/application-deploy = success`
- Worker version: `a7923901-3463-44ac-b8f5-c4ba61804b9e`
- cron: `*/5 * * * *`
- `TENANT_IMPORT_AUTOMATION_ENABLED="1"`
- producer `catalog-engine-import-scan`: presente
- producer `catalog-engine-import-detail`: presente
- scan consumer: `catalog-engine-import-scan`
- detail consumer: `catalog-engine-import-detail`

Quality no deploy:

- 65 test files
- 298 tests
- 0 vulnerabilities

Build verification no deploy:

- products: 17,018
- checked proxy routes: 49,004
- supplier leak: false
- private state published: false
- opaque IDs: true
- media mode: edge-proxy

## O único gate que falta neste snapshot

Aguardar o workflow pós-deploy:

`Cloudflare automatic tenant import canary`

Status esperado no mesmo commit `b917b02...`:

`catalog-engine/tenant-import-auto-canary = success`

Critério de fechamento M5:

```text
fresh isolated canary tenant
→ zero manual Queue messages
→ cron discovers tenant itself
→ scan Queue
→ detail Queue
→ finalize
→ tenant D1 gets catalog
→ provisioning advances
→ default catalog remains unchanged
→ primary Queues and DLQs return to zero
→ SUCCESS
```

Se o canário falhar: NÃO declarar M5 completo. Fazer rollback `1 -> 0`, preservar evidência e diagnosticar antes de novo teste.

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
Futuro: outros providers sem reescrever central ingestion/CEI.

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

# 3. STACK / REPO

Repo: `lucasvenancio0110/catalog-engine`  
Default branch: `main`  
Visibilidade observada: public  
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

Versões deliberadamente pinadas no ciclo auditado incluem Lucide, Motion, Swiper e Vite. Não migrar framework por conveniência de UI.

---

# 4. CLOUDFLARE CONFIRMADO

Runtime principal: Cloudflare Workers + Static Assets, não Pages como runtime primário.

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

Scan consumer:

`catalog-engine-import-scan`

Detail consumer:

`catalog-engine-import-detail`

Main Worker producers:

```text
TENANT_IMPORT_QUEUE -> catalog-engine-import-scan
TENANT_IMPORT_DETAIL_QUEUE -> catalog-engine-import-detail
```

---

# 5. M5 — O QUE JÁ FOI PROVADO

## Real Queue happy path

Run histórico: `32338235562`

Provou:

- Queue real;
- D1 isolado;
- User Worker;
- 1 tenant;
- 2 tenants simultâneos;
- cross-tenant isolation;
- products/media publicados.

## Resilience real

Run histórico: `32338762195`

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

## Preflight real

Run histórico: `32339540357`

Provou antes da primeira ativação:

- 0 undispatched candidates;
- 0 due retry jobs;
- 0 due finalize jobs;
- 0 active imports;
- 0 disposable tenant leftovers;
- 4 backlogs = 0.

Preflight é deliberadamente OFF-only e não deve ser convertido em monitor pós-activation apenas para fazer CI passar.

---

# 6. M5 — FALHAS ENCONTRADAS E CORRIGIDAS

## 6.1 Stale activation tests

Ao ativar `0 -> 1`, testes antigos ainda tratavam OFF como estado permanente. Isso quebrava inclusive a capacidade de rollback.

Correção:

- automation bit validado como `0|1`;
- producers permanecem obrigatórios;
- workflows de consumers não são donos do estado do bit;
- OFF continua estado operacional fail-safe válido.

## 6.2 Scheduler / Queue race

Fluxo original podia fazer:

```text
queue.send()
→ consumer recebe muito rápido
→ control job ainda está pending
→ consumer interpretava como falha
```

Correção mergeada:

- `pending` pode ser carregado pelo consumer;
- lease não é adquirido cedo;
- consumer responde como busy/retry;
- Queue tenta novamente com delay, em vez de falhar o import.

Existe teste de regressão simulando mensagem chegando enquanto job ainda está `pending`.

## 6.3 Canary concorrendo com deploy

Canário antigo podia rodar junto do deploy.

Correção:

`workflow_run` do canário executa somente depois de `Deploy Catalog Engine application = success` em `main`.

Com automation OFF ele termina verde registrando skip; com ON roda a prova real.

## 6.4 Root cause do segundo canário

Diagnóstico read-only do tenant retido `t_b866b2412c5a3404268a` mostrou:

```text
status: failed
phase: scan
attempt_count: 1
discovered_count: 0
last_error_code: tenant_import_scan_failed
```

Data plane estava ativo e 4 Queue/DLQ backlogs estavam zerados quando diagnosticado.

Causa raiz confirmada:

- tenant: `t_<suffix>`
- hot path de tenant dispatch resolve Worker canônico como `ce-<suffix>`
- canário criava Worker como `ce-auto-<suffix>`
- scan via `TENANT_DISPATCH` procurava `ce-<suffix>` e não encontrava o Worker criado
- erro de data plane era colapsado para `tenant_import_scan_failed`

Correção:

- canário agora cria Worker `ce-<suffix>`;
- teste compara explicitamente identidade do canário com o resolver real do hot path;
- output de falha preserva `jobErrorCode` seguro quando disponível.

## 6.5 Cleanup do fixture antigo

Antes da terceira reativação, o fixture quebrado antigo foi removido via operação targeted e fail-closed.

Run cleanup: `32377942895`

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

Não houve purge global de Queue nem envio manual de mensagens.

---

# 7. PRs IMPORTANTES DESTE CICLO M5 FINAL

- #65 — activation contracts / stale test cleanup / initial activation
- #66 — scheduler-driven production canary
- #67 — rollback after first canary failure + reversible activation contracts
- #68 — pending/queued race fix + post-deploy canary sequencing
- #69 — controlled reactivation after race fix
- #70 — rollback after second canary failure
- #71 — read-only retained-canary diagnostic
- #72 — diagnostic status traceability
- #73 — fix automatic canary Worker identity to canonical tenant dispatch naming
- #74 — targeted cleanup of retained failed canary
- #75 — third controlled reactivation after confirmed root-cause fix

Current `main` for this snapshot is the merge of #75:

`b917b023fde537baa0aa797d1230b7df7db5595e`

---

# 8. SECURITY / CI BOUNDARY

Preservar esta regra:

**Pull request comum NÃO recebe Cloudflare production secrets.**

Pattern obrigatório para workflows privilegiados:

```text
PR
→ secret-free validation

trusted main / deliberate workflow_dispatch
→ Cloudflare credentials
→ production mutation/read evidence
```

Nunca executar código arbitrário vindo de PR não confiável com token Cloudflare de produção.

`main` foi observado sem branch protection/required checks no snapshot original. Isso permanece dívida M1 até ser configurado e comprovado.

Há direct-push automático do bot de sync no `main`; governança disso também é dívida M1.

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

Publicação default deliberada:

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

Não implementar segundo provider antes de fechar M5 e avançar roadmap deliberadamente.

---

# 11. DATA PLANE MULTI-TENANT

Preferred hot path:

```text
Queue consumer
→ TENANT_DISPATCH
→ Workers for Platforms
→ tenant User Worker `ce-<tenant suffix>`
→ tenant CATALOG_DB
```

Comando privado equivalente:

`/_catalog/internal/d1-batch`

Esse contrato valida tenant e restringe batch/SQL. Não deve virar endpoint público de storefront.

---

# 12. FRONTEND / UX

Direção já definida:

- storefront: premium editorial e-commerce, não dashboard;
- mobile first;
- Lucide para ícones;
- Motion para microinterações com propósito;
- Swiper para mídia;
- API-backed search;
- shared responsive/accessibility foundation;
- customer portal operacional separado visualmente do storefront.

Full redesign está previsto em milestones posteriores, principalmente M9/M11.

---

# 13. ROADMAP IMEDIATO

## M5 — fechar primeiro

DoD:

```text
create tenant
→ connect Yupoo/source
→ isolated tenant import completes automatically
```

sem intervenção GitHub/Cloudflare por cliente.

Neste snapshot falta apenas o SUCCESS do canário pós-deploy do commit `b917b02...`.

## M6 — CEI Core + Sports Knowledge Pack v1

Só iniciar depois do M5 fechado.

CEI Core deve incluir:

- normalized evidence;
- context detection;
- Knowledge Pack interface;
- entity/attribute resolution;
- confidence/conflicts;
- versioned classification;
- merchant overrides;
- verification;
- merchandising;
- tenant memory;
- schema-validated persistence.

Sports v1:

- leagues/competitions;
- clubs;
- national teams;
- product types;
- audience/version/style;
- season/year quando confiável;
- ambiguity rules;
- merchandising hierarchy;
- review thresholds.

Depois: M7 Intelligent Sync v2, M8 Media hardening, M9 Storefront UX 2.0, M10 Theme Engine, M11 Portal UX 2.0 etc.

---

# 14. DÍVIDAS IMPORTANTES

- branch protection / required checks;
- direct-push bot governance;
- catastrophic sync statistical circuit breaker;
- media redirect/hop/byte/timeout hardening;
- production schema parity/backup/rollback runbook;
- Actions supply-chain/toolchain governance;
- browser E2E/a11y;
- SEO/deep links;
- fleet-level observability;
- limpar/retirar workflows diagnósticos temporários quando não forem mais necessários, sem apagar evidência útil prematuramente.

Warnings de Actions atuais: `actions/checkout@v4` e `actions/setup-node@v4` ainda têm runtime Node legado sendo forçado para Node 24 pelo runner. Não misturar upgrade de toolchain com o gate final M5.

Wrangler deliberadamente usado no deploy: `4.123.0`.

---

# 15. DOCUMENTOS QUE DEVEM SER LIDOS ANTES DE GRANDES MUDANÇAS

- `CATALOG_ENGINE_HANDOFF_2026-08-20.md`
- `docs/CURRENT-STATE.md`
- `docs/DEVELOPMENT-ROADMAP.md`
- `docs/DESIGN-SYSTEM.md`
- `docs/DESIGN-AUDIT.md`
- `docs/DOCUMENT-MAP.md`
- `docs/DEPLOYMENT-PIPELINES.md`
- `docs/PROVIDER-ENGINE.md`
- `docs/TENANT-IMPORT-QUEUES.md`

Quando implementação muda contrato, atualizar docs no mesmo ciclo.

---

# 16. CHECKLIST PARA O PRÓXIMO SOFTWARE/CHAT

1. Revalidar `main` — não confiar cegamente neste SHA.
2. Verificar status do commit `b917b023fde537baa0aa797d1230b7df7db5595e`.
3. Confirmar `catalog-engine/application-deploy = success` — já estava verde neste snapshot.
4. Procurar `catalog-engine/tenant-import-auto-canary` no mesmo SHA.
5. Se SUCCESS: abrir logs e registrar JSON final; atualizar `CURRENT-STATE.md`, roadmap e este handoff; marcar M5 concluído; então começar M6.
6. Se FAILURE: imediatamente rollback `TENANT_IMPORT_AUTOMATION_ENABLED 1 -> 0`; não purgar filas globais; preservar fixture se houver evidência; diagnosticar `jobErrorCode`, import row, tenant D1 e Queue/DLQ state.
7. Não iniciar segundo provider nem redesign grande enquanto o milestone atual estiver aberto.

---

# 17. PROMPT CURTO DE RETOMADA

Use:

> Leia `CATALOG_ENGINE_HANDOFF_2026-08-20.md` inteiro. Ele é o handoff técnico canônico do Catalog Engine. Revalide GitHub/Cloudflare antes de qualquer write. Continue do “PONTO EXATO DE RETOMADA”. Não reinicie auditoria do zero. Se o M5 final canary do commit `b917b023fde537baa0aa797d1230b7df7db5595e` já tiver concluído, valide logs e atualize docs antes de iniciar M6. Se falhou, rollback OFF e diagnostique sem mascarar evidência.

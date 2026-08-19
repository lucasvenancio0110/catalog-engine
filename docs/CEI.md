# Catalog Engine Intelligence — CEI

Status: **Normative product/architecture contract**  
Scope: catalog understanding, learning, classification, research, confidence and merchandising  
Non-goal: define payment, tenant provisioning or customer-portal UX.

## Definition

**Catalog Engine Intelligence (CEI)** is Catalog Engine's proprietary intelligence layer for understanding, learning, organizing and validating commercial catalogs independently of their source or retail vertical.

CEI is not a chatbot and must not require a paid generative-AI API to perform its normal job.

Its mission is:

> Receive raw catalog evidence, determine what the products mean, learn unknown domains safely, create a useful merchandising model, classify with measurable confidence and retain reusable knowledge.

## Core invariants

1. CEI must function without OpenAI, Anthropic, Gemini or another token-billed external LLM.
2. Optional model inference may improve difficult cases, but the product may not depend on it for normal operation.
3. Supplier/source taxonomy is evidence, not public truth.
4. CEI must know when evidence is insufficient and prefer `unknown`/`review` over a confident wrong answer.
5. Confidence is field-level where practical, not one misleading global score.
6. Critical claims such as compatibility, safety, medical application or fitment require stronger evidence than ordinary merchandising classification.
7. Tenant-specific corrections/memory remain isolated to that tenant unless explicitly transformed into safe global knowledge through a separate governed process.
8. The normal operating mode is automatic. Human intervention is exception handling, not the primary classification workflow.
9. New knowledge must record provenance/evidence, confidence and version/freshness metadata where the knowledge can affect future classifications.
10. CEI must be source-agnostic after normalization.

## Source-neutral contract

CEI does not classify "a Yupoo product" or "a Shopify product". Source adapters convert different inputs into a normalized evidence record first.

Supported/future source adapters may include:

- Yupoo;
- Shopify;
- WooCommerce;
- CSV;
- Excel;
- PDF;
- JSON/XML;
- APIs;
- ordinary web catalogs;
- future ERP/PIM/catalog providers.

A normalized product can contain evidence such as:

- source-local stable identity;
- title;
- description;
- source category/path;
- structured attributes;
- SKU/code;
- brand/manufacturer clues;
- images/media references;
- variant relationships;
- neighboring/sibling product context;
- source metadata that is safe for private processing.

After this boundary, CEI should not require provider-specific logic to understand the product.

## Intelligence pipeline

The intended pipeline is:

`observe -> normalize -> detect context/domain -> measure knowledge coverage -> resolve known entities/attributes -> detect uncertainty/conflict -> research unknowns when needed -> validate evidence -> learn -> classify -> verify -> merchandise -> remember`

Each stage should be independently testable.

## 1. Normalization

Normalize noisy supplier text before semantic decisions:

- case/spacing/punctuation;
- Unicode and diacritics without losing useful distinctions;
- common separators and year formats;
- units;
- sizes;
- colors;
- repeated boilerplate;
- common provider naming noise;
- safe tokenization;
- language-independent identifiers where possible.

Normalization does not decide meaning. It makes later evidence comparable.

## 2. Context and domain detection

CEI must infer meaning from context, not a one-word dictionary.

Example:

`camisa` can mean clothing or a cylinder liner. Therefore classification uses surrounding evidence such as `Flamengo`, `25/26`, `pistão`, `cilindro`, source section, neighboring products and other signals.

CEI should maintain hypotheses such as:

- sports;
- fashion;
- automotive;
- dental;
- electronics;
- other known domains;
- unknown/mixed domain.

A catalog can contain more than one domain.

## 3. Knowledge coverage

Before expensive work, CEI measures how much of the incoming catalog it can already explain.

Useful measures include:

- percentage of products with recognized domain;
- percentage of significant tokens/entities recognized;
- attribute coverage;
- ambiguity rate;
- contradiction rate;
- novelty rate;
- age/freshness of reused knowledge.

CEI therefore distinguishes:

- `VERIFIED` — strongly supported knowledge;
- `KNOWN` — sufficiently supported for normal classification;
- `UNCERTAIN` — plausible but below the automatic-decision threshold;
- `UNKNOWN` — no sufficient knowledge;
- `CONFLICT` — meaningful evidence disagrees;
- `STALE` — formerly known, but freshness/conditions require revalidation.

## 4. Knowledge Packs

Reusable domain knowledge is stored in focused Knowledge Packs, for example:

- generic retail;
- sports;
- fashion;
- automotive;
- dental;
- future discovered domains.

A pack may define:

- concepts/entities;
- aliases and abbreviations;
- hierarchy/ontology;
- attributes;
- units/formats;
- domain signatures;
- extraction patterns;
- relationship constraints;
- evidence requirements;
- merchandising facets;
- known ambiguity rules.

Knowledge Packs are structured data and executable rules, not giant prompt files.

## 5. Global, supplier and tenant memory

CEI has separate memory scopes.

### Global Knowledge

Reusable public/general concepts such as a football club, common product type, vehicle model family or standard dental component concept.

Global knowledge must be supported by evidence and may not contain one tenant's private supplier data.

### Supplier Memory

Patterns about how a source/provider or supplier commonly structures/names products. This layer must be privacy-safe and cannot expose another tenant's private source relationship.

### Tenant Memory

Corrections and conventions specific to one store, such as:

- what an ambiguous abbreviation means for that tenant;
- a merchant classification override;
- a supplier-specific naming convention learned inside that tenant;
- a manually confirmed category/entity.

Tenant memory is durable business data and must remain tenant-isolated.

## 6. Confidence and Evidence Engine

CEI assigns confidence using multiple signals rather than one keyword.

Possible evidence includes:

- exact known entity match;
- alias match;
- normalized/fuzzy match;
- source path;
- description;
- structured source attributes;
- SKU/code patterns;
- neighboring products;
- image evidence when needed;
- prior tenant corrections;
- statistical/semantic similarity;
- verified external sources;
- contradiction penalties;
- source reliability/freshness.

Confidence should be attached per field when fields carry independent uncertainty.

Example:

- `partType=brake_pad`: 0.99
- `make=Toyota`: 0.99
- `model=Corolla`: 0.98
- `fitment=2018 2.0 XEi`: 0.52

CEI may auto-classify the part type while refusing to assert exact fitment.

Thresholds are calibrated with tests/data and may vary by domain/risk class. They are not magic constants embedded throughout the codebase.

## 7. Semantic conflict detection

CEI must detect internally inconsistent evidence.

Example title:

`Camisa GM abument pistão de carro`

Signals may point to fashion, dental and automotive. The correct behavior is not "first keyword wins". CEI marks semantic conflict, inspects broader context and either resolves the domain or sends the unresolved field/product to review.

Noise may be ignored only after stronger coherent evidence supports that decision.

## 8. Autonomous research

When CEI does not know enough, it can enter `RESEARCH_REQUIRED` automatically.

Research is concept-focused, not product-by-product.

For a 20,000-product unknown catalog, the desired behavior is:

1. analyze the catalog internally;
2. identify recurring unknown concepts/terms;
3. cluster similar unknowns;
4. generate focused research tasks;
5. inspect relevant web/document sources;
6. extract structured claims/evidence;
7. compare/score sources;
8. build or extend a Knowledge Pack;
9. re-run classification;
10. retain unresolved exceptions only.

Do not perform 20,000 expensive web/AI calls simply because there are 20,000 products.

### Research can work without generative AI

Internet research itself does not require an LLM. CEI can use:

- search/crawl infrastructure;
- browser/document extraction;
- HTML/JSON-LD/schema parsing;
- official manufacturer documentation;
- structured public datasets where appropriate;
- statistical term/context analysis;
- deterministic evidence rules.

Cloudflare browser/crawl infrastructure may be used as implementation infrastructure. The product contract is the research behavior, not one specific vendor feature.

## 9. Evidence quality

CEI must not trust all web pages equally.

Source reliability should be domain-sensitive. A typical hierarchy can prefer:

1. official manufacturer/authoritative documentation;
2. formal standards/regulatory/technical sources where relevant;
3. authorized distributor/catalog documentation;
4. high-quality specialist sources;
5. general retail listings;
6. marketplaces/forums/unverified pages.

Multiple weak sources do not automatically override one explicit authoritative technical source.

Knowledge claims can store:

- concept/relationship;
- source class;
- source fingerprint/reference;
- retrieval/verification time;
- confidence;
- contradictions;
- version/supersession state.

## 10. Risk-sensitive claims

Different outputs require different proof thresholds.

### Ordinary classification

Examples: jersey, tote bag, brake pad, healing abutment. Inference from strong context is acceptable.

### Merchandising

Examples: which navigation/facet/category should display a product. Inference is acceptable and reversible.

### Technical specification

Examples: exact diameter, material, platform, voltage. Prefer explicit evidence.

### Compatibility / fitment / clinical application

Examples: automotive vehicle fitment or medical/dental compatibility. Require explicit reliable evidence; do not infer from vague similarity.

### Safety/medical claims

Never manufacture claims from weak evidence.

## 11. Learning loop

CEI improves from corrections and verified research:

`new evidence -> hypothesis -> confidence -> decision/review -> confirmation/correction -> memory -> better future decision`

Corrections become labeled examples. Over time these examples can train small classifiers or similarity models without requiring a generative LLM.

Potential local/open-source techniques include:

- fuzzy matching;
- Naive Bayes/logistic classifiers;
- clustering;
- nearest-neighbor similarity;
- embeddings/local transformers;
- lightweight entity recognition;
- image embeddings/classifiers where justified.

Generative models are optional escalation tools, not the foundation.

## 12. Optional AI/model escalation

A model hosted locally or via infrastructure such as Workers AI may be used only when it materially improves difficult cases.

Rules:

- normal classification must not require it;
- bulk catalogs must not automatically become one paid inference per product;
- outputs must be schema-validated;
- model output is evidence/hypothesis, not unquestioned truth;
- critical compatibility/safety claims still require evidence;
- failures/rate limits must degrade to deterministic/review paths rather than break catalog operation.

## 13. Merchandising output

CEI does not stop at "what is this product?". It creates a sellable information architecture.

Examples:

### Sports

`Sport -> competition -> team -> product type -> season/version/audience`

The storefront can show club crests and team-first navigation.

### Fashion/bags

`category -> type -> style/material/color/size/occasion/collection`

The storefront can prioritize visual category/style discovery.

### Automotive

`system -> part type` plus evidence-backed `make -> model -> generation/year -> engine/fitment` where reliable.

### Dental

Domain-specific hierarchies and technical facets are learned/defined from validated domain knowledge; compatibility/application fields require stronger evidence.

The same storefront platform can therefore render different merchandising experiences by tenant/domain.

## 14. Automatic operation

CEI is designed for **autopilot + exception handling**.

Normal flow:

`catalog arrives -> CEI analyzes -> known items classify -> unknown concepts research -> knowledge updates -> catalog reclassifies -> low-confidence exceptions surface`

The Catalog Engine owner should not manually classify every new tenant.

Merchant review is reserved for ambiguous merchant-specific decisions or cases where reliable evidence cannot resolve the issue.

## 15. Observability

CEI should expose internal operational metrics such as:

- domain confidence;
- knowledge coverage;
- auto-classification rate;
- unknown rate;
- conflict rate;
- research-required rate;
- research success rate;
- human correction rate;
- knowledge reuse rate;
- stale knowledge rate;
- classification/version drift.

These metrics help prove that automation is improving rather than merely appearing intelligent.

## 16. Privacy and tenancy

Research jobs, classification state and memory must resolve an explicit tenant context before touching tenant data.

A CEI task may never infer its target tenant from untrusted client input alone when server-side routing/context is available.

Tenant private source URLs, credentials and private memory must never leak into another tenant or the public storefront.

Global knowledge promotion requires an explicit safe path; do not promote raw tenant corrections to the global brain automatically.

## 17. Implementation direction

The intended code organization can evolve toward:

```text
src/catalog-intelligence/
  core/
  domains/
  entities/
  ontology/
  extractors/
  matching/
  confidence/
  evidence/
  research/
  learning/
  knowledge/
  classification/
  merchandising/
  models/
```

This is a direction, not a requirement to create empty folders before implementation exists.

## Final CEI decision rule

When CEI encounters something new, the desired question is not:

> What category should I guess?

It is:

> What do I know, what evidence supports it, what do I not know, and what is the cheapest reliable way to learn enough to decide?

That behavior defines Catalog Engine Intelligence.
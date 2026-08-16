# Catalog Engine

MVP para transformar um catálogo público autorizado em uma vitrine web white-label, com importação estruturada, mídia local e build reproduzível.

## Fluxo atual

`URL Yupoo -> classificar -> extrair mídia HD -> data/catalog.json -> Vite -> dist/ -> GitHub Pages`

Ainda sem login, assinatura, banco de dados ou multiusuário. O objetivo continua sendo validar o motor e a experiência comercial antes de transformar o projeto em SaaS.

## Stack oficial

### Motor/importação
- Cheerio — parsing HTML.
- PQueue — concorrência/backpressure.
- Zod — validação de schemas.
- Sharp — validação/processamento de imagens.

### Storefront
- Vite — build/dev server.
- Fuse.js — busca tolerante a erros de digitação.
- Swiper — galeria touch de produto.
- Motion — microinterações discretas.

### Qualidade
- Vitest — testes.
- ESLint — análise estática.
- Prettier — formatação.

A política completa está em `AGENTS.md` e `config/dependency-policy.json`.

## Instalação reproduzível

```bash
npm ci
```

## Desenvolvimento da vitrine

```bash
npm run dev
```

## Build de produção

```bash
npm run build
npm run build:verify
```

O Vite gera `dist/`. Depois do build, o projeto copia apenas os dados/mídia pública necessários para o storefront. `dist/` é auditado antes do deploy.

## Quality gate

```bash
npm run deps:check
npm run test
npm run lint
npm run build
npm run build:verify
```

Para mudanças no crawler/importador também execute um crawl real isolado e:

```bash
npm run audit
```

## Crawl

```bash
MAX_ALBUMS=20 MAX_PAGES=2 npm run crawl -- "https://fornecedor.x.yupoo.com/albums/"
```

O catálogo público é salvo em `data/catalog.json`. Estado sensível da origem não deve ser versionado nem publicado.

## Estrutura principal

- `src/main.js` — entrada do storefront.
- `src/catalog/search.js` — busca Fuse.js.
- `src/product/gallery.js` — galeria Swiper.
- `src/ui/motion.js` — microinterações Motion.
- `src/styles.css` — estilos da vitrine.
- `scripts/scrape-yupoo.mjs` — extrator de página.
- `scripts/crawl-yupoo.mjs` — orquestrador do catálogo.
- `scripts/quality-audit.mjs` — auditoria Zod/PQueue/Sharp.
- `scripts/verify-dist.mjs` — auditoria do artifact público.
- `vite.config.js` — build portátil com `base: './'`.
- `.github/workflows/deploy-pages.yml` — build e publicação do `dist/` no GitHub Pages.

## Regra de produto

O storefront não deve expor o fornecedor. A origem existe apenas para o motor de sincronização. A camada pública recebe marca da loja, catálogo normalizado e mídia autorizada.

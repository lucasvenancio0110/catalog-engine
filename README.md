# Catalog Engine

MVP para transformar um catálogo público do Yupoo em uma vitrine web white-label.

## Objetivo do MVP 0.1

Provar o fluxo:

`URL Yupoo -> extração -> data/catalog.json -> vitrine -> GitHub Pages`

Sem login, assinatura, banco de dados ou multiusuário nesta etapa.

## Teste inicial

Catálogo de referência:

`https://zhouchangliang.x.yupoo.com/albums/`

O importador usa, por padrão, até 20 álbuns para validar a extração antes de escalar para o catálogo inteiro.

## Rodar o extrator

```bash
npm install
npm run scrape -- "https://zhouchangliang.x.yupoo.com/albums/"
```

Para limitar a quantidade de álbuns:

```bash
MAX_ALBUMS=20 npm run scrape -- "https://zhouchangliang.x.yupoo.com/albums/"
```

O resultado é salvo em `data/catalog.json`.

## Importar sem computador

Depois que os workflows estiverem na `main`:

1. Abra **Actions** no GitHub.
2. Escolha **Importar catálogo Yupoo**.
3. Clique em **Run workflow**.
4. Cole a URL pública terminada em `/albums/`.
5. Informe a quantidade de álbuns do teste.
6. Execute.

Se o catálogo mudar, o workflow atualiza `data/catalog.json`. Esse commit aciona o deploy do GitHub Pages automaticamente.

## Estrutura

- `scripts/scrape-yupoo.mjs` — importador inicial.
- `data/catalog.json` — catálogo normalizado consumido pela vitrine.
- `index.html`, `app.js`, `styles.css` — storefront estático.
- `.github/workflows/import-yupoo.yml` — importação manual pelo GitHub Actions.
- `.github/workflows/deploy-pages.yml` — publicação no GitHub Pages.

## Próximo marco

Validar a estrutura real do Yupoo com o catálogo de teste e fortalecer o parser para paginação, categorias, imagens e detecção de alterações.

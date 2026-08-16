import { readFile, writeFile } from 'node:fs/promises';

function argument(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

async function readJson(path, fallback) {
  if (!path) return fallback;
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function mapProducts(catalog) {
  return new Map((catalog?.products || []).map((product) => [String(product.id), product]));
}

function productLabel(id, before, after) {
  return after.get(id)?.name || before.get(id)?.name || id;
}

function renderItems(title, ids, before, after, { limit = 20, note = '' } = {}) {
  if (!ids?.length) return '';
  const visible = ids.slice(0, limit);
  const lines = [`### ${title} (${ids.length})`];
  if (note) lines.push(note, '');
  for (const id of visible) lines.push(`- ${productLabel(id, before, after)}`);
  if (ids.length > visible.length) lines.push(`- … e mais ${ids.length - visible.length}`);
  return `${lines.join('\n')}\n`;
}

function scopeLabel(kind = '') {
  return ({ catalog: 'Catálogo geral', category: 'Categoria', source: 'Fonte', legacy: 'Legado' })[kind] || 'Não informado';
}

export function buildSyncReport({ beforeCatalog = {}, afterCatalog = {}, syncState = {} } = {}) {
  const before = mapProducts(beforeCatalog);
  const after = mapProducts(afterCatalog);
  const changes = syncState.changes || {};
  const summary = syncState.summary || {};
  const scope = syncState.scope || {};
  const complete = Boolean(scope.complete);

  const lines = [
    '# Relatório de sincronização',
    '',
    `**Tipo de escopo:** ${scopeLabel(scope.kind)}`,
    `**Escopo:** ${complete ? 'COMPLETO' : 'PARCIAL'}`,
    `**Motivo de parada:** ${scope.stopReason || 'não informado'}`,
    `**Produtos publicados:** ${after.size}`,
    '',
    '| Mudança | Quantidade |',
    '|---|---:|',
    `| Novos | ${summary.new || 0} |`,
    `| Atualizados | ${summary.updated || 0} |`,
    `| Restaurados | ${summary.restored || 0} |`,
    `| Removidos da loja | ${summary.removed || 0} |`,
    `| Desvinculados deste escopo | ${summary.detached || 0} |`,
    `| Não observados preservados | ${summary.unobserved || 0} |`,
    ''
  ];

  if (!complete) {
    lines.push(
      '> **Proteção ativa:** este scan foi parcial. Produtos não observados foram preservados e não podem ser considerados removidos.',
      ''
    );
  }

  if ((summary.detached || 0) > (summary.removed || 0)) {
    lines.push(
      '> **Proteção entre escopos:** alguns produtos saíram deste escopo, mas continuam ativos porque ainda pertencem a outro escopo sincronizado.',
      ''
    );
  }

  const sections = [
    renderItems('Novos', changes.new || [], before, after),
    renderItems('Atualizados', changes.updated || [], before, after),
    renderItems('Restaurados', changes.restored || [], before, after),
    renderItems('Removidos da loja', changes.removed || [], before, after),
    renderItems(
      'Desvinculados deste escopo',
      changes.detached || [],
      before,
      after,
      { note: 'Desvincular de um escopo não significa necessariamente remover da loja; outro escopo pode manter o produto ativo.' }
    ),
    renderItems(
      'Não observados, mas preservados',
      changes.unobserved || [],
      before,
      after,
      { note: 'Estes produtos continuam publicados porque o escopo não foi completo.' }
    )
  ].filter(Boolean);

  if (sections.length) lines.push(...sections);
  else lines.push('Nenhuma mudança comercial detectada neste ciclo.', '');

  lines.push(
    '---',
    `Gerado em ${syncState.generatedAt || afterCatalog.generatedAt || new Date().toISOString()}.`
  );
  return `${lines.join('\n')}\n`;
}

async function main() {
  const beforePath = argument('before');
  const afterPath = argument('after', 'data/catalog.json');
  const statePath = argument('state', 'data/sync-state.json');
  const outPath = argument('out');

  const report = buildSyncReport({
    beforeCatalog: await readJson(beforePath, {}),
    afterCatalog: await readJson(afterPath, {}),
    syncState: await readJson(statePath, {})
  });

  if (outPath) await writeFile(outPath, report, 'utf8');
  else process.stdout.write(report);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

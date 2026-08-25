import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const probePath = fileURLToPath(new URL('./cloudflare-m7d7-d1-architecture-probe.mjs', import.meta.url));
const stdout = execFileSync(process.execPath, [probePath], {
  encoding: 'utf8',
  env: process.env,
  stdio: ['ignore', 'pipe', 'inherit'],
  maxBuffer: 4 * 1024 * 1024
});
const lines = stdout
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);
const evidence = JSON.parse(lines.at(-1) || '{}');
const promotion = evidence?.setBasedPromotion || {};
const products = Number(promotion.productCount || 0);
const media = Number(promotion.mediaCount || 0);
const reported = Number(promotion.estimatedCanonicalRowWrites || 0);

// The stress batch performs three product-keyed canonical writes
// (product, classification, intelligence) plus one media delete and one media insert.
const exactEstimatedCanonicalRowWrites = products * 3 + media * 2;

if (!evidence.m7d7D1ArchitectureProbePassed || products !== 20_000 || media !== 40_000) {
  throw new Error('m7d7_d1_architecture_probe_v2_base_evidence_invalid');
}
if (exactEstimatedCanonicalRowWrites !== 140_000) {
  throw new Error('m7d7_d1_architecture_probe_v2_row_write_math_invalid');
}

promotion.rawProbeReportedEstimatedCanonicalRowWrites = reported;
promotion.estimatedCanonicalRowWrites = exactEstimatedCanonicalRowWrites;
promotion.rowWriteEstimateFormula = 'products*3 + media*2';
evidence.evidenceRevision = 2;
evidence.setBasedPromotion = promotion;

console.log(JSON.stringify(evidence));

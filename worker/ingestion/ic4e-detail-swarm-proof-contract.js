export const IC4E_PROOF_CONTRACT_VERSION = 1;
export const IC4E_REFERENCE_CLASS = 'real-large-catalog';
export const IC4E_MIN_LARGE_CATALOG_PRODUCTS = 5_000;
export const IC4E_BASELINE_DETAIL_TERMINAL_WINDOW_MS = 6_288_000;
export const IC4E_MIN_MATERIAL_IMPROVEMENT_PCT = 20;
export const IC4E_SAFE_EXCEPTION_RATE = 0.01;
export const IC4E_MIN_EXCEPTION_BUDGET = 10;
export const IC4E_INITIAL_DETAIL_TARGET_MS = 120_000;

export function ic4eSafeExceptionBudget(discovered) {
  const total = Math.max(0, Number(discovered) || 0);
  return Math.max(IC4E_MIN_EXCEPTION_BUDGET, Math.ceil(total * IC4E_SAFE_EXCEPTION_RATE));
}

export function ic4eImprovementPct(detailTerminalWindowMs) {
  const current = Math.max(0, Number(detailTerminalWindowMs) || 0);
  if (!current || !IC4E_BASELINE_DETAIL_TERMINAL_WINDOW_MS) return 0;
  return Math.round(
    ((IC4E_BASELINE_DETAIL_TERMINAL_WINDOW_MS - current) /
      IC4E_BASELINE_DETAIL_TERMINAL_WINDOW_MS) *
      1000
  ) / 10;
}

export function ic4eMateriallyImproved(detailTerminalWindowMs) {
  return ic4eImprovementPct(detailTerminalWindowMs) >= IC4E_MIN_MATERIAL_IMPROVEMENT_PCT;
}

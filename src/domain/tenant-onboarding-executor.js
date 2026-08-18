import { z } from 'zod';
import { TENANT_PROVISION_STEPS } from './tenant-provisioning.js';

const STEP_SET = new Set(TENANT_PROVISION_STEPS);
const stepStatusSchema = z.enum(['pending', 'running', 'success', 'failed', 'skipped', 'blocked']);
const runStatusSchema = z.enum(['pending', 'running', 'blocked', 'success', 'failed', 'cancelled']);

const stepSchema = z.object({
  stepKey: z.string().refine((value) => STEP_SET.has(value), 'Unknown provisioning step.'),
  status: stepStatusSchema,
  attemptCount: z.number().int().nonnegative().default(0),
  lastError: z.string().nullable().optional()
});

const executorStateSchema = z.object({
  tenantId: z.string().regex(/^t_[a-f0-9]{20}$/),
  provisioningId: z.string().regex(/^pv_[a-f0-9]{20}$/),
  status: runStatusSchema,
  currentStep: z.string(),
  steps: z.array(stepSchema),
  domain: z
    .object({
      hostname: z.string().min(1),
      domainType: z.literal('custom'),
      status: z.enum(['pending', 'verifying', 'active', 'error', 'disabled'])
    })
    .nullable()
    .default(null)
});

function cloneState(state) {
  return structuredClone(executorStateSchema.parse(state));
}

function orderedStepMap(steps) {
  const byKey = new Map(steps.map((step) => [step.stepKey, step]));
  for (const stepKey of TENANT_PROVISION_STEPS) {
    if (!byKey.has(stepKey)) {
      byKey.set(stepKey, { stepKey, status: 'pending', attemptCount: 0, lastError: null });
    }
  }
  return byKey;
}

function nextIncompleteStep(byKey) {
  return TENANT_PROVISION_STEPS.find((stepKey) => {
    const status = byKey.get(stepKey)?.status;
    return status !== 'success' && status !== 'skipped';
  });
}

function domainBlockReason(state) {
  if (!state.domain) return 'custom_domain_required';
  if (state.domain.status !== 'active') return 'custom_domain_not_verified';
  return null;
}

export function normalizeTenantOnboardingState(input) {
  const state = cloneState(input);
  const byKey = orderedStepMap(state.steps);
  state.steps = TENANT_PROVISION_STEPS.map((stepKey) => byKey.get(stepKey));
  const nextStep = nextIncompleteStep(byKey);
  state.currentStep = nextStep || 'complete';
  if (!nextStep) state.status = 'success';
  return state;
}

export function nextTenantOnboardingAction(input) {
  const state = normalizeTenantOnboardingState(input);
  if (state.status === 'cancelled' || state.status === 'success') {
    return { type: 'complete', state };
  }

  const step = state.steps.find((candidate) => candidate.stepKey === state.currentStep);
  if (!step) return { type: 'complete', state };

  if (step.stepKey === 'domain') {
    const reason = domainBlockReason(state);
    if (reason) return { type: 'blocked', stepKey: 'domain', reason, state };
  }

  if (step.stepKey === 'publish') {
    const reason = domainBlockReason(state);
    if (reason) return { type: 'blocked', stepKey: 'publish', reason, state };
    const verify = state.steps.find((candidate) => candidate.stepKey === 'verify');
    if (verify?.status !== 'success') {
      return { type: 'blocked', stepKey: 'publish', reason: 'storefront_not_verified', state };
    }
  }

  return { type: 'execute', stepKey: step.stepKey, state };
}

export async function executeTenantOnboarding(input, {
  handlers,
  onTransition = async () => {},
  maxSteps = TENANT_PROVISION_STEPS.length
} = {}) {
  if (!handlers || typeof handlers !== 'object') throw new Error('Provisioning handlers are required.');
  let state = normalizeTenantOnboardingState(input);
  let executed = 0;

  while (executed < maxSteps) {
    const action = nextTenantOnboardingAction(state);
    state = action.state;

    if (action.type === 'complete') return { outcome: 'success', state, executed };
    if (action.type === 'blocked') {
      const step = state.steps.find((candidate) => candidate.stepKey === action.stepKey);
      step.status = 'blocked';
      step.lastError = action.reason;
      state.status = 'blocked';
      state.currentStep = action.stepKey;
      await onTransition({ type: 'blocked', stepKey: action.stepKey, reason: action.reason, state: structuredClone(state) });
      return { outcome: 'blocked', reason: action.reason, state, executed };
    }

    const handler = handlers[action.stepKey];
    if (typeof handler !== 'function') {
      throw new Error(`Missing provisioning handler for step: ${action.stepKey}`);
    }

    const step = state.steps.find((candidate) => candidate.stepKey === action.stepKey);
    step.status = 'running';
    step.attemptCount += 1;
    step.lastError = null;
    state.status = 'running';
    state.currentStep = action.stepKey;
    await onTransition({ type: 'running', stepKey: action.stepKey, state: structuredClone(state) });

    try {
      const result = await handler({ state: structuredClone(state), stepKey: action.stepKey });
      if (result?.domain) state.domain = result.domain;
      step.status = result?.status === 'skipped' ? 'skipped' : 'success';
      step.lastError = null;
      executed += 1;
      const normalized = normalizeTenantOnboardingState(state);
      state = normalized;
      if (state.status !== 'success') state.status = 'running';
      await onTransition({
        type: step.status,
        stepKey: action.stepKey,
        result: result?.metadata || null,
        state: structuredClone(state)
      });
    } catch (error) {
      step.status = 'failed';
      step.lastError = String(error?.message || error).slice(0, 500);
      state.status = 'failed';
      state.currentStep = action.stepKey;
      await onTransition({
        type: 'failed',
        stepKey: action.stepKey,
        error: step.lastError,
        state: structuredClone(state)
      });
      return { outcome: 'failed', error: step.lastError, state, executed };
    }
  }

  return { outcome: 'yielded', state, executed };
}

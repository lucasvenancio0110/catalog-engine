import {
  PROVIDER_GOVERNOR_CONTRACT,
  ProviderDetailGovernor
} from './ingestion/provider-detail-governor.js';

export { ProviderDetailGovernor };

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' }
  });
}

async function acquire(stub) {
  const response = await stub.fetch('https://governor.internal/acquire', { method: 'POST' });
  return { status: response.status, body: await response.json() };
}

async function report(stub, token, signal) {
  const response = await stub.fetch('https://governor.internal/report', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, ...signal })
  });
  return { status: response.status, body: await response.json() };
}

function governorStub(env, scenario) {
  return env.PROVIDER_DETAIL_GOVERNOR.get(
    env.PROVIDER_DETAIL_GOVERNOR.idFromName(`ic4c-proof-v1:${scenario}`)
  );
}

async function healthySignal(stub) {
  const admission = await acquire(stub);
  if (!admission.body?.admitted || !admission.body?.token) {
    throw new Error('ic4c_probe_healthy_admission_failed');
  }
  const result = await report(stub, admission.body.token, { status: 200, latencyMs: 400 });
  if (!result.body?.ok) throw new Error('ic4c_probe_healthy_report_failed');
  return Number(result.body.limit || 0);
}

async function warmToCeiling(stub) {
  let limit = 0;
  const total = PROVIDER_GOVERNOR_CONTRACT.healthyWindow * 2;
  for (let index = 0; index < total; index += 1) limit = await healthySignal(stub);
  if (limit !== PROVIDER_GOVERNOR_CONTRACT.ceiling) {
    throw new Error('ic4c_probe_ceiling_not_reached');
  }
  return limit;
}

async function pressureScenario(env, name, signal) {
  const stub = governorStub(env, name);
  await warmToCeiling(stub);
  const admission = await acquire(stub);
  if (!admission.body?.admitted || !admission.body?.token) {
    throw new Error('ic4c_probe_pressure_admission_failed');
  }
  const result = await report(stub, admission.body.token, signal);
  const duringCooldown = await acquire(stub);
  return {
    reducedLimit: Number(result.body?.limit || 0),
    cooldownRejected: duringCooldown.status === 429 && duringCooldown.body?.admitted === false
  };
}

async function runProof(env) {
  const contract = PROVIDER_GOVERNOR_CONTRACT;
  const initialStub = governorStub(env, 'initial');
  const first = await acquire(initialStub);
  const second = await acquire(initialStub);
  const third = await acquire(initialStub);
  const initialLimit = Number(first.body?.limit || 0);
  for (const entry of [first, second]) {
    if (entry.body?.token) await report(initialStub, entry.body.token, { status: 200, latencyMs: 400 });
  }

  const scaleStub = governorStub(env, 'scale');
  let firstWindowLimit = 0;
  for (let index = 0; index < contract.healthyWindow; index += 1) {
    firstWindowLimit = await healthySignal(scaleStub);
  }
  let secondWindowLimit = 0;
  for (let index = 0; index < contract.healthyWindow; index += 1) {
    secondWindowLimit = await healthySignal(scaleStub);
  }

  const ceilingStub = governorStub(env, 'ceiling');
  await warmToCeiling(ceilingStub);
  const concurrent = await Promise.all(
    Array.from({ length: contract.ceiling * 2 }, () => acquire(ceilingStub))
  );
  const admitted = concurrent.filter((entry) => entry.body?.admitted === true);
  const rejected = concurrent.filter(
    (entry) => entry.status === 429 && entry.body?.admitted === false
  );
  await Promise.all(
    admitted.map((entry) =>
      report(ceilingStub, entry.body.token, { status: 200, latencyMs: 400 })
    )
  );

  const pressure = {
    throttled429: await pressureScenario(env, 'pressure-429', { status: 429, latencyMs: 500 }),
    upstream5xx: await pressureScenario(env, 'pressure-5xx', { status: 503, latencyMs: 500 }),
    timeout: await pressureScenario(env, 'pressure-timeout', {
      status: 0,
      latencyMs: 500,
      timeout: true
    }),
    degradedLatency: await pressureScenario(env, 'pressure-latency', {
      status: 200,
      latencyMs: contract.latencyDegradeMs + 500
    })
  };

  const passed =
    initialLimit === contract.initialLimit &&
    first.body?.admitted === true &&
    second.body?.admitted === true &&
    third.status === 429 &&
    third.body?.admitted === false &&
    firstWindowLimit === 3 &&
    secondWindowLimit === contract.ceiling &&
    admitted.length === contract.ceiling &&
    rejected.length === contract.ceiling &&
    Object.values(pressure).every(
      (entry) => entry.reducedLimit === 2 && entry.cooldownRejected === true
    );

  return {
    ic4cAdaptiveGovernor: passed ? 'passed' : 'failed',
    contractVersion: 1,
    durableObjectCoordination: true,
    initialLimit,
    firstHealthyWindowLimit: firstWindowLimit,
    secondHealthyWindowLimit: secondWindowLimit,
    hardCeiling: contract.ceiling,
    concurrentAttempted: concurrent.length,
    concurrentAdmitted: admitted.length,
    concurrentRejected: rejected.length,
    pressure,
    recurringIntelligentSyncChanged: contract.recurringSyncChanged,
    privateIdentifiersExposed: false
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/run' || request.method !== 'POST') return new Response('not_found', { status: 404 });
    const expected = String(env.PROBE_TOKEN || '');
    const supplied = String(request.headers.get('x-probe-token') || '');
    if (!expected || supplied !== expected) return new Response('not_found', { status: 404 });
    try {
      return json(await runProof(env));
    } catch {
      return json({ ic4cAdaptiveGovernor: 'failed', privateIdentifiersExposed: false }, 500);
    }
  }
};

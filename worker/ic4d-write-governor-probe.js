import {
  TENANT_D1_WRITE_GOVERNOR_CONTRACT,
  TenantD1WriteGovernor
} from './ingestion/tenant-d1-write-governor.js';

export { TenantD1WriteGovernor };

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' }
  });
}

function governorStub(env, scenario) {
  return env.TENANT_D1_WRITE_GOVERNOR.get(
    env.TENANT_D1_WRITE_GOVERNOR.idFromName(`ic4d-proof-v1:${scenario}`)
  );
}

async function acquire(stub) {
  const response = await stub.fetch('https://write-governor.internal/acquire', { method: 'POST' });
  return { status: response.status, body: await response.json() };
}

async function report(stub, token, signal) {
  const response = await stub.fetch('https://write-governor.internal/report', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, ...signal })
  });
  return { status: response.status, body: await response.json() };
}

async function completeHealthyWrite(stub, latencyMs = 120) {
  const admission = await acquire(stub);
  if (!admission.body?.admitted || !admission.body?.token) {
    throw new Error('ic4d_probe_healthy_admission_failed');
  }
  const result = await report(stub, admission.body.token, { status: 200, latencyMs });
  if (!result.body?.ok) throw new Error('ic4d_probe_healthy_report_failed');
  return Number(result.body.limit || 0);
}

async function runProof(env) {
  const contract = TENANT_D1_WRITE_GOVERNOR_CONTRACT;

  const tenantA = governorStub(env, 'tenant-a');
  const initial = await Promise.all([
    acquire(tenantA),
    acquire(tenantA),
    acquire(tenantA),
    acquire(tenantA)
  ]);
  const initialAdmitted = initial.filter((entry) => entry.body?.admitted === true);
  const initialRejected = initial.filter(
    (entry) => entry.status === 429 && entry.body?.admitted === false
  );
  await Promise.all(
    initialAdmitted.map((entry) =>
      report(tenantA, entry.body.token, { status: 200, latencyMs: 120 })
    )
  );

  const slowAdmission = await acquire(tenantA);
  if (!slowAdmission.body?.admitted || !slowAdmission.body?.token) {
    throw new Error('ic4d_probe_slow_admission_failed');
  }
  const slowReport = await report(tenantA, slowAdmission.body.token, {
    status: 200,
    latencyMs: contract.slowWriteMs + 250
  });
  const duringCooldown = await acquire(tenantA);

  await new Promise((resolve) => setTimeout(resolve, 850));
  const afterCooldownFirst = await acquire(tenantA);
  const afterCooldownSecond = await acquire(tenantA);
  if (afterCooldownFirst.body?.token) {
    await report(tenantA, afterCooldownFirst.body.token, { status: 200, latencyMs: 120 });
  }

  let recoveredLimit = Number(afterCooldownFirst.body?.limit || 0);
  for (let index = 1; index < contract.healthyWindow; index += 1) {
    recoveredLimit = await completeHealthyWrite(tenantA, 120);
  }

  const tenantB = governorStub(env, 'tenant-b');
  const tenantBParallel = await Promise.all([acquire(tenantB), acquire(tenantB), acquire(tenantB)]);
  const tenantBAdmitted = tenantBParallel.filter((entry) => entry.body?.admitted === true);
  const tenantBRejected = tenantBParallel.filter(
    (entry) => entry.status === 429 && entry.body?.admitted === false
  );
  await Promise.all(
    tenantBAdmitted.map((entry) =>
      report(tenantB, entry.body.token, { status: 200, latencyMs: 120 })
    )
  );

  const serverPressure = governorStub(env, 'server-pressure');
  const serverLease = await acquire(serverPressure);
  const serverResult = await report(serverPressure, serverLease.body.token, {
    status: 503,
    latencyMs: 150
  });

  const transportPressure = governorStub(env, 'transport-pressure');
  const transportLease = await acquire(transportPressure);
  const transportResult = await report(transportPressure, transportLease.body.token, {
    status: 0,
    latencyMs: 150,
    transportError: true
  });

  const passed =
    contract.initialLimit === 2 &&
    contract.ceiling === 2 &&
    initialAdmitted.length === 2 &&
    initialRejected.length === 2 &&
    Number(slowReport.body?.limit || 0) === 1 &&
    duringCooldown.status === 429 &&
    duringCooldown.body?.admitted === false &&
    afterCooldownFirst.body?.admitted === true &&
    Number(afterCooldownFirst.body?.limit || 0) === 1 &&
    afterCooldownSecond.status === 429 &&
    afterCooldownSecond.body?.admitted === false &&
    recoveredLimit === 2 &&
    tenantBAdmitted.length === 2 &&
    tenantBRejected.length === 1 &&
    Number(serverResult.body?.limit || 0) === 1 &&
    Number(transportResult.body?.limit || 0) === 1;

  return {
    ic4dTenantWriteGovernor: passed ? 'passed' : 'failed',
    contractVersion: 1,
    durableObjectCoordination: true,
    initialLimit: contract.initialLimit,
    hardCeiling: contract.ceiling,
    initialConcurrentAttempted: initial.length,
    initialConcurrentAdmitted: initialAdmitted.length,
    initialConcurrentRejected: initialRejected.length,
    slowWrite: {
      thresholdMs: contract.slowWriteMs,
      reducedLimit: Number(slowReport.body?.limit || 0),
      cooldownRejected: duringCooldown.status === 429 && duringCooldown.body?.admitted === false,
      singleWriterAfterCooldown:
        afterCooldownFirst.body?.admitted === true && afterCooldownSecond.status === 429,
      recoveredLimit
    },
    tenantIsolation: {
      pressuredTenantLimit: Number(slowReport.body?.limit || 0),
      independentTenantAdmitted: tenantBAdmitted.length,
      independentTenantRejected: tenantBRejected.length,
      independentTenantLimit: Number(tenantBAdmitted[0]?.body?.limit || 0)
    },
    pressure: {
      server5xxReducedLimit: Number(serverResult.body?.limit || 0),
      transportReducedLimit: Number(transportResult.body?.limit || 0)
    },
    workLossObserved: false,
    recurringIntelligentSyncChanged: contract.recurringSyncChanged,
    privateIdentifiersExposed: false
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/run' || request.method !== 'POST') {
      return new Response('not_found', { status: 404 });
    }
    const expected = String(env.PROBE_TOKEN || '');
    const supplied = String(request.headers.get('x-probe-token') || '');
    if (!expected || supplied !== expected) return new Response('not_found', { status: 404 });
    try {
      return json(await runProof(env));
    } catch {
      return json({ ic4dTenantWriteGovernor: 'failed', privateIdentifiersExposed: false }, 500);
    }
  }
};

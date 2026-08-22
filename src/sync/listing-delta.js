import { z } from 'zod';
import {
  DEFAULT_SYNC_SAFETY_POLICY,
  decideSyncRunSafety
} from './sync-decision.js';

export const LISTING_DELTA_CONTRACT_VERSION = 1;

const SOURCE_ID_PATTERN = /^[^\s]{1,180}$/;
const EVENT_TYPES = [
  'NEW',
  'RESTORED',
  'CHANGED_MOVED',
  'CHANGED',
  'MOVED',
  'MISSING',
  'REMOVED'
];

const EVENT_PRIORITY = new Map(EVENT_TYPES.map((type, index) => [type, index]));

const previousSchema = z
  .object({
    sourceId: z.string().trim().regex(SOURCE_ID_PATTERN),
    publicProductId: z.string().trim().max(180).optional().default(''),
    categoryId: z.string().trim().max(180).nullable().optional().default(null),
    categoryPathIds: z.array(z.string().trim().max(180)).max(64).optional().default([]),
    listingFingerprint: z.string().trim().min(1).max(256),
    detailFingerprint: z.string().trim().max(256).nullable().optional().default(null),
    status: z.enum(['active', 'missing', 'deleted']).optional().default('active'),
    missCount: z.number().int().min(0).max(1_000_000).optional().default(0)
  })
  .passthrough();

const observationSchema = z
  .object({
    sourceId: z.string().trim().regex(SOURCE_ID_PATTERN),
    publicProductId: z.string().trim().max(180).optional().default(''),
    categoryId: z.string().trim().max(180).nullable().optional().default(null),
    categoryPathIds: z.array(z.string().trim().max(180)).max(64).optional().default([]),
    listingFingerprint: z.string().trim().min(1).max(256)
  })
  .passthrough();

function normalizeNullableString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizedPrevious(value) {
  const parsed = previousSchema.parse({
    ...value,
    categoryId: normalizeNullableString(value?.categoryId),
    detailFingerprint: normalizeNullableString(value?.detailFingerprint)
  });
  return {
    ...parsed,
    categoryId: normalizeNullableString(parsed.categoryId),
    categoryPathIds: [...parsed.categoryPathIds],
    detailFingerprint: normalizeNullableString(parsed.detailFingerprint)
  };
}

function normalizedObservation(value) {
  const parsed = observationSchema.parse({
    ...value,
    categoryId: normalizeNullableString(value?.categoryId)
  });
  return {
    ...parsed,
    categoryId: normalizeNullableString(parsed.categoryId),
    categoryPathIds: [...parsed.categoryPathIds]
  };
}

function uniqueBySourceId(values, kind) {
  const byId = new Map();
  for (const value of values) {
    if (byId.has(value.sourceId)) {
      const error = new Error(`sync_listing_duplicate_${kind}_source_id`);
      error.code = `sync_listing_duplicate_${kind}_source_id`;
      throw error;
    }
    byId.set(value.sourceId, value);
  }
  return byId;
}

function assertStablePublicIdentity(previous, current) {
  if (
    previous.publicProductId &&
    current.publicProductId &&
    previous.publicProductId !== current.publicProductId
  ) {
    const error = new Error('sync_listing_public_identity_changed');
    error.code = 'sync_listing_public_identity_changed';
    throw error;
  }
}

function moved(previous, current) {
  return (
    previous.categoryId !== current.categoryId ||
    JSON.stringify(previous.categoryPathIds) !== JSON.stringify(current.categoryPathIds)
  );
}

function freezeEvent(event) {
  return Object.freeze({
    ...event,
    previous: event.previous ? Object.freeze({ ...event.previous }) : null,
    current: event.current ? Object.freeze({ ...event.current }) : null
  });
}

function freezePlan(plan) {
  return Object.freeze({
    contractVersion: LISTING_DELTA_CONTRACT_VERSION,
    events: Object.freeze(plan.events.map(freezeEvent)),
    detailQueue: Object.freeze([...plan.detailQueue]),
    summary: Object.freeze({ ...plan.summary })
  });
}

export function planListingDelta(
  previousValues = [],
  currentValues = [],
  { removalMissThreshold = 3, inferMissing = true } = {}
) {
  const threshold = Math.max(2, Number(removalMissThreshold || 3));
  if (!Number.isFinite(threshold) || threshold > 1_000_000) {
    throw new Error('sync_listing_removal_threshold_invalid');
  }

  const previous = previousValues.map(normalizedPrevious);
  const current = currentValues.map(normalizedObservation);
  const previousById = uniqueBySourceId(previous, 'previous');
  const currentById = uniqueBySourceId(current, 'current');
  const events = [];

  for (const [sourceId, observation] of currentById) {
    const prior = previousById.get(sourceId);
    if (!prior) {
      events.push({
        type: 'NEW',
        sourceId,
        previous: null,
        current: observation,
        needsDetail: true
      });
      continue;
    }

    assertStablePublicIdentity(prior, observation);

    if (prior.status === 'deleted' || prior.status === 'missing') {
      events.push({
        type: 'RESTORED',
        sourceId,
        previous: prior,
        current: observation,
        needsDetail: true
      });
      continue;
    }

    const categoryMoved = moved(prior, observation);
    const contentChanged = prior.listingFingerprint !== observation.listingFingerprint;
    const detailPending = !prior.detailFingerprint;

    if (contentChanged) {
      events.push({
        type: categoryMoved ? 'CHANGED_MOVED' : 'CHANGED',
        sourceId,
        previous: prior,
        current: observation,
        needsDetail: true,
        reason: 'listing-changed'
      });
    } else if (detailPending) {
      events.push({
        type: 'CHANGED',
        sourceId,
        previous: prior,
        current: observation,
        needsDetail: true,
        reason: 'detail-pending'
      });
    } else if (categoryMoved) {
      events.push({
        type: 'MOVED',
        sourceId,
        previous: prior,
        current: observation,
        needsDetail: false,
        reason: 'source-placement-changed'
      });
    }
  }

  if (inferMissing) {
    for (const [sourceId, prior] of previousById) {
      if (currentById.has(sourceId) || prior.status === 'deleted') continue;
      const nextMissCount = prior.missCount + 1;
      events.push({
        type: nextMissCount >= threshold ? 'REMOVED' : 'MISSING',
        sourceId,
        previous: prior,
        current: null,
        missCount: nextMissCount,
        needsDetail: false,
        reason: 'not-observed-in-authoritative-scan'
      });
    }
  }

  events.sort(
    (left, right) =>
      (EVENT_PRIORITY.get(left.type) ?? 99) - (EVENT_PRIORITY.get(right.type) ?? 99) ||
      left.sourceId.localeCompare(right.sourceId)
  );

  const summary = {};
  for (const event of events) summary[event.type] = (summary[event.type] || 0) + 1;

  return freezePlan({
    events,
    detailQueue: events.filter((event) => event.needsDetail).map((event) => event.sourceId),
    summary
  });
}

export function planSafeListingDelta(
  previousValues = [],
  currentValues = [],
  {
    scope,
    knownGoodCount,
    scanComplete,
    disqualifyingFailureCount = 0,
    removalMissThreshold = 3,
    safetyPolicy = DEFAULT_SYNC_SAFETY_POLICY
  } = {}
) {
  const decision = decideSyncRunSafety(
    {
      scope,
      previous: { knownGoodCount },
      scan: {
        complete: Boolean(scanComplete),
        observedCount: currentValues.length,
        disqualifyingFailureCount
      }
    },
    safetyPolicy
  );

  const delta = planListingDelta(previousValues, currentValues, {
    removalMissThreshold,
    inferMissing: decision.allowMissingInference
  });

  return Object.freeze({
    contractVersion: LISTING_DELTA_CONTRACT_VERSION,
    decision,
    events: delta.events,
    detailQueue: delta.detailQueue,
    summary: delta.summary
  });
}

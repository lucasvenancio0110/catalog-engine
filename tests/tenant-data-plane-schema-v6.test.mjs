import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { tenantDataPlaneCurrentBatch as tenantDataPlaneV5Batch } from '../worker/tenant-data-plane-schema-v5.js';
import {
  TENANT_DATA_PLANE_CURRENT_STATEMENTS,
  TENANT_DATA_PLANE_SCHEMA_VERSION,
  TENANT_DATA_PLANE_V6_STATEMENTS,
  TENANT_SYNC_CANDIDATE_CONTRACT_VERSION,
  TENANT_SYNC_CANDIDATE_JSON_MAX_BYTES,
  TENANT_SYNC_CANDIDATE_TABLES,
  tenantDataPlaneCurrentBatch,
  tenantDataPlaneMigrationBatches
} from '../worker/tenant-data-plane-schema-v6.js';

const databases = [];
const tenantId = 't_0123456789abcdefabcd';
const sourceUrl = 'https://private-supplier.x.yupoo.com/albums/';
const runId = 'sync_candidate_schema_v6';
const albumSourceId = 'album-private-1';
const publicProductId = 'p_0123456789abcdefabcd';

function source() {
  return {
    sourceKey: 'primary',
    provider: 'yupoo',
    sourceUrl,
    syncStrategy: 'incremental',
    removalMissThreshold: 3
  };
}

function database() {
  const instance = new DatabaseSync(':memory:');
  instance.exec('PRAGMA foreign_keys = ON');
  databases.push(instance);
  return instance;
}

function applyBatch(instance, batch) {
  instance.exec('BEGIN');
  try {
    for (const query of batch) {
      instance.prepare(query.sql).run(...(query.params || []));
    }
    instance.exec('COMMIT');
  } catch (error) {
    instance.exec('ROLLBACK');
    throw error;
  }
}

function installV5(instance) {
  applyBatch(instance, tenantDataPlaneV5Batch({ tenantId, source: source() }));
}

function seedCanonicalAndStage(instance) {
  instance
    .prepare(
      `INSERT INTO catalog_products
        (product_id,name,search_text,category_id,category_name,description)
       VALUES (?1,'Last Known Good','last known good','legacy','Legacy','healthy')`
    )
    .run(publicProductId);
  instance
    .prepare(
      `INSERT INTO catalog_product_classification_overrides
        (product_id,override_json,override_version)
       VALUES (?1,'{"displayName":"Merchant Truth"}',7)`
    )
    .run(publicProductId);
  instance
    .prepare(
      `INSERT INTO supplier_sync_stage_runs
        (run_id,tenant_id,source_key,scope_id,scope_kind,state,safety_outcome,
         safety_policy_version,scan_complete,previous_known_good_count,observed_count,
         expected_event_count,expected_detail_count,staged_observation_count,
         staged_event_count,staged_category_count)
       VALUES (?1,?2,'primary','catalog','catalog','details_pending','proceed',1,1,1,1,1,1,1,1,1)`
    )
    .run(runId, tenantId);
  instance
    .prepare(
      `INSERT INTO supplier_sync_stage_observations
        (run_id,album_source_id,public_product_id,source_url,source_title,
         source_category_path_json,listing_fingerprint)
       VALUES (?1,?2,?3,?4,'Candidate','[]','listing-v2')`
    )
    .run(runId, albumSourceId, publicProductId, `${sourceUrl}${albumSourceId}`);
  instance
    .prepare(
      `INSERT INTO supplier_sync_stage_events
        (run_id,album_source_id,public_product_id,event_type,needs_detail)
       VALUES (?1,?2,?3,'CHANGED',1)`
    )
    .run(runId, albumSourceId, publicProductId);
}

function seedCandidate(instance) {
  instance
    .prepare(
      `INSERT INTO supplier_sync_stage_catalog_categories
        (run_id,category_id,name,depth,sort_order,product_count)
       VALUES (?1,'jerseys','Jerseys',0,0,1)`
    )
    .run(runId);
  instance
    .prepare(
      `INSERT INTO supplier_sync_stage_leagues
        (run_id,league_id,name,country_code,country_name,entity_type,product_count)
       VALUES (?1,'league-1','League','BR','Brazil','club',1)`
    )
    .run(runId);
  instance
    .prepare(
      `INSERT INTO supplier_sync_stage_teams
        (run_id,team_id,name,short_name,league_id,country_code,entity_type,initials,product_count)
       VALUES (?1,'team-1','Team','Team','league-1','BR','club','TM',1)`
    )
    .run(runId);
  instance
    .prepare(
      `INSERT INTO supplier_sync_stage_facets
        (run_id,facet_id,facet_type,name,product_count)
       VALUES (?1,'facet-1','season','2026',1)`
    )
    .run(runId);
  instance
    .prepare(
      `INSERT INTO supplier_sync_stage_media_sources
        (run_id,media_id,provider,source_url,display_source_url,thumbnail_source_url,referer_url)
       VALUES (?1,'media-1','yupoo',?2,'/media/media-1','/media/media-1',?3)`
    )
    .run(runId, `${sourceUrl}images/private.jpg`, `${sourceUrl}${albumSourceId}`);
  instance
    .prepare(
      `INSERT INTO supplier_sync_stage_product_details
        (run_id,album_source_id,public_product_id,detail_state,attempt_count,
         provider_contract_version,evidence_schema_version,detail_fingerprint,
         normalized_evidence_json,name,search_text,category_id,category_name,
         description,image_count,primary_media_id,sort_order,source_name,
         display_name,source_category_name,display_category_name,team_id,league_id,
         classification_status,classification_confidence,processed_at)
       VALUES (?1,?2,?3,'complete',1,1,1,'detail-v2','{"contractVersion":1}',
               'Candidate','candidate','jerseys','Jerseys','candidate detail',1,
               'media-1',0,'Private Candidate','Merchant Truth','Private Category',
               'Jerseys','team-1','league-1','automatic',0.95,CURRENT_TIMESTAMP)`
    )
    .run(runId, albumSourceId, publicProductId);
  instance
    .prepare(
      `INSERT INTO supplier_sync_stage_product_media
        (run_id,public_product_id,media_id,position)
       VALUES (?1,?2,'media-1',0)`
    )
    .run(runId, publicProductId);
  instance
    .prepare(
      `INSERT INTO supplier_sync_stage_product_categories
        (run_id,public_product_id,category_id)
       VALUES (?1,?2,'jerseys')`
    )
    .run(runId, publicProductId);
  instance
    .prepare(
      `INSERT INTO supplier_sync_stage_product_facets
        (run_id,public_product_id,facet_id)
       VALUES (?1,?2,'facet-1')`
    )
    .run(runId, publicProductId);
  instance
    .prepare(
      `INSERT INTO supplier_sync_stage_classification_state
        (run_id,public_product_id,classifier_version,classifier_key,
         override_applied,merchant_override_version,merchant_override_updated_at)
       VALUES (?1,?2,3,'professional-v3',1,7,CURRENT_TIMESTAMP)`
    )
    .run(runId, publicProductId);
  instance
    .prepare(
      `INSERT INTO supplier_sync_stage_intelligence_state
        (run_id,public_product_id,contract_version,evidence_schema_version,
         classifier_version,classifier_key,knowledge_pack_key,knowledge_pack_version,
         domain_id,domain_confidence,domain_knowledge_state,knowledge_state,
         override_applied,review_required,research_required,conflict_count,state_json)
       VALUES (?1,?2,1,1,3,'professional-v3','sports',1,'sports',1,
               'VERIFIED','VERIFIED',1,0,0,0,'{"knowledgeState":"VERIFIED"}')`
    )
    .run(runId, publicProductId);
  instance
    .prepare(
      `INSERT INTO supplier_sync_stage_catalog_meta (run_id,key,value_json)
       VALUES (?1,'merchandising','{"contractVersion":1}')`
    )
    .run(runId);
}

afterEach(() => {
  while (databases.length) databases.pop().close();
});

describe('tenant data-plane schema v6 candidate state', () => {
  it('adds a bounded private relational candidate model without a competing canonical catalog', () => {
    const sql = TENANT_DATA_PLANE_V6_STATEMENTS.join('\n').toLowerCase();
    expect(TENANT_DATA_PLANE_SCHEMA_VERSION).toBe(6);
    expect(TENANT_SYNC_CANDIDATE_CONTRACT_VERSION).toBe(1);
    expect(TENANT_SYNC_CANDIDATE_JSON_MAX_BYTES).toBe(262_144);
    expect(TENANT_SYNC_CANDIDATE_TABLES).toHaveLength(12);
    for (const table of TENANT_SYNC_CANDIDATE_TABLES) expect(sql).toContain(table);
    expect(TENANT_DATA_PLANE_V6_STATEMENTS.length + 2).toBeLessThan(100);
    expect(sql).not.toMatch(/create table if not exists (catalog_|media_sources|product_media)/);
    expect(sql).not.toMatch(/\b(?:insert|update|delete)\s+(?:into\s+)?catalog_/);
    expect(sql).not.toContain('tenant_memberships');
    expect(sql).not.toContain('tenant_domains');
  });

  it('installs fresh v6 with foreign keys and the complete contiguous ledger', () => {
    const instance = database();
    applyBatch(instance, tenantDataPlaneCurrentBatch({ tenantId, source: source() }));

    const identity = instance.prepare('SELECT * FROM data_plane_identity').get();
    const ledger = instance
      .prepare('SELECT version FROM data_plane_schema_migrations ORDER BY version')
      .all()
      .map((row) => row.version);
    const tables = new Set(
      instance
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .map((row) => row.name)
    );
    expect(identity).toMatchObject({ tenant_id: tenantId, schema_version: 6 });
    expect(ledger).toEqual([1, 2, 3, 4, 5, 6]);
    for (const table of TENANT_SYNC_CANDIDATE_TABLES) expect(tables.has(table)).toBe(true);
    expect(instance.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('upgrades v5 with only the idempotent v6 delta and preserves LKG, overrides and staged listing', () => {
    const instance = database();
    installV5(instance);
    seedCanonicalAndStage(instance);
    const [batch] = tenantDataPlaneMigrationBatches({
      tenantId,
      source: source(),
      currentVersion: 5,
      targetVersion: 6
    });
    const sql = batch
      .map((query) => query.sql)
      .join('\n')
      .toLowerCase();

    expect(batch).toHaveLength(TENANT_DATA_PLANE_V6_STATEMENTS.length + 2);
    expect(sql).not.toContain('create table if not exists catalog_products');
    expect(batch.at(-2).params).toEqual([tenantId, 6]);
    expect(batch.at(-1).params).toEqual([6]);
    applyBatch(instance, batch);
    applyBatch(instance, batch);

    expect(instance.prepare('SELECT schema_version FROM data_plane_identity').get()).toEqual({
      schema_version: 6
    });
    expect(
      instance.prepare('SELECT name FROM catalog_products WHERE product_id=?1').get(publicProductId)
    ).toEqual({ name: 'Last Known Good' });
    expect(
      instance
        .prepare(
          'SELECT override_version FROM catalog_product_classification_overrides WHERE product_id=?1'
        )
        .get(publicProductId)
    ).toEqual({ override_version: 7 });
    expect(
      instance.prepare('SELECT COUNT(*) AS total FROM supplier_sync_stage_events').get().total
    ).toBe(1);
  });

  it('enforces run ownership, exact affected identity, JSON bounds and override provenance', () => {
    const instance = database();
    installV5(instance);
    seedCanonicalAndStage(instance);
    applyBatch(
      instance,
      tenantDataPlaneMigrationBatches({
        tenantId,
        source: source(),
        currentVersion: 5,
        targetVersion: 6
      })[0]
    );
    seedCandidate(instance);

    expect(() =>
      instance
        .prepare(
          `INSERT INTO supplier_sync_stage_product_details
            (run_id,album_source_id,public_product_id,detail_state)
           VALUES (?1,?2,'p_ffffffffffffffffffff','pending')`
        )
        .run(runId, albumSourceId)
    ).toThrow();
    expect(() =>
      instance
        .prepare(
          `UPDATE supplier_sync_stage_classification_state
              SET override_applied=0
            WHERE run_id=?1 AND public_product_id=?2`
        )
        .run(runId, publicProductId)
    ).toThrow();
    expect(() =>
      instance
        .prepare(
          `UPDATE supplier_sync_stage_catalog_meta SET value_json=?3
            WHERE run_id=?1 AND key=?2`
        )
        .run(
          runId,
          'merchandising',
          JSON.stringify('x'.repeat(TENANT_SYNC_CANDIDATE_JSON_MAX_BYTES))
        )
    ).toThrow();
    expect(instance.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('cleans candidate state by exact run while leaving canonical LKG and merchant truth intact', () => {
    const instance = database();
    applyBatch(instance, tenantDataPlaneCurrentBatch({ tenantId, source: source() }));
    seedCanonicalAndStage(instance);
    seedCandidate(instance);

    instance.prepare('DELETE FROM supplier_sync_stage_runs WHERE run_id=?1').run(runId);

    for (const table of TENANT_SYNC_CANDIDATE_TABLES) {
      expect(instance.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total).toBe(0);
    }
    expect(instance.prepare('SELECT COUNT(*) AS total FROM catalog_products').get().total).toBe(1);
    expect(
      instance
        .prepare('SELECT COUNT(*) AS total FROM catalog_product_classification_overrides')
        .get().total
    ).toBe(1);
  });

  it('rolls a failed v6 transaction back to the intact v5 authority', () => {
    const instance = database();
    installV5(instance);
    seedCanonicalAndStage(instance);
    const [batch] = tenantDataPlaneMigrationBatches({
      tenantId,
      source: source(),
      currentVersion: 5,
      targetVersion: 6
    });

    expect(() =>
      applyBatch(instance, [
        ...batch.slice(0, 5),
        { sql: 'INSERT INTO table_that_does_not_exist (value) VALUES (1)', params: [] },
        ...batch.slice(5)
      ])
    ).toThrow();
    expect(instance.prepare('SELECT schema_version FROM data_plane_identity').get()).toEqual({
      schema_version: 5
    });
    expect(
      instance
        .prepare('SELECT GROUP_CONCAT(version) AS versions FROM data_plane_schema_migrations')
        .get()
    ).toEqual({ versions: '1,2,3,4,5' });
    expect(
      instance
        .prepare(
          "SELECT COUNT(*) AS total FROM sqlite_master WHERE type='table' AND name LIKE 'supplier_sync_stage_product_%'"
        )
        .get().total
    ).toBe(0);
    expect(instance.prepare('SELECT name FROM catalog_products').get()).toEqual({
      name: 'Last Known Good'
    });
  });

  it('keeps private candidate tables and source evidence out of public runtime SQL', () => {
    const publicRuntime = [
      'worker/tenant-catalog-runtime.js',
      'worker/entry-publish.js',
      'worker/index.js'
    ]
      .map((file) => fs.readFileSync(file, 'utf8'))
      .join('\n');
    expect(publicRuntime).not.toContain('supplier_sync_stage_');
    expect(TENANT_DATA_PLANE_V6_STATEMENTS.join('\n')).not.toContain(sourceUrl);
  });

  it('keeps historical migration ranges valid and rejects impossible ranges', () => {
    expect(
      tenantDataPlaneMigrationBatches({
        tenantId,
        source: source(),
        currentVersion: 0,
        targetVersion: 6
      }).map((batch) => batch.at(-1).params[0])
    ).toEqual([1, 2, 3, 4, 5, 6]);
    expect(
      tenantDataPlaneMigrationBatches({
        tenantId,
        source: source(),
        currentVersion: 4,
        targetVersion: 5
      })
    ).toHaveLength(1);
    expect(() =>
      tenantDataPlaneMigrationBatches({
        tenantId,
        source: source(),
        currentVersion: 6,
        targetVersion: 5
      })
    ).toThrow('tenant_data_plane_migration_range_invalid');
  });

  it('keeps the cumulative static statement set executable for schema tooling', () => {
    const instance = database();
    for (const statement of TENANT_DATA_PLANE_CURRENT_STATEMENTS) instance.exec(statement);
    expect(
      instance
        .prepare(
          "SELECT COUNT(*) AS total FROM sqlite_master WHERE type='table' AND name LIKE 'supplier_sync_stage_%'"
        )
        .get().total
    ).toBe(16);
  });
});

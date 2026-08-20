import { createCatalogEvidence } from './evidence.js';

export function createTenantCatalogEvidence(row, context, categoryPathNames = []) {
  try {
    return createCatalogEvidence({
      recordId: row?.product_id || null,
      title: row?.source_name || row?.name || '',
      description: row?.description || '',
      sourceCategoryName: row?.source_category_name || row?.category_name || '',
      categoryPathNames,
      structuredAttributes: {},
      provenance: {
        providerKey: context?.provider || null,
        sourceKey: context?.source_key || null,
        sourceLocalId: row?.album_source_id || null
      }
    });
  } catch (error) {
    const wrapped = new Error('cei_runtime_evidence_invalid');
    wrapped.cause = error;
    throw wrapped;
  }
}

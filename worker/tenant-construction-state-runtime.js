import { DurableObject } from 'cloudflare:workers';
import {
  TenantConstructionState as LegacyTenantConstructionState,
  constructionProjection
} from './instant-catalog-construction.js';

export class TenantConstructionState extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.legacy = new LegacyTenantConstructionState(ctx);
  }

  async getProjection() {
    return constructionProjection(await this.legacy.readState());
  }

  async deleteState() {
    await this.ctx.storage.delete('state');
    return { ok: true };
  }

  async fetch(request) {
    return this.legacy.fetch(request);
  }
}

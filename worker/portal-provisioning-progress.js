const ACTIVE_IMPORT_STATUSES = new Set(['pending', 'queued', 'scanning', 'details', 'finalizing']);
const TERMINAL_FAILURE_STATUSES = new Set(['failed', 'cancelled']);

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function timestamp(value) {
  const text = String(value || '').trim();
  return text || null;
}

function automaticRetry(job) {
  const scheduledAt = timestamp(job?.next_attempt_at);
  if (!scheduledAt || job?.status !== 'failed') return null;
  return { kind: 'automatic', scheduledAt };
}

function base(stage, status, title, message, extra = {}) {
  return {
    version: 1,
    stage,
    status,
    title,
    message,
    counters: null,
    retry: null,
    updatedAt: null,
    pollAfterMs: status === 'running' || status === 'waiting' ? 8000 : 15000,
    ...extra
  };
}

function importCounters(job) {
  const discovered = number(job?.discovered_count);
  const queued = number(job?.queued_detail_count);
  const completed = number(job?.completed_detail_count);
  const failed = number(job?.failed_detail_count);
  const deferred = number(job?.deferred_detail_count);
  const published = number(job?.published_product_count);
  if (![discovered, queued, completed, failed, deferred, published].some((value) => value > 0)) {
    return null;
  }
  return { discovered, queued, completed, failed, deferred, published };
}

function classificationCounters(job) {
  const total = number(job?.product_count);
  const automatic = number(job?.automatic_count);
  const review = number(job?.review_count);
  const unknown = number(job?.unknown_count);
  const processed = Math.min(total || automatic + review + unknown, automatic + review + unknown);
  if (![total, processed, automatic, review, unknown].some((value) => value > 0)) return null;
  return { total, processed, automatic, review, unknown };
}

function verificationCounters(job) {
  const checked = number(job?.product_count);
  const findings = number(job?.finding_count);
  if (checked === 0 && findings === 0) return null;
  return { checked, findings };
}

function progressFromVerification(job) {
  if (!job) return null;
  const updatedAt = timestamp(job.updated_at || job.finished_at || job.started_at);
  const counters = verificationCounters(job);
  if (job.status === 'success') {
    if (number(job.finding_count) > 0) {
      return base(
        'checking',
        'attention',
        'Revisão concluída com itens para conferir',
        'O catálogo foi verificado, mas ainda existem itens que precisam de revisão antes das próximas etapas.',
        { counters, updatedAt, pollAfterMs: 30000 }
      );
    }
    return base(
      'ready',
      'complete',
      'Catálogo preparado',
      'A importação, a organização inicial e a verificação terminaram com sucesso.',
      { counters, updatedAt, pollAfterMs: 30000 }
    );
  }
  if (TERMINAL_FAILURE_STATUSES.has(job.status)) {
    return base(
      'checking',
      'attention',
      'A verificação precisa de atenção',
      job.status === 'failed' && job.next_attempt_at
        ? 'A última tentativa não terminou. O Catalog Engine fará uma nova tentativa automaticamente.'
        : 'A verificação não pôde continuar automaticamente. O trabalho já concluído foi preservado.',
      { counters, retry: automaticRetry(job), updatedAt, pollAfterMs: 15000 }
    );
  }
  return base(
    'checking',
    'running',
    'Conferindo o catálogo',
    'Estamos validando a organização e a consistência do catálogo antes das próximas etapas.',
    { counters, updatedAt }
  );
}

function progressFromClassification(job) {
  if (!job) return null;
  const updatedAt = timestamp(job.updated_at || job.finished_at || job.started_at);
  const counters = classificationCounters(job);
  if (job.status === 'success') {
    return base(
      'checking',
      'waiting',
      'Organização concluída',
      'Os produtos já foram organizados. A verificação final será iniciada automaticamente.',
      { counters, updatedAt }
    );
  }
  if (TERMINAL_FAILURE_STATUSES.has(job.status)) {
    return base(
      'organizing',
      'attention',
      'A organização precisa de atenção',
      job.status === 'failed' && job.next_attempt_at
        ? 'A última tentativa não terminou. O Catalog Engine fará uma nova tentativa automaticamente.'
        : 'A organização não pôde continuar automaticamente. O catálogo importado foi preservado.',
      { counters, retry: automaticRetry(job), updatedAt, pollAfterMs: 15000 }
    );
  }
  return base(
    'organizing',
    'running',
    'Organizando os produtos',
    'O Catalog Engine está organizando os produtos importados para a experiência da loja.',
    { counters, updatedAt }
  );
}

function progressFromImport(job) {
  if (!job) return null;
  const updatedAt = timestamp(job.updated_at || job.finished_at || job.started_at);
  const counters = importCounters(job);
  if (job.status === 'success') {
    return base(
      'organizing',
      'waiting',
      'Importação concluída',
      'Os produtos foram importados. A organização inicial será iniciada automaticamente.',
      { counters, updatedAt }
    );
  }
  if (TERMINAL_FAILURE_STATUSES.has(job.status)) {
    const stage = job.phase === 'finalize' ? 'finalizing' : job.phase === 'details' ? 'importing' : 'discovering';
    return base(
      stage,
      'attention',
      'A importação precisa de atenção',
      job.status === 'failed' && job.next_attempt_at
        ? 'Uma etapa não terminou. O Catalog Engine preservou o progresso e fará uma nova tentativa automaticamente.'
        : 'A importação não pôde continuar automaticamente. O progresso já confirmado foi preservado.',
      { counters, retry: automaticRetry(job), updatedAt, pollAfterMs: 15000 }
    );
  }
  if (job.status === 'finalizing' || job.phase === 'finalize') {
    return base(
      'finalizing',
      'running',
      'Finalizando a importação',
      'Os dados encontrados estão sendo consolidados com segurança antes da organização do catálogo.',
      { counters, updatedAt }
    );
  }
  if (job.status === 'details' || job.phase === 'details') {
    return base(
      'importing',
      'running',
      'Importando os produtos',
      'O Catalog Engine está processando os itens encontrados na fonte conectada.',
      { counters, updatedAt }
    );
  }
  return base(
    'discovering',
    ACTIVE_IMPORT_STATUSES.has(job.status) ? 'running' : 'waiting',
    'Lendo o catálogo conectado',
    'Estamos identificando os itens disponíveis antes de processar cada produto.',
    { counters, updatedAt }
  );
}

export function buildMerchantProvisioningProgress({
  provisioning = null,
  importJob = null,
  classificationJob = null,
  verificationJob = null
} = {}) {
  const verification = progressFromVerification(verificationJob);
  if (verification) return verification;
  const classification = progressFromClassification(classificationJob);
  if (classification) return classification;
  const importing = progressFromImport(importJob);
  if (importing) return importing;

  const step = String(provisioning?.current_step || '').trim();
  const status = String(provisioning?.status || '').trim();
  const updatedAt = timestamp(provisioning?.updated_at || provisioning?.started_at);

  if (['classify', 'verify'].includes(step)) {
    return base(
      step === 'verify' ? 'checking' : 'organizing',
      'waiting',
      step === 'verify' ? 'Preparando a verificação' : 'Preparando a organização',
      'A etapa anterior terminou e a próxima etapa será iniciada automaticamente.',
      { updatedAt }
    );
  }
  if (step === 'import') {
    return base(
      'discovering',
      status === 'failed' || status === 'blocked' ? 'attention' : 'waiting',
      status === 'failed' || status === 'blocked' ? 'A preparação precisa de atenção' : 'Importação autorizada',
      status === 'failed' || status === 'blocked'
        ? 'O trabalho já concluído foi preservado. O Catalog Engine está aguardando uma condição segura para continuar.'
        : 'A decisão de importação está salva. O processo inicial será iniciado automaticamente.',
      { updatedAt }
    );
  }
  if (['data_plane', 'migrations'].includes(step)) {
    return base(
      'preparing',
      status === 'failed' || status === 'blocked' ? 'attention' : 'running',
      status === 'failed' || status === 'blocked' ? 'A preparação precisa de atenção' : 'Preparando sua loja',
      status === 'failed' || status === 'blocked'
        ? 'A configuração foi preservada e poderá continuar sem recriar sua loja.'
        : 'Estamos preparando a estrutura necessária para receber o catálogo com segurança.',
      { updatedAt }
    );
  }
  if (['domain', 'publish'].includes(step) || status === 'success') {
    return base(
      'ready',
      'complete',
      'Catálogo preparado',
      'As etapas de preparação do catálogo foram concluídas.',
      { updatedAt, pollAfterMs: 30000 }
    );
  }
  return base(
    'source',
    'waiting',
    'Aguardando o catálogo',
    'Conecte e confirme a fonte do catálogo para iniciar a preparação.',
    { updatedAt }
  );
}

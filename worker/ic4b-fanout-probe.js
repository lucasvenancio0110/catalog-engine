const HOLD_MS = 1500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function messageId(body) {
  const candidate = String(body?.id ?? body ?? '').trim();
  return /^m_[0-9]{1,3}$/.test(candidate) ? candidate : null;
}

async function enter(env) {
  await env.PROBE_DB.prepare(
    `UPDATE probe_state
        SET active=active+1,
            max_active=CASE WHEN active+1>max_active THEN active+1 ELSE max_active END,
            updated_at_ms=?1
      WHERE id=1`
  )
    .bind(Date.now())
    .run();
}

async function leave(env, id) {
  const now = Date.now();
  await env.PROBE_DB.batch([
    env.PROBE_DB.prepare(
      `INSERT INTO probe_messages (message_id,completed_at_ms)
       VALUES (?1,?2)
       ON CONFLICT(message_id) DO UPDATE SET completed_at_ms=excluded.completed_at_ms`
    ).bind(id, now),
    env.PROBE_DB.prepare(
      `UPDATE probe_state
          SET active=CASE WHEN active>0 THEN active-1 ELSE 0 END,
              completed=completed+1,
              updated_at_ms=?1
        WHERE id=1`
    ).bind(now)
  ]);
}

export default {
  async queue(batch, env) {
    for (const message of batch.messages) {
      const id = messageId(message.body);
      if (!id) {
        message.retry({ delaySeconds: 30 });
        continue;
      }

      let entered = false;
      try {
        await enter(env);
        entered = true;
        await sleep(HOLD_MS);
        await leave(env, id);
        entered = false;
        message.ack();
      } catch {
        if (entered) {
          await env.PROBE_DB.prepare(
            `UPDATE probe_state
                SET active=CASE WHEN active>0 THEN active-1 ELSE 0 END,
                    updated_at_ms=?1
              WHERE id=1`
          )
            .bind(Date.now())
            .run()
            .catch(() => {});
        }
        message.retry({ delaySeconds: 30 });
      }
    }
  }
};

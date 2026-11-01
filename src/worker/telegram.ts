import { isHosted } from './auth';
import type { Env } from './env';

const WINDOW_MS = 5 * 60_000;
const BASELINE_WINDOWS = 12;
const MIN_VISITORS = 10;
const SPIKE_MULTIPLIER = 3;
const ALERT_COOLDOWN_MS = 60 * 60_000;

interface ActivityRow {
  site_id: string;
  name: string;
  domain: string;
  bucket: number;
  visitors: number;
  last_alert_at: number | null;
}

interface TrafficSpike {
  siteId: string;
  name: string;
  domain: string;
  visitors: number;
  baseline: number;
}

export function findTrafficSpikes(rows: ActivityRow[], windowEnd: number, now = Date.now()): TrafficSpike[] {
  const currentBucket = Math.floor(windowEnd / WINDOW_MS) - 1;
  const sites = new Map<string, { name: string; domain: string; lastAlertAt: number | null; buckets: Map<number, number> }>();

  for (const row of rows) {
    let site = sites.get(row.site_id);
    if (!site) {
      site = { name: row.name, domain: row.domain, lastAlertAt: row.last_alert_at, buckets: new Map() };
      sites.set(row.site_id, site);
    }
    site.buckets.set(row.bucket, row.visitors);
  }

  const spikes: TrafficSpike[] = [];
  for (const [siteId, site] of sites) {
    const visitors = site.buckets.get(currentBucket) ?? 0;
    let baselineVisitors = 0;
    for (let bucket = currentBucket - BASELINE_WINDOWS; bucket < currentBucket; bucket++) {
      baselineVisitors += site.buckets.get(bucket) ?? 0;
    }
    const baseline = baselineVisitors / BASELINE_WINDOWS;
    if (
      visitors >= Math.max(MIN_VISITORS, Math.ceil(baseline * SPIKE_MULTIPLIER)) &&
      (site.lastAlertAt === null || site.lastAlertAt < now - ALERT_COOLDOWN_MS)
    ) {
      spikes.push({ siteId, name: site.name, domain: site.domain, visitors, baseline });
    }
  }
  return spikes;
}

function alertMessage(spike: TrafficSpike): string {
  const site = `${spike.name} (${spike.domain})`.replace(/[\r\n\t]/g, ' ').slice(0, 200);
  return `Traffic spike on ${site}\n${spike.visitors} unique visitors in the last 5 minutes.\nRecent baseline: ${spike.baseline.toFixed(1)} per 5 minutes (previous hour).`;
}

export async function sendTrafficAlerts(env: Env): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = env.TELEGRAM_CHAT_ID?.trim();
  if (!token && !chatId) return;
  if (!token || !chatId) throw new Error('Set both TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to enable Telegram alerts.');
  if (isHosted(env)) throw new Error('Telegram alerts are only supported in self-hosted mode.');

  const now = Date.now();
  const windowEnd = Math.floor(now / WINDOW_MS) * WINDOW_MS;
  const from = windowEnd - (BASELINE_WINDOWS + 1) * WINDOW_MS;
  const { results } = await env.DB.prepare(
    `SELECT s.site_id, st.name, st.domain, CAST(s.started_at / ? AS INTEGER) AS bucket,
            COUNT(DISTINCT s.visitor_id) AS visitors, a.last_alert_at
     FROM sessions s
     JOIN sites st ON st.id = s.site_id
     LEFT JOIN telegram_alert_state a ON a.site_id = s.site_id
     WHERE s.started_at >= ? AND s.started_at < ?
     GROUP BY s.site_id, bucket`,
  )
    .bind(WINDOW_MS, from, windowEnd)
    .all<ActivityRow>();

  for (const spike of findTrafficSpikes(results, windowEnd, now)) {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: alertMessage(spike) }),
    });
    if (!response.ok) throw new Error(`Telegram sendMessage failed with HTTP ${response.status}.`);
    const result = await response.json<{ ok: boolean; description?: string }>();
    if (!result.ok) throw new Error(`Telegram sendMessage failed: ${result.description ?? 'unknown error'}.`);

    await env.DB.prepare(
      `INSERT INTO telegram_alert_state (site_id, last_alert_at) VALUES (?, ?)
       ON CONFLICT(site_id) DO UPDATE SET last_alert_at = excluded.last_alert_at`,
    )
      .bind(spike.siteId, now)
      .run();
  }
}

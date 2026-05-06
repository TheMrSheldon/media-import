import { config } from '../config.js';

function authHeader(): Record<string, string> {
  if (!config.tvheadendUser) return {};
  const encoded = Buffer.from(`${config.tvheadendUser}:${config.tvheadendPass}`).toString('base64');
  return { Authorization: `Basic ${encoded}` };
}

export async function tvhGet(path: string): Promise<unknown> {
  if (!config.tvheadendUrl) throw new Error('TVHeadend not configured');
  const res = await fetch(`${config.tvheadendUrl}${path}`, {
    headers: { ...authHeader() },
  });
  if (!res.ok) throw new Error(`TVHeadend returned ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function tvhPost(path: string, params: Record<string, string>): Promise<unknown> {
  if (!config.tvheadendUrl) throw new Error('TVHeadend not configured');
  const body = new URLSearchParams(params).toString();
  const res = await fetch(`${config.tvheadendUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...authHeader() },
    body,
  });
  if (!res.ok) throw new Error(`TVHeadend returned ${res.status}: ${await res.text()}`);
  return res.json();
}

let cachedDvrUuid: string | null = null;

export async function getDvrUuid(): Promise<string> {
  if (config.tvheadendDvrUuid) return config.tvheadendDvrUuid;
  if (cachedDvrUuid) return cachedDvrUuid;
  const data = await tvhGet('/api/dvr/config/grid?limit=1') as { entries: Array<{ uuid: string }> };
  const uuid = data.entries?.[0]?.uuid;
  if (!uuid) throw new Error('No DVR configuration found in TVHeadend');
  cachedDvrUuid = uuid;
  return uuid;
}

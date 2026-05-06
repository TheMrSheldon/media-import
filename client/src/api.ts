// Injected at runtime by Express via /_config.js; falls back to '' (= root) in dev
const BASE = ((window as unknown as Record<string, unknown>)._basePath as string ?? '/').replace(/\/$/, '');

export interface MediathekResult {
  id: string;
  channel: string;
  topic: string;
  title: string;
  description: string;
  duration: number;
  timestamp: number;
  url_video: string;
  url_video_hd: string;
  url_video_low: string;
  size: number;
}

export interface ImdbResult {
  imdbId: string;
  title: string;
  year?: number;
  type?: string;
  poster?: string;
}

export interface ImportRequest {
  videoUrl: string;
  title: string;
  year: number;
  imdbId: string;
  mediaType: 'movie' | 'series';
  seriesTitle?: string;
  season?: number;
  episode?: number;
  episodeTitle?: string;
}

export interface Job {
  id: string;
  title: string;
  phase: 'queued' | 'downloading' | 'transcoding' | 'moving' | 'done' | 'error';
  percent: number;
  message: string;
  downloadedBytes: number | null;
  command: string | null;
  createdAt: number;
}

export async function searchMediathek(query: string): Promise<MediathekResult[]> {
  const res = await fetch(`${BASE}/api/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, size: 25 }),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data?.result?.results ?? [];
}

export async function searchImdb(q: string): Promise<ImdbResult[]> {
  const res = await fetch(`${BASE}/api/imdb?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function startImport(req: ImportRequest): Promise<{ jobId: string }> {
  const res = await fetch(`${BASE}/api/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? res.statusText);
  }
  return res.json();
}

export async function getJobLog(id: string): Promise<string> {
  const res = await fetch(`${BASE}/api/jobs/${id}/log`);
  if (!res.ok) return '';
  return res.text();
}

export async function dismissJob(id: string): Promise<void> {
  await fetch(`${BASE}/api/jobs/${id}`, { method: 'DELETE' });
}

export async function listJobs(): Promise<Job[]> {
  const res = await fetch(`${BASE}/api/jobs`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getFileSize(url: string): Promise<number | null> {
  const res = await fetch(`${BASE}/api/filesize?url=${encodeURIComponent(url)}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.size ?? null;
}

export function watchJob(jobId: string, onUpdate: (data: { phase: string; percent: number; message: string; downloadedBytes: number | null }) => void): () => void {
  const es = new EventSource(`${BASE}/api/jobs/${jobId}/events`);
  es.onmessage = (e) => {
    try {
      onUpdate(JSON.parse(e.data));
    } catch {/* ignore */}
  };
  return () => es.close();
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

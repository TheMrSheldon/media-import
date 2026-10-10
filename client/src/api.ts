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

export interface TVGuideResult {
  eventId: number;
  channelName: string;
  title: string;
  subtitle?: string;        // episode title
  summary?: string;         // short description
  description?: string;     // full description
  start: number;
  stop: number;
  hd: boolean;
  episodeOnscreen?: string; // e.g. "S01E05" or "1/5"
  image?: string;
  dvrState?: string;        // "scheduled" | "recording" | "completed" etc.
}

export interface DvrEntry {
  uuid: string;
  title: string;
  channelName: string;
  start: number;
  stop: number;
  status: 'scheduled' | 'recording' | 'completed' | 'missed' | 'invalid';
  filename?: string;
  filesize?: number;
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
  asFolder?: boolean;
  force?: boolean;
}

export interface Job {
  id: string;
  title: string;
  phase: 'queued' | 'cutting' | 'downloading' | 'transcoding' | 'moving' | 'done' | 'error';
  percent: number;
  message: string;
  downloadedBytes: number | null;
  command: string | null;
  createdAt: number;
  overwriteAvoided?: boolean;
  downloadable?: boolean;
}

export interface CutSegment { start: number; end: number; }

export interface CutImportRequest {
  filename: string;
  segments: CutSegment[];
  title: string;
  year: number;
  imdbId: string;
  mediaType: 'movie' | 'series';
  seriesTitle?: string;
  season?: number;
  episode?: number;
  episodeTitle?: string;
  asFolder?: boolean;
  force?: boolean;
}

export type ExtraType =
  | 'trailer'
  | 'behindthescenes'
  | 'deleted'
  | 'interview'
  | 'scene'
  | 'short'
  | 'featurette'
  | 'other';

export interface ExtraFile {
  file: File;
  type: ExtraType;
}

export interface UploadRequest {
  title: string;
  year: number;
  imdbId: string;
  mediaType: 'movie' | 'series';
  seriesTitle?: string;
  season?: number;
  episode?: number;
  episodeTitle?: string;
  asFolder?: boolean;
  transcode?: boolean;
  destinationId: string;
  force?: boolean;
}

export class ConflictError extends Error {
  conflict = true;
  existingPath: string;
  suggestedPath?: string;
  constructor(path: string, suggestedPath?: string) {
    super(`File already exists in the library`);
    this.existingPath = path;
    this.suggestedPath = suggestedPath;
  }
}

export interface UncutFile { name: string; mtime: number; size: number; }

export interface ArdItem {
  id: string;
  title: string;
  summary: string;
  duration: number;
  publishDate: string;
  imageUrl: string | null;
  downloadUrl: string | null;
  mimeType: string | null;
  showTitle: string | null;
  programSetId: string | null;
}

export async function listUncutFiles(): Promise<UncutFile[]> {
  const res = await fetch(`${BASE}/api/cut/files`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? res.statusText);
  const data = await res.json();
  return data.files as UncutFile[];
}

export async function getUncutDuration(filename: string): Promise<number> {
  const res = await fetch(`${BASE}/api/cut/duration/${encodeURIComponent(filename)}`);
  if (!res.ok) return 0;
  const data = await res.json();
  return data.duration ?? 0;
}


export async function startCutImport(req: CutImportRequest): Promise<{ jobId: string }> {
  const res = await fetch(`${BASE}/api/cut/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    if (res.status === 409) throw new ConflictError(err.existingPath ?? '', err.suggestedPath);
    throw new Error(err.detail ?? res.statusText);
  }
  return res.json();
}

export function frameUrl(filename: string, t: number): string {
  return `${BASE}/api/cut/frame/${encodeURIComponent(filename)}?t=${t.toFixed(6)}`;
}

export function uncutStreamUrl(filename: string, seek = 0): string {
  const q = seek > 0 ? `?seek=${seek}` : '';
  return `${BASE}/api/cut/stream/${encodeURIComponent(filename)}${q}`;
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

export async function listRecordings(): Promise<DvrEntry[]> {
  const res = await fetch(`${BASE}/api/recordings`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? res.statusText);
  return res.json();
}

export async function searchTVGuide(q: string): Promise<TVGuideResult[]> {
  const res = await fetch(`${BASE}/api/tvguide?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? res.statusText);
  return res.json();
}

export async function recordTV(entry: {
  channelName: string;
  start: number;
  stop: number;
  title?: string;
}): Promise<{ uuid: string }> {
  const res = await fetch(`${BASE}/api/recordings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.detail ?? res.statusText);
  }
  return res.json();
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
    if (res.status === 409) throw new ConflictError(err.existingPath ?? '', err.suggestedPath);
    throw new Error(err.detail ?? res.statusText);
  }
  return res.json();
}

export interface UploadDestination { id: string; label: string; path: string; }

export async function listUploadDestinations(): Promise<UploadDestination[]> {
  const res = await fetch(`${BASE}/api/upload/destinations`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  return res.json();
}

export interface LibraryPaths { movieBaseDir: string; seriesBaseDir: string; }

export async function getLibraryPaths(): Promise<LibraryPaths> {
  const res = await fetch(`${BASE}/api/library`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export function startUpload(
  fields: UploadRequest,
  mainFile: File,
  extras: ExtraFile[],
  onProgress: (percent: number) => void,
): Promise<{ jobIds: string[] }> {
  const form = new FormData();
  form.append('title', fields.title);
  form.append('year', String(fields.year));
  form.append('imdbId', fields.imdbId);
  form.append('mediaType', fields.mediaType);
  if (fields.seriesTitle) form.append('seriesTitle', fields.seriesTitle);
  if (fields.season !== undefined) form.append('season', String(fields.season));
  if (fields.episode !== undefined) form.append('episode', String(fields.episode));
  if (fields.episodeTitle) form.append('episodeTitle', fields.episodeTitle);
  form.append('asFolder', String(fields.asFolder ?? false));
  form.append('transcode', String(fields.transcode ?? false));
  form.append('destinationId', fields.destinationId);
  if (fields.force) form.append('force', 'true');
  form.append('file', mainFile);
  form.append('extras', JSON.stringify(extras.map((e) => ({ type: e.type }))));
  for (const e of extras) form.append('extraFiles', e.file);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE}/api/upload`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let body: any = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body);
      } else if (xhr.status === 409) {
        reject(new ConflictError(body.existingPath ?? '', body.suggestedPath));
      } else {
        reject(new Error(body.error ?? xhr.statusText));
      }
    };
    xhr.onerror = () => reject(new Error('Upload failed'));
    xhr.send(form);
  });
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

export function watchJob(jobId: string, onUpdate: (data: { phase: string; percent: number; message: string; downloadedBytes: number | null; overwriteAvoided?: boolean }) => void): () => void {
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

export function formatTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export async function searchAudiobook(q: string): Promise<ArdItem[]> {
  const res = await fetch(`${BASE}/api/audiobook/search?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? res.statusText);
  const data = await res.json();
  return data.items as ArdItem[];
}

export async function startAudiobookImport(item: ArdItem): Promise<{ jobId: string }> {
  const res = await fetch(`${BASE}/api/audiobook/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? res.statusText);
  return res.json();
}

export async function fetchShowEpisodes(programSetId: string): Promise<ArdItem[]> {
  const res = await fetch(`${BASE}/api/audiobook/episodes/${encodeURIComponent(programSetId)}`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? res.statusText);
  const data = await res.json();
  return data.episodes as ArdItem[];
}

export async function fetchShowCount(programSetId: string): Promise<number> {
  const res = await fetch(`${BASE}/api/audiobook/count/${encodeURIComponent(programSetId)}`);
  if (!res.ok) return 0;
  const data = await res.json();
  return data.count ?? 0;
}

export async function startShowImport(
  programSetId: string,
  title: string,
  imageUrl: string | null,
  episodes?: ArdItem[],
): Promise<{ jobId: string }> {
  const res = await fetch(`${BASE}/api/audiobook/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ programSetId, title, imageUrl, episodes }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? res.statusText);
  return res.json();
}

export function audiobookDownloadUrl(jobId: string): string {
  return `${BASE}/api/audiobook/jobs/${jobId}/file`;
}

export async function cleanupAudiobookJob(jobId: string): Promise<void> {
  await fetch(`${BASE}/api/audiobook/jobs/${jobId}`, { method: 'DELETE' });
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

import { Response } from 'express';
import { randomUUID } from 'crypto';
import { readFile, writeFile, mkdir, unlink, access } from 'fs/promises';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { config } from './config.js';

export type JobPhase = 'queued' | 'cutting' | 'downloading' | 'transcoding' | 'moving' | 'done' | 'error';

export interface Job {
  id: string;
  title: string;
  phase: JobPhase;
  percent: number;
  message: string;
  downloadedBytes: number | null;
  command: string | null;
  createdAt: number;
  overwriteAvoided?: boolean;
  downloadable?: boolean;
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
}

const jobs = new Map<string, Job>();
const subscribers = new Map<string, Response[]>();
const logs = new Map<string, string[]>(); // not persisted — lost on restart
// Temp files that belong to done audiobook jobs, cleaned up on deleteJob
const pendingFiles = new Map<string, string>();

const JOBS_FILE = join(config.dataDir, 'jobs.json');
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await mkdir(config.dataDir, { recursive: true });
      await writeFile(JOBS_FILE, JSON.stringify([...jobs.values()], null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to persist jobs:', err);
    }
  }, 1000);
}

export function flushJobs() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  try {
    mkdirSync(config.dataDir, { recursive: true });
    writeFileSync(JOBS_FILE, JSON.stringify([...jobs.values()], null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to flush jobs on shutdown:', err);
  }
}

export async function initJobs() {
  try {
    const raw = await readFile(JOBS_FILE, 'utf-8');
    const loaded = JSON.parse(raw) as Job[];
    const terminal: JobPhase[] = ['done', 'error'];
    for (const job of loaded) {
      if (!terminal.includes(job.phase)) {
        job.phase = 'error';
        job.message = 'Interrupted by server restart';
      }
      // For done jobs, check if the output M4B still exists regardless of the
      // persisted downloadable flag (it may have been cleared by a previous restart).
      if (job.phase === 'done') {
        const filePath = join(config.tempDir, `${job.id}_output.m4b`);
        const exists = await access(filePath).then(() => true).catch(() => false);
        if (exists) {
          pendingFiles.set(job.id, filePath);
          job.downloadable = true;
        } else {
          job.downloadable = false;
        }
      }
      jobs.set(job.id, job);
      subscribers.set(job.id, []);
    }
    console.log(`  Jobs    → loaded ${loaded.length} from disk`);
  } catch {
    // File doesn't exist yet — that's fine
  }
}

export function createJob(title: string): Job {
  const job: Job = {
    id: randomUUID(),
    title,
    phase: 'queued',
    percent: 0,
    message: 'Queued',
    downloadedBytes: null,
    command: null,
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);
  subscribers.set(job.id, []);
  scheduleSave();
  return job;
}

// Mark a completed job as having a downloadable file.
// The file is automatically cleaned up when the job is deleted.
export function setPendingFile(id: string, filePath: string): void {
  pendingFiles.set(id, filePath);
  updateJob(id, { downloadable: true });
}

export function getPendingFile(id: string): string | undefined {
  return pendingFiles.get(id);
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function listJobs(): Job[] {
  return [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export function appendLog(id: string, line: string) {
  let lines = logs.get(id);
  if (!lines) { lines = []; logs.set(id, lines); }
  lines.push(line);
}

export function getLog(id: string): string {
  return (logs.get(id) ?? []).join('\n');
}

export function deleteJob(id: string): boolean {
  if (!jobs.has(id)) return false;
  const filePath = pendingFiles.get(id);
  if (filePath) {
    pendingFiles.delete(id);
    unlink(filePath).catch(() => {});
  }
  jobs.delete(id);
  subscribers.delete(id);
  logs.delete(id);
  scheduleSave();
  return true;
}

export function updateJob(id: string, patch: Partial<Omit<Job, 'id' | 'createdAt'>>) {
  const job = jobs.get(id);
  if (!job) return;
  Object.assign(job, patch);
  scheduleSave();
  emit(id);
}

export function subscribe(id: string, res: Response) {
  const list = subscribers.get(id);
  if (list) list.push(res);
  res.on('close', () => unsubscribe(id, res));
}

function unsubscribe(id: string, res: Response) {
  const list = subscribers.get(id);
  if (!list) return;
  const idx = list.indexOf(res);
  if (idx !== -1) list.splice(idx, 1);
}

function emit(id: string) {
  const job = jobs.get(id);
  const list = subscribers.get(id);
  if (!job || !list) return;
  const data = JSON.stringify({
    phase: job.phase,
    percent: job.percent,
    message: job.message,
    downloadedBytes: job.downloadedBytes,
    overwriteAvoided: job.overwriteAvoided,
    downloadable: job.downloadable ?? false,
  });
  for (const res of list) {
    res.write(`data: ${data}\n\n`);
  }
}

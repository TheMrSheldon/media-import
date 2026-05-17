import { Router, Request, Response } from 'express';
import { createReadStream, existsSync } from 'fs';
import { unlink, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { spawn } from 'child_process';
import { config } from '../config.js';
import { createJob, updateJob, getJob, appendLog, setPendingFile, getPendingFile } from '../jobs.js';
import { downloadFile } from '../services/downloader.js';
import { searchArdAudiothek, fetchProgramSetEpisodes, type ArdItem } from '../services/ardaudiothek.js';
import { problem } from '../problem.js';

const router = Router();

router.get('/search', async (req: Request, res: Response) => {
  const q = ((req.query.q as string) ?? '').trim();
  if (!q) { res.json({ items: [] }); return; }
  try {
    const items = await searchArdAudiothek(q);
    res.json({ items });
  } catch (e: any) {
    problem(res, 502, '/problems/upstream-error', 'Search failed', e.message);
  }
});

router.get('/episodes/:programSetId', async (req: Request, res: Response) => {
  try {
    const episodes = await fetchProgramSetEpisodes(req.params.programSetId);
    res.json({ episodes });
  } catch (e: any) {
    problem(res, 502, '/problems/upstream-error', 'Failed to fetch episodes', e.message);
  }
});

// POST /api/audiobook/jobs — create an M4B conversion job.
// Body with `item`         → single-episode job.
// Body with `programSetId` → full-show job (optional `episodes` array to limit selection).
router.post('/jobs', async (req: Request, res: Response) => {
  if (req.body?.item) {
    const item = req.body.item as ArdItem;
    if (!item?.id || !item?.title || !item?.downloadUrl) {
      problem(res, 400, '/problems/missing-fields', 'Missing required fields',
        'item.id, item.title, and item.downloadUrl are required');
      return;
    }
    const job = createJob(item.title);
    res.status(201).json({ jobId: job.id });
    runSinglePipeline(job.id, item).catch((err: Error) => {
      updateJob(job.id, { phase: 'error', message: err.message });
    });
  } else if (req.body?.programSetId) {
    const { programSetId, title, imageUrl, episodes } = req.body as {
      programSetId: string;
      title: string;
      imageUrl?: string | null;
      episodes?: ArdItem[];
    };
    if (!title) {
      problem(res, 400, '/problems/missing-fields', 'Missing required fields', 'title is required');
      return;
    }
    const job = createJob(title);
    res.status(201).json({ jobId: job.id });
    runShowPipeline(job.id, programSetId, title, imageUrl ?? null, episodes?.length ? episodes : undefined).catch((err: Error) => {
      updateJob(job.id, { phase: 'error', message: err.message });
    });
  } else {
    problem(res, 400, '/problems/missing-fields', 'Missing required fields',
      'Provide either item (single episode) or programSetId (full show)');
  }
});

// File is kept until the job is dismissed — supports multiple downloads.
router.get('/jobs/:jobId/file', (req: Request, res: Response) => {
  const { jobId } = req.params;
  const job = getJob(jobId);
  if (!job) {
    problem(res, 404, '/problems/not-found', 'Job not found', `No job with ID ${jobId} exists`);
    return;
  }
  if (job.phase !== 'done') {
    problem(res, 409, '/problems/not-ready', 'Job not done yet', `Job is currently in phase: ${job.phase}`);
    return;
  }

  const outputPath = getPendingFile(jobId);
  if (!outputPath || !existsSync(outputPath)) {
    problem(res, 410, '/problems/gone', 'File no longer available',
      'The file may have been removed after a server restart — re-import to regenerate it');
    return;
  }

  const safeName = job.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim() || 'audiobook';
  res.setHeader('Content-Type', 'audio/mp4');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}.m4b`);

  const stream = createReadStream(outputPath);
  stream.on('error', (e) => { if (!res.headersSent) res.status(500).end(); else res.destroy(e); });
  stream.pipe(res);
  // No cleanup here — file persists for subsequent downloads until job is dismissed.
});

// ─── Single-episode pipeline ────────────────────────────────────────────────

async function runSinglePipeline(jobId: string, item: ArdItem): Promise<void> {
  await mkdir(config.tempDir, { recursive: true });

  const isAac = /mp4|aac|m4a/i.test(item.mimeType ?? '');
  const audioPath = join(config.tempDir, `${jobId}_audio${isAac ? '.m4a' : '.mp3'}`);
  const coverPath = join(config.tempDir, `${jobId}_cover.jpg`);
  const outputPath = join(config.tempDir, `${jobId}_output.m4b`);
  let hasCover = false;

  try {
    updateJob(jobId, { phase: 'downloading', percent: 0, message: 'Downloading audio…' });
    await downloadFile(item.downloadUrl!, audioPath, (pct, received) => {
      updateJob(jobId, { percent: pct, message: `Downloading… ${pct}%`, downloadedBytes: received });
    });

    if (item.imageUrl) {
      try { await downloadFile(item.imageUrl, coverPath, () => {}); hasCover = true; } catch { /* optional */ }
    }

    updateJob(jobId, { phase: 'transcoding', percent: 0, message: 'Creating M4B…' });

    const year = item.publishDate ? String(new Date(item.publishDate).getFullYear()) : '';
    const args = buildSingleFfmpegArgs({
      audioPath,
      coverPath: hasCover ? coverPath : null,
      outputPath,
      isAac,
      meta: { title: item.title, artist: item.showTitle ?? '', album: item.showTitle ?? '', date: year, comment: item.summary, genre: 'Hörbuch' },
    });
    updateJob(jobId, { command: `ffmpeg ${args.join(' ')}` });
    await runFfmpeg(jobId, args);

    await unlink(audioPath).catch(() => {});
    if (hasCover) await unlink(coverPath).catch(() => {});

    setPendingFile(jobId, outputPath);
    updateJob(jobId, { phase: 'done', percent: 100, message: 'Ready — click Download' });
  } catch (err) {
    await unlink(audioPath).catch(() => {});
    await unlink(coverPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
    throw err;
  }
}

// ─── Full-show pipeline ──────────────────────────────────────────────────────

async function runShowPipeline(
  jobId: string,
  programSetId: string,
  showTitle: string,
  imageUrl: string | null,
  preselectedEpisodes?: ArdItem[],
): Promise<void> {
  await mkdir(config.tempDir, { recursive: true });

  updateJob(jobId, { phase: 'downloading', percent: 0, message: 'Fetching episode list…' });
  const episodes = preselectedEpisodes ?? await fetchProgramSetEpisodes(programSetId);
  if (episodes.length === 0) throw new Error('No downloadable episodes found for this show');

  const audioPaths: string[] = [];
  const coverPath = join(config.tempDir, `${jobId}_cover.jpg`);
  const filelistPath = join(config.tempDir, `${jobId}_filelist.txt`);
  const metadataPath = join(config.tempDir, `${jobId}_metadata.txt`);
  const outputPath = join(config.tempDir, `${jobId}_output.m4b`);
  let hasCover = false;

  try {
    for (let i = 0; i < episodes.length; i++) {
      const ep = episodes[i];
      const isAac = /mp4|aac|m4a/i.test(ep.mimeType ?? '');
      const audioPath = join(config.tempDir, `${jobId}_ep${String(i).padStart(3, '0')}${isAac ? '.m4a' : '.mp3'}`);
      audioPaths.push(audioPath);

      await downloadFile(ep.downloadUrl!, audioPath, (pct, received) => {
        const base = Math.round((i / episodes.length) * 80);
        const contrib = Math.round((pct / 100) * (80 / episodes.length));
        updateJob(jobId, {
          percent: base + contrib,
          message: `Downloading episode ${i + 1}/${episodes.length}… ${pct}%`,
          downloadedBytes: received,
        });
      });
    }

    const coverSrc = imageUrl ?? episodes[0]?.imageUrl;
    if (coverSrc) {
      try { await downloadFile(coverSrc, coverPath, () => {}); hasCover = true; } catch { /* optional */ }
    }

    await writeFile(
      filelistPath,
      audioPaths.map((p) => `file '${p.replaceAll("'", "'\\''")}'`).join('\n'),
      'utf-8',
    );

    const year = episodes[0]?.publishDate ? String(new Date(episodes[0].publishDate).getFullYear()) : '';
    await writeFile(
      metadataPath,
      buildFfmetadata(
        { title: showTitle, artist: episodes[0]?.showTitle ?? '', album: showTitle, date: year, genre: 'Hörbuch' },
        episodes.map((ep) => ({ title: ep.title, duration: ep.duration })),
      ),
      'utf-8',
    );

    updateJob(jobId, { phase: 'transcoding', percent: 80, message: 'Creating M4B…' });
    const allAac = episodes.every((ep) => /mp4|aac|m4a/i.test(ep.mimeType ?? ''));
    const args = buildShowFfmpegArgs({ filelistPath, coverPath: hasCover ? coverPath : null, metadataPath, outputPath, allAac });
    updateJob(jobId, { command: `ffmpeg ${args.join(' ')}` });
    await runFfmpeg(jobId, args, 80, 99);

    for (const p of audioPaths) await unlink(p).catch(() => {});
    if (hasCover) await unlink(coverPath).catch(() => {});
    await unlink(filelistPath).catch(() => {});
    await unlink(metadataPath).catch(() => {});

    // Verify output duration is close to the sum of declared episode durations (±5 %).
    const expectedSec = episodes.reduce((s, ep) => s + ep.duration, 0);
    const actualSec = await probeDuration(outputPath);
    if (actualSec !== null && expectedSec > 0) {
      const drift = Math.abs(actualSec - expectedSec) / expectedSec;
      if (drift > 0.05) {
        appendLog(jobId, `WARNING: output duration ${actualSec.toFixed(1)}s differs from expected ${expectedSec}s (${(drift * 100).toFixed(1)}%)`);
      }
    }

    setPendingFile(jobId, outputPath);
    const doneMsg = actualSec !== null
      ? `Ready — ${formatDuration(actualSec)} (expected ${formatDuration(expectedSec)})`
      : 'Ready — click Download';
    updateJob(jobId, { phase: 'done', percent: 100, message: doneMsg });
  } catch (err) {
    for (const p of audioPaths) await unlink(p).catch(() => {});
    await unlink(coverPath).catch(() => {});
    await unlink(filelistPath).catch(() => {});
    await unlink(metadataPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
    throw err;
  }
}

// ─── FFmpeg argument builders ────────────────────────────────────────────────

function buildSingleFfmpegArgs(opts: {
  audioPath: string;
  coverPath: string | null;
  outputPath: string;
  isAac: boolean;
  meta: Record<string, string>;
}): string[] {
  const { audioPath, coverPath, outputPath, isAac, meta } = opts;
  const args: string[] = ['-y'];

  if (coverPath) {
    args.push('-i', audioPath, '-i', coverPath);
    args.push('-map', '0:a', '-map', '1:v');
    args.push('-c:a', isAac ? 'copy' : 'aac');
    if (!isAac) args.push('-b:a', '128k');
    args.push('-c:v', 'copy', '-disposition:v:0', 'attached_pic');
  } else {
    args.push('-i', audioPath, '-map', '0:a');
    args.push('-c:a', isAac ? 'copy' : 'aac');
    if (!isAac) args.push('-b:a', '128k');
  }

  args.push('-movflags', '+faststart');
  for (const [k, v] of Object.entries(meta)) {
    if (v) args.push('-metadata', `${k}=${v}`);
  }
  args.push(outputPath);
  return args;
}

function buildShowFfmpegArgs(opts: {
  filelistPath: string;
  coverPath: string | null;
  metadataPath: string;
  outputPath: string;
  allAac: boolean;
}): string[] {
  const { filelistPath, coverPath, metadataPath, outputPath, allAac } = opts;
  const args: string[] = ['-y', '-f', 'concat', '-safe', '0', '-i', filelistPath];

  if (coverPath) args.push('-i', coverPath);
  args.push('-f', 'ffmetadata', '-i', metadataPath);

  const metaIdx = coverPath ? 2 : 1;
  args.push('-map', '0:a');
  if (coverPath) {
    args.push('-map', '1:v', '-c:v', 'copy', '-disposition:v:0', 'attached_pic');
  }
  args.push('-c:a', allAac ? 'copy' : 'aac');
  if (!allAac) args.push('-b:a', '128k');
  args.push('-map_metadata', String(metaIdx));
  args.push('-movflags', '+faststart');
  args.push(outputPath);
  return args;
}

function buildFfmetadata(
  meta: Record<string, string>,
  chapters: { title: string; duration: number }[],
): string {
  let out = ';FFMETADATA1\n';
  for (const [k, v] of Object.entries(meta)) {
    if (v) out += `${k}=${escapeMeta(v)}\n`;
  }
  out += '\n';
  let posMs = 0;
  for (const ch of chapters) {
    const start = posMs;
    const end = posMs + ch.duration * 1000;
    out += `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${start}\nEND=${end}\ntitle=${escapeMeta(ch.title)}\n\n`;
    posMs = end;
  }
  return out;
}

function escapeMeta(s: string): string {
  return s.replace(/[=;#\\]/g, '\\$&').replace(/\n/g, ' ');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function probeDuration(filePath: string): Promise<number | null> {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      filePath,
    ], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (d: string) => { out += d; });
    proc.on('close', () => {
      const n = parseFloat(out.trim());
      resolve(isNaN(n) ? null : n);
    });
    proc.on('error', () => resolve(null));
  });
}

function formatDuration(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.floor(totalSec % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ─── FFmpeg runner ───────────────────────────────────────────────────────────

function runFfmpeg(jobId: string, args: string[], percentStart = 0, percentEnd = 99): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let totalSec = 0;

    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (chunk: string) => {
      appendLog(jobId, chunk);
      const durM = chunk.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
      if (durM) {
        const dur = +durM[1] * 3600 + +durM[2] * 60 + +durM[3];
        if (dur > totalSec) totalSec = dur;
      }
      const timeM = chunk.match(/time=(\d+):(\d+):(\d+\.?\d*)/);
      if (timeM && totalSec > 0) {
        const elapsed = +timeM[1] * 3600 + +timeM[2] * 60 + +timeM[3];
        const pct = Math.min(percentEnd, Math.round(percentStart + (elapsed / totalSec) * (percentEnd - percentStart)));
        updateJob(jobId, { percent: pct, message: `Creating M4B… ${pct}%` });
      }
    });

    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`))));
    proc.on('error', reject);
  });
}

export default router;

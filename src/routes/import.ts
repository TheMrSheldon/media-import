import { Router, Request, Response } from 'express';
import { unlink } from 'fs/promises';
import { extname, join } from 'path';
import { config } from '../config.js';
import { createJob, updateJob, type ImportRequest } from '../jobs.js';
import { downloadFile } from '../services/downloader.js';
import { checkConflict } from '../services/filemanager.js';
import { runTranscodeAndMove } from '../services/pipeline.js';

const router = Router();

router.post('/', async (req: Request, res: Response) => {
  const body = req.body as ImportRequest & { force?: boolean };

  if (!body.videoUrl || !body.title || !body.year || !body.imdbId || !body.mediaType) {
    res.status(400).json({ error: 'Missing required fields: videoUrl, title, year, imdbId, mediaType' });
    return;
  }

  if (body.mediaType === 'series' && (!body.season || !body.episode)) {
    res.status(400).json({ error: 'season and episode are required for series' });
    return;
  }

  if (!body.force) {
    const conflict = await checkConflict(body, { asFolder: body.asFolder });
    if (conflict) {
      res.status(409).json({ conflict: true, ...conflict });
      return;
    }
  }

  const displayTitle =
    body.mediaType === 'series'
      ? `${body.seriesTitle ?? body.title} S${String(body.season).padStart(2, '0')}E${String(body.episode).padStart(2, '0')}`
      : `${body.title} (${body.year})`;

  const job = createJob(displayTitle);
  res.json({ jobId: job.id });

  runPipeline(job.id, body).catch((err: Error) => {
    updateJob(job.id, { phase: 'error', message: err.message });
  });
});

async function runPipeline(jobId: string, req: ImportRequest): Promise<void> {
  let downloadPath: string | null = null;

  try {
    let urlPath = '';
    try { urlPath = new URL(req.videoUrl).pathname; } catch { urlPath = req.videoUrl; }
    const srcExt = extname(urlPath) || '.mp4';
    downloadPath = join(config.tempDir, `${jobId}_original${srcExt}`);

    // Phase 1: Download
    updateJob(jobId, { phase: 'downloading', percent: 0, message: 'Downloading…' });
    const { receivedBytes } = await downloadFile(req.videoUrl, downloadPath, (pct, received) => {
      updateJob(jobId, { percent: pct, message: `Downloading… ${pct}%`, downloadedBytes: received });
    });
    updateJob(jobId, { downloadedBytes: receivedBytes });

    // Phase 2+3: Transcode and move to library
    const { dest, renamed } = await runTranscodeAndMove(jobId, downloadPath, req, { asFolder: req.asFolder });

    await unlink(downloadPath).catch(() => {});

    updateJob(jobId, {
      phase: 'done',
      percent: 100,
      overwriteAvoided: renamed,
      message: renamed ? `Saved to ${dest} (renamed to avoid overwriting an existing file)` : `Saved to ${dest}`,
    });
  } catch (err) {
    if (downloadPath) await unlink(downloadPath).catch(() => {});
    throw err;
  }
}

export default router;

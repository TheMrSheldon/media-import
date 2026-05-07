import { Router, Request, Response } from 'express';
import { unlink } from 'fs/promises';
import { extname, join } from 'path';
import { config } from '../config.js';
import { createJob, updateJob, appendLog, type ImportRequest } from '../jobs.js';
import { downloadFile } from '../services/downloader.js';
import { transcodeWithPreset } from '../services/transcoder.js';
import { presetToFfmpeg } from '../services/preset-parser.js';
import { moveToLibrary } from '../services/filemanager.js';
import { activePreset } from '../services/active-preset.js';

const router = Router();

router.post('/', (req: Request, res: Response) => {
  const body = req.body as ImportRequest;

  if (!body.videoUrl || !body.title || !body.year || !body.imdbId || !body.mediaType) {
    res.status(400).json({ error: 'Missing required fields: videoUrl, title, year, imdbId, mediaType' });
    return;
  }

  if (body.mediaType === 'series' && (!body.season || !body.episode)) {
    res.status(400).json({ error: 'season and episode are required for series' });
    return;
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
  let transcodePath: string | null = null;

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

    // Phase 2: Transcode — build args from preset or fall back to built-in H.265 defaults
    const passLogBase = join(config.tempDir, `${jobId}_ffmpeg2pass`);
    const ffmpegJob = activePreset
      ? presetToFfmpeg(activePreset, downloadPath, join(config.tempDir, `${jobId}_transcoded.PLACEHOLDER`), passLogBase)
      : (() => {
          // Built-in default: H.265 CRF 22
          const out = join(config.tempDir, `${jobId}_transcoded.mp4`);
          return {
            passes: [[
              '-y', '-i', downloadPath!,
              '-c:v', 'libx265', '-crf', '22', '-preset', 'medium',
              '-c:a', 'aac', '-b:a', '192k',
              '-movflags', '+faststart',
              out,
            ]],
            outputExt: 'mp4',
          };
        })();

    // Replace the PLACEHOLDER extension with the real output extension
    transcodePath = join(config.tempDir, `${jobId}_transcoded.${ffmpegJob.outputExt}`);
    for (let i = 0; i < ffmpegJob.passes.length; i++) {
      ffmpegJob.passes[i] = ffmpegJob.passes[i].map((arg) =>
        arg.endsWith('.PLACEHOLDER') ? transcodePath! : arg,
      );
    }

    // Store the final-pass command for display in the UI
    const finalPassArgs = ffmpegJob.passes[ffmpegJob.passes.length - 1];
    updateJob(jobId, { command: `ffmpeg ${finalPassArgs.join(' ')}` });

    updateJob(jobId, { phase: 'transcoding', percent: 0, message: 'Transcoding…' });
    await transcodeWithPreset(ffmpegJob, (pct) => {
      updateJob(jobId, { percent: pct, message: `Transcoding… ${pct}%` });
    }, (line) => appendLog(jobId, line));

    // Phase 3: Move to library
    updateJob(jobId, { phase: 'moving', percent: 100, message: 'Moving to library…' });
    const dest = await moveToLibrary(transcodePath, req);

    if (downloadPath) await unlink(downloadPath).catch(() => {});
    // Clean up 2-pass log files if they exist
    await Promise.all([
      unlink(`${passLogBase}-0.log`).catch(() => {}),
      unlink(`${passLogBase}-0.log.mbtree`).catch(() => {}),
    ]);

    updateJob(jobId, { phase: 'done', percent: 100, message: `Saved to ${dest}` });
  } catch (err) {
    if (downloadPath) await unlink(downloadPath).catch(() => {});
    if (transcodePath) await unlink(transcodePath).catch(() => {});
    throw err;
  }
}

export default router;

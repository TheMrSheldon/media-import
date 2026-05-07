import { Router, Request, Response, NextFunction } from 'express';
import { spawn } from 'child_process';
import { readdir, stat, unlink } from 'fs/promises';
import { join, resolve, sep, extname, basename } from 'path';
import { config } from '../config.js';
import { createJob, updateJob, appendLog } from '../jobs.js';
import { cutToIntermediate, getVideoDuration, type AdSegment } from '../services/cutter.js';
import { transcodeWithPreset } from '../services/transcoder.js';
import { presetToFfmpeg } from '../services/preset-parser.js';
import { moveToLibrary } from '../services/filemanager.js';
import { activePreset } from '../services/active-preset.js';

const router = Router();

const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.ts', '.avi', '.mov', '.m4v', '.wmv']);


function guardUncutPath(res: Response): boolean {
  if (!config.uncutPath) {
    res.status(503).json({ error: 'MEDIA_IMPORT_UNCUT_PATH not configured' });
    return false;
  }
  return true;
}

function resolveFilePath(filename: string): string | null {
  const base = resolve(config.uncutPath);
  const target = resolve(join(base, basename(filename)));
  if (!target.startsWith(base + sep)) return null;
  return target;
}

router.get('/files', async (_req: Request, res: Response, next: NextFunction) => {
  if (!guardUncutPath(res)) return;
  try {
    const entries = await readdir(config.uncutPath, { withFileTypes: true });
    const videoEntries = entries.filter(
      (e) => e.isFile() && VIDEO_EXTS.has(extname(e.name).toLowerCase()),
    );
    const files = await Promise.all(
      videoEntries.map(async (e) => {
        const s = await stat(join(config.uncutPath, e.name));
        return { name: e.name, mtime: Math.floor(s.mtimeMs / 1000), size: s.size };
      }),
    );
    res.json({ files });
  } catch (err) {
    next(err);
  }
});

router.get('/duration/:encodedFilename', async (req: Request, res: Response, next: NextFunction) => {
  if (!guardUncutPath(res)) return;
  const filename = decodeURIComponent(req.params.encodedFilename);
  const filePath = resolveFilePath(filename);
  if (!filePath) { res.status(400).json({ error: 'Invalid filename' }); return; }
  try {
    const duration = await getVideoDuration(filePath);
    res.json({ duration });
  } catch (err) {
    next(err);
  }
});

// GET /api/cut/stream/:filename?seek=<seconds>
// Transcodes on the fly from the given seek position — only the portion the client
// downloads is transcoded.  -ss before -i does a fast keyframe seek.
router.get('/stream/:encodedFilename', (req: Request, res: Response) => {
  if (!guardUncutPath(res)) return;
  const filename = decodeURIComponent(req.params.encodedFilename);
  const filePath = resolveFilePath(filename);
  if (!filePath) {
    res.status(400).json({ error: 'Invalid filename' });
    return;
  }

  const seek = parseFloat(req.query.seek as string) || 0;
  const args: string[] = [
    ...(seek > 0 ? ['-ss', String(seek)] : []),
    '-i', filePath,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-tune', 'zerolatency',
    '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
    '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov',
    'pipe:1',
  ];
  const ff = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'ignore'] });

  res.setHeader('Content-Type', 'video/mp4');
  ff.stdout.pipe(res);

  ff.on('error', () => { if (!res.headersSent) res.status(500).end(); });
  req.on('close', () => ff.kill());
});

interface CutStartBody {
  filename: string;
  segments: AdSegment[];
  title: string;
  year: number;
  imdbId: string;
  mediaType: 'movie' | 'series';
  seriesTitle?: string;
  season?: number;
  episode?: number;
  episodeTitle?: string;
}

router.post('/start', (req: Request, res: Response) => {
  if (!guardUncutPath(res)) return;

  const body = req.body as CutStartBody;
  if (!body.filename || !body.title || !body.year || !body.imdbId || !body.mediaType) {
    res.status(400).json({ error: 'Missing required fields: filename, title, year, imdbId, mediaType' });
    return;
  }
  if (body.mediaType === 'series' && (!body.season || !body.episode)) {
    res.status(400).json({ error: 'season and episode are required for series' });
    return;
  }

  const filePath = resolveFilePath(body.filename);
  if (!filePath) {
    res.status(400).json({ error: 'Invalid filename' });
    return;
  }

  const displayTitle =
    body.mediaType === 'series'
      ? `${body.seriesTitle ?? body.title} S${String(body.season).padStart(2, '0')}E${String(body.episode).padStart(2, '0')}`
      : `${body.title} (${body.year})`;

  const job = createJob(displayTitle);
  res.json({ jobId: job.id });

  runCutPipeline(job.id, filePath, body).catch((err: Error) => {
    updateJob(job.id, { phase: 'error', message: err.message });
  });
});

async function runCutPipeline(jobId: string, sourcePath: string, req: CutStartBody): Promise<void> {
  let intermediatePath: string | null = null;
  let transcodePath: string | null = null;
  const passLogBase = join(config.tempDir, `${jobId}_ffmpeg2pass`);

  try {
    let inputForTranscode = sourcePath;

    if (req.segments && req.segments.length > 0) {
      updateJob(jobId, { phase: 'cutting', percent: 0, message: 'Cutting ad segments…' });
      intermediatePath = join(config.tempDir, `${jobId}_cut.mkv`);
      await cutToIntermediate(sourcePath, req.segments, intermediatePath, (line) => appendLog(jobId, line));
      updateJob(jobId, { phase: 'cutting', percent: 100, message: 'Cut complete' });
      inputForTranscode = intermediatePath;
    }

    const ffmpegJob = activePreset
      ? presetToFfmpeg(activePreset, inputForTranscode, join(config.tempDir, `${jobId}_transcoded.PLACEHOLDER`), passLogBase)
      : (() => {
          const out = join(config.tempDir, `${jobId}_transcoded.mp4`);
          return {
            passes: [[
              '-y', '-i', inputForTranscode,
              '-c:v', 'libx265', '-crf', '22', '-preset', 'medium',
              '-c:a', 'aac', '-b:a', '192k',
              '-movflags', '+faststart',
              out,
            ]],
            outputExt: 'mp4',
          };
        })();

    transcodePath = join(config.tempDir, `${jobId}_transcoded.${ffmpegJob.outputExt}`);
    for (let i = 0; i < ffmpegJob.passes.length; i++) {
      ffmpegJob.passes[i] = ffmpegJob.passes[i].map((arg) =>
        arg.endsWith('.PLACEHOLDER') ? transcodePath! : arg,
      );
    }

    const finalPassArgs = ffmpegJob.passes[ffmpegJob.passes.length - 1];
    updateJob(jobId, { command: `ffmpeg ${finalPassArgs.join(' ')}` });
    updateJob(jobId, { phase: 'transcoding', percent: 0, message: 'Transcoding…' });

    await transcodeWithPreset(ffmpegJob, (pct) => {
      updateJob(jobId, { percent: pct, message: `Transcoding… ${pct}%` });
    }, (line) => appendLog(jobId, line));

    updateJob(jobId, { phase: 'moving', percent: 100, message: 'Moving to library…' });
    const dest = await moveToLibrary(transcodePath, {
      videoUrl: '',
      title: req.title,
      year: req.year,
      imdbId: req.imdbId,
      mediaType: req.mediaType,
      seriesTitle: req.seriesTitle,
      season: req.season,
      episode: req.episode,
      episodeTitle: req.episodeTitle,
    });

    if (intermediatePath) await unlink(intermediatePath).catch(() => {});
    await Promise.all([
      unlink(`${passLogBase}-0.log`).catch(() => {}),
      unlink(`${passLogBase}-0.log.mbtree`).catch(() => {}),
    ]);

    updateJob(jobId, { phase: 'done', percent: 100, message: `Saved to ${dest}` });
  } catch (err) {
    if (intermediatePath) await unlink(intermediatePath).catch(() => {});
    if (transcodePath) await unlink(transcodePath).catch(() => {});
    throw err;
  }
}

export default router;

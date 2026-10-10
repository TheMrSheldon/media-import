import { Router, Request, Response, NextFunction } from 'express';
import { spawn } from 'child_process';
import { readdir, stat, unlink } from 'fs/promises';
import { join, resolve, sep, extname, basename } from 'path';
import { config } from '../config.js';
import { createJob, updateJob, appendLog } from '../jobs.js';
import { cutToIntermediate, getVideoDuration, type AdSegment } from '../services/cutter.js';
import { checkConflict } from '../services/filemanager.js';
import { runTranscodeAndMove } from '../services/pipeline.js';
import { VIDEO_EXTS } from '../services/videoExts.js';
import { problem } from '../problem.js';

const router = Router();

function guardUncutPath(res: Response): boolean {
  if (!config.uncutPath) {
    problem(res, 503, '/problems/not-configured', 'Service not configured',
      'MEDIA_IMPORT_UNCUT_PATH is not set');
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
  if (!filePath) {
    problem(res, 400, '/problems/invalid-parameter', 'Invalid filename',
      'The filename contains path traversal characters or is otherwise invalid');
    return;
  }
  try {
    const duration = await getVideoDuration(filePath);
    res.json({ duration });
  } catch (err) {
    next(err);
  }
});

router.get('/frame/:encodedFilename', (req: Request, res: Response) => {
  if (!guardUncutPath(res)) return;
  const filename = decodeURIComponent(req.params.encodedFilename);
  const filePath = resolveFilePath(filename);
  if (!filePath) { res.status(400).end(); return; }

  const t = parseFloat(req.query.t as string);
  if (isNaN(t) || t < 0) { res.status(400).end(); return; }

  const preseek = Math.max(0, t - 2);
  const fineseek = parseFloat((t - preseek).toFixed(6));
  const args = [
    '-ss', preseek.toFixed(6),
    '-i', filePath,
    ...(fineseek > 0.001 ? ['-ss', fineseek.toFixed(6)] : []),
    '-frames:v', '1',
    '-f', 'image2pipe',
    '-c:v', 'mjpeg',
    '-vf', 'scale=160:-2',
    '-q:v', '5',
    'pipe:1',
  ];

  const ff = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'ignore'] });
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  ff.stdout.pipe(res);
  ff.on('error', () => { if (!res.headersSent) res.status(500).end(); });
  req.on('close', () => ff.kill());
});

router.get('/stream/:encodedFilename', (req: Request, res: Response) => {
  if (!guardUncutPath(res)) return;
  const filename = decodeURIComponent(req.params.encodedFilename);
  const filePath = resolveFilePath(filename);
  if (!filePath) {
    problem(res, 400, '/problems/invalid-parameter', 'Invalid filename',
      'The filename contains path traversal characters or is otherwise invalid');
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
  asFolder?: boolean;
  force?: boolean;
}

router.post('/jobs', async (req: Request, res: Response) => {
  if (!guardUncutPath(res)) return;

  const body = req.body as CutStartBody;
  if (!body.filename || !body.title || !body.year || !body.imdbId || !body.mediaType) {
    problem(res, 400, '/problems/missing-fields', 'Missing required fields',
      'filename, title, year, imdbId, and mediaType are required');
    return;
  }
  if (body.mediaType === 'series' && (!body.season || !body.episode)) {
    problem(res, 400, '/problems/missing-fields', 'Missing required fields',
      'season and episode are required for series');
    return;
  }

  const filePath = resolveFilePath(body.filename);
  if (!filePath) {
    problem(res, 400, '/problems/invalid-parameter', 'Invalid filename',
      'The filename contains path traversal characters or is otherwise invalid');
    return;
  }

  if (!body.force) {
    const conflict = await checkConflict({
      videoUrl: '', title: body.title, year: body.year, imdbId: body.imdbId,
      mediaType: body.mediaType, seriesTitle: body.seriesTitle,
      season: body.season, episode: body.episode, episodeTitle: body.episodeTitle,
    }, { asFolder: body.asFolder });
    if (conflict) {
      problem(res, 409, '/problems/conflict', 'File already exists',
        'A file already exists at this path in the library', { conflict: true, ...conflict });
      return;
    }
  }

  const displayTitle =
    body.mediaType === 'series'
      ? `${body.seriesTitle ?? body.title} S${String(body.season).padStart(2, '0')}E${String(body.episode).padStart(2, '0')}`
      : `${body.title} (${body.year})`;

  const job = createJob(displayTitle);
  res.status(201).json({ jobId: job.id });

  runCutPipeline(job.id, filePath, body).catch((err: Error) => {
    updateJob(job.id, { phase: 'error', message: err.message });
  });
});

async function runCutPipeline(jobId: string, sourcePath: string, req: CutStartBody): Promise<void> {
  let intermediatePath: string | null = null;

  try {
    let inputForTranscode = sourcePath;

    if (req.segments && req.segments.length > 0) {
      updateJob(jobId, { phase: 'cutting', percent: 0, message: 'Cutting ad segments…' });
      intermediatePath = join(config.tempDir, `${jobId}_cut.mkv`);
      await cutToIntermediate(sourcePath, req.segments, intermediatePath, (line) => appendLog(jobId, line));
      updateJob(jobId, { phase: 'cutting', percent: 100, message: 'Cut complete' });
      inputForTranscode = intermediatePath;
    }

    const { dest, renamed } = await runTranscodeAndMove(jobId, inputForTranscode, {
      videoUrl: '',
      title: req.title,
      year: req.year,
      imdbId: req.imdbId,
      mediaType: req.mediaType,
      seriesTitle: req.seriesTitle,
      season: req.season,
      episode: req.episode,
      episodeTitle: req.episodeTitle,
    }, { asFolder: req.asFolder });

    if (intermediatePath) await unlink(intermediatePath).catch(() => {});

    updateJob(jobId, {
      phase: 'done',
      percent: 100,
      overwriteAvoided: renamed,
      message: renamed ? `Saved to ${dest} (renamed to avoid overwriting an existing file)` : `Saved to ${dest}`,
    });
  } catch (err) {
    if (intermediatePath) await unlink(intermediatePath).catch(() => {});
    throw err;
  }
}

export default router;

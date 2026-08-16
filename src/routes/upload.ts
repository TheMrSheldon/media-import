import { Router, Request, Response } from 'express';
import multer from 'multer';
import { unlink } from 'fs/promises';
import { extname, basename, dirname } from 'path';
import { config } from '../config.js';
import { createJob, updateJob, type ImportRequest } from '../jobs.js';
import { checkConflict, buildExtraFileNameBase, type ExtraType } from '../services/filemanager.js';
import { runTranscodeAndMove } from '../services/pipeline.js';
import { VIDEO_EXTS } from '../services/videoExts.js';

const router = Router();

const upload = multer({ dest: config.tempDir });

function guardUploadDestinations(res: Response): boolean {
  if (!config.uploadDestinations.length) {
    res.status(503).json({ error: 'MEDIA_IMPORT_UPLOAD_DESTINATIONS not configured' });
    return false;
  }
  return true;
}

router.get('/destinations', (_req: Request, res: Response) => {
  if (!guardUploadDestinations(res)) return;
  res.json(config.uploadDestinations.map((d, i) => ({ id: String(i), label: d.label, path: d.path })));
});

interface UploadStartBody {
  title: string;
  year: string;
  imdbId: string;
  mediaType: 'movie' | 'series';
  seriesTitle?: string;
  season?: string;
  episode?: string;
  episodeTitle?: string;
  asFolder?: string;
  transcode?: string;
  destinationId: string;
  force?: string;
  extras?: string; // JSON string: { type: ExtraType }[], same order as the extraFiles field
}

interface ExtraMeta {
  type: ExtraType;
}

router.post('/', upload.fields([{ name: 'file', maxCount: 1 }, { name: 'extraFiles', maxCount: 20 }]), async (req: Request, res: Response) => {
  if (!guardUploadDestinations(res)) return;

  const body = req.body as UploadStartBody;
  const files = req.files as { [field: string]: Express.Multer.File[] } | undefined;
  const mainFile = files?.file?.[0];
  const extraFiles = files?.extraFiles ?? [];

  const cleanupUploadedFiles = () =>
    Promise.all([mainFile, ...extraFiles].filter(Boolean).map((f) => unlink(f!.path).catch(() => {})));

  if (!mainFile || !body.title || !body.year || !body.imdbId || !body.mediaType || !body.destinationId) {
    await cleanupUploadedFiles();
    res.status(400).json({ error: 'Missing required fields: file, title, year, imdbId, mediaType, destinationId' });
    return;
  }

  const year = Number(body.year);
  const season = body.season ? Number(body.season) : undefined;
  const episode = body.episode ? Number(body.episode) : undefined;
  if (body.mediaType === 'series' && (!season || !episode)) {
    await cleanupUploadedFiles();
    res.status(400).json({ error: 'season and episode are required for series' });
    return;
  }

  if (!VIDEO_EXTS.has(extname(mainFile.originalname).toLowerCase())) {
    await cleanupUploadedFiles();
    res.status(400).json({ error: 'Unsupported file type' });
    return;
  }

  const destIndex = Number(body.destinationId);
  const destination = config.uploadDestinations[destIndex];
  if (!destination) {
    await cleanupUploadedFiles();
    res.status(400).json({ error: 'Invalid destinationId' });
    return;
  }

  let extras: ExtraMeta[] = [];
  try {
    extras = body.extras ? (JSON.parse(body.extras) as ExtraMeta[]) : [];
  } catch {
    await cleanupUploadedFiles();
    res.status(400).json({ error: 'Invalid extras payload' });
    return;
  }

  // Extras require a folder — force it regardless of what the client sent.
  const asFolder = body.asFolder === 'true' || extraFiles.length > 0;
  const transcode = body.transcode === 'true';

  const importReq: ImportRequest = {
    videoUrl: '',
    title: body.title,
    year,
    imdbId: body.imdbId,
    mediaType: body.mediaType,
    seriesTitle: body.seriesTitle,
    season,
    episode,
    episodeTitle: body.episodeTitle,
    asFolder,
  };

  if (body.force !== 'true') {
    const conflict = await checkConflict(importReq, { asFolder, baseDirOverride: destination.path });
    if (conflict) {
      await cleanupUploadedFiles();
      res.status(409).json({ conflict: true, ...conflict });
      return;
    }
  }

  const displayTitle =
    body.mediaType === 'series'
      ? `${body.seriesTitle ?? body.title} S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`
      : `${body.title} (${body.year})`;

  const mainJob = createJob(displayTitle);
  const extraJobs = extraFiles.map((f, i) => createJob(`${displayTitle} — ${extras[i]?.type ?? 'extra'}`));

  res.json({ jobIds: [mainJob.id, ...extraJobs.map((j) => j.id)] });

  runUploadPipeline(mainJob.id, extraJobs, mainFile, extraFiles, extras, importReq, {
    asFolder,
    baseDirOverride: destination.path,
    transcode,
  }).catch((err: Error) => {
    updateJob(mainJob.id, { phase: 'error', message: err.message });
  });
});

async function runUploadPipeline(
  mainJobId: string,
  extraJobs: { id: string }[],
  mainFile: Express.Multer.File,
  extraFiles: Express.Multer.File[],
  extras: ExtraMeta[],
  req: ImportRequest,
  opts: { asFolder: boolean; baseDirOverride: string; transcode: boolean },
): Promise<void> {
  const { dest, renamed } = await runTranscodeAndMove(mainJobId, mainFile.path, req, opts);
  updateJob(mainJobId, {
    phase: 'done',
    percent: 100,
    overwriteAvoided: renamed,
    message: renamed ? `Saved to ${dest} (renamed to avoid overwriting an existing file)` : `Saved to ${dest}`,
  });

  if (!extraFiles.length) return;

  const mainDir = dirname(dest);
  const mainName = basename(dest, extname(dest));

  for (let i = 0; i < extraFiles.length; i++) {
    const extraJobId = extraJobs[i].id;
    const extraType = extras[i]?.type ?? 'other';
    try {
      const { dest: extraDest, renamed: extraRenamed } = await runTranscodeAndMove(
        extraJobId,
        extraFiles[i].path,
        req,
        {
          transcode: opts.transcode,
          baseDirOverride: mainDir,
          fileNameOverride: buildExtraFileNameBase(mainName, extraType),
        },
      );
      updateJob(extraJobId, {
        phase: 'done',
        percent: 100,
        overwriteAvoided: extraRenamed,
        message: extraRenamed
          ? `Saved to ${extraDest} (renamed to avoid overwriting an existing file)`
          : `Saved to ${extraDest}`,
      });
    } catch (err) {
      updateJob(extraJobId, { phase: 'error', message: (err as Error).message });
      await unlink(extraFiles[i].path).catch(() => {});
    }
  }
}

export default router;

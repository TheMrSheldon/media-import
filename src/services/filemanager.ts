import { mkdir, rename, access } from 'fs/promises';
import { extname, join } from 'path';
import { config } from '../config.js';
import type { ImportRequest } from '../jobs.js';

export type ExtraType =
  | 'trailer'
  | 'behindthescenes'
  | 'deleted'
  | 'interview'
  | 'scene'
  | 'short'
  | 'featurette'
  | 'other';

export interface BuildPathOptions {
  asFolder?: boolean;
  baseDirOverride?: string;
  // When set, bypasses the normal movie/series name derivation and uses this base name
  // (without extension) directly inside baseDirOverride — used for extras, which are named
  // after the main file plus a type suffix rather than from title/year/imdbId.
  fileNameOverride?: string;
}

function sanitize(s: string): string {
  return s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim();
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function buildTargetPath(
  req: ImportRequest,
  transcodedPath?: string,
  opts: BuildPathOptions = {},
): { dir: string; file: string } {
  const ext = transcodedPath ? extname(transcodedPath) : '.mp4';

  if (opts.fileNameOverride) {
    return { dir: opts.baseDirOverride ?? config.movieBaseDir, file: `${opts.fileNameOverride}${ext}` };
  }

  if (req.mediaType === 'movie') {
    const name = sanitize(`${req.title} (${req.year}) [imdbid-${req.imdbId}]`);
    const baseDir = opts.baseDirOverride ?? config.movieBaseDir;
    return {
      dir: opts.asFolder ? join(baseDir, name) : baseDir,
      file: `${name}${ext}`,
    };
  }

  // Series
  const series = sanitize(req.seriesTitle ?? req.title);
  const season = req.season ?? 1;
  const episode = req.episode ?? 1;
  const seasonDir = `Season ${pad(season)}`;
  const epTag = `S${pad(season)}E${pad(episode)}`;
  const epTitle = req.episodeTitle ? ` - ${sanitize(req.episodeTitle)}` : '';
  const filename = `${series} - ${epTag}${epTitle}${ext}`;
  const baseDir = opts.baseDirOverride ?? config.seriesBaseDir;

  return {
    dir: join(baseDir, sanitize(`${series} [imdbid-${req.imdbId}]`), seasonDir),
    file: filename,
  };
}

// Never overwrite: if dir/file exists, try name-1.ext, name-2.ext, ... until a free path is found.
export async function resolveAvailablePath(
  dir: string,
  file: string,
): Promise<{ path: string; renamed: boolean }> {
  const ext = extname(file);
  const base = file.slice(0, file.length - ext.length);
  let candidate = file;
  let n = 0;
  for (;;) {
    const dest = join(dir, candidate);
    const exists = await access(dest).then(() => true).catch(() => false);
    if (!exists) return { path: dest, renamed: n > 0 };
    n += 1;
    candidate = `${base}-${n}${ext}`;
  }
}

export async function checkConflict(
  req: ImportRequest,
  opts?: BuildPathOptions,
): Promise<{ existingPath: string; suggestedPath: string } | null> {
  const { dir, file } = buildTargetPath(req, undefined, opts);
  const existingPath = join(dir, file);
  const exists = await access(existingPath).then(() => true).catch(() => false);
  if (!exists) return null;
  const { path: suggestedPath } = await resolveAvailablePath(dir, file);
  return { existingPath, suggestedPath };
}

// mainName: the sanitized movie name without extension, e.g. "Movie (2000) [imdbid-tt123]"
export function buildExtraFileNameBase(mainName: string, extraType: ExtraType): string {
  return `${mainName}-${extraType}`;
}

export async function moveToLibrary(
  transcodedPath: string,
  req: ImportRequest,
  opts?: BuildPathOptions,
): Promise<{ dest: string; renamed: boolean }> {
  const { dir, file } = buildTargetPath(req, transcodedPath, opts);
  await mkdir(dir, { recursive: true });
  const { path: dest, renamed } = await resolveAvailablePath(dir, file);
  await rename(transcodedPath, dest);
  return { dest, renamed };
}

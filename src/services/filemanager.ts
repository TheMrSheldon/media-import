import { mkdir, rename } from 'fs/promises';
import { extname, join } from 'path';
import { config } from '../config.js';
import type { ImportRequest } from '../jobs.js';

function sanitize(s: string): string {
  return s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim();
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function buildTargetPath(req: ImportRequest, transcodedPath?: string): { dir: string; file: string } {
  const ext = transcodedPath ? extname(transcodedPath) : '.mp4';

  if (req.mediaType === 'movie') {
    const name = sanitize(`${req.title} (${req.year}) [imdbid-${req.imdbId}]`);
    return {
      dir: join(config.movieBaseDir, name),
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

  return {
    dir: join(config.seriesBaseDir, sanitize(`${series} (${req.year})`), seasonDir),
    file: filename,
  };
}

export async function moveToLibrary(
  transcodedPath: string,
  req: ImportRequest,
): Promise<string> {
  const { dir, file } = buildTargetPath(req, transcodedPath);
  await mkdir(dir, { recursive: true });
  const dest = join(dir, file);
  await rename(transcodedPath, dest);
  return dest;
}

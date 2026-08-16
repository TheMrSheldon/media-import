export function sanitize(s: string): string {
  return s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim();
}

export function pad(n: number | ''): string {
  return String(n || 1).padStart(2, '0');
}

export interface PreviewPathParams {
  mediaType: 'movie' | 'series';
  title: string;
  year: number | '';
  imdbId: string;
  seriesTitle?: string;
  season?: number | '';
  episode?: number | '';
  episodeTitle?: string;
  asFolder?: boolean;
  // The real destination directory this will be saved under (movieBaseDir/seriesBaseDir,
  // or an upload destination's path), shown as a prefix so the user can double-check the
  // right destination is selected before submitting — not just its label.
  libraryPath?: string | null;
}

// Mirrors src/services/filemanager.ts's buildTargetPath naming exactly.
export function buildPreviewPath(p: PreviewPathParams): string | null {
  if (!p.imdbId || !p.title.trim() || p.year === '') return null;

  const prefix = p.libraryPath ? `${p.libraryPath} / ` : '';

  if (p.mediaType === 'movie') {
    const name = sanitize(`${p.title.trim()} (${p.year}) [imdbid-${p.imdbId}]`);
    return p.asFolder ? `${prefix}${name} / ${name}.mp4` : `${prefix}${name}.mp4`;
  }

  const series = sanitize((p.seriesTitle ?? '').trim() || p.title.trim());
  const epTag = `S${pad(p.season ?? '')}E${pad(p.episode ?? '')}`;
  const epSuffix = p.episodeTitle?.trim() ? ` - ${sanitize(p.episodeTitle.trim())}` : '';
  const seriesFolder = sanitize(`${series} [imdbid-${p.imdbId}]`);
  return `${prefix}${seriesFolder} / Season ${pad(p.season ?? '')} / ${series} - ${epTag}${epSuffix}.mp4`;
}

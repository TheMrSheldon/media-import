import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

function loadDotEnv() {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadDotEnv();

function required(name: string): string {
  const val = process.env[name];
  if (!val) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return val;
}

export const config = {
  port: parseInt(process.env.PORT ?? '3000', 10),
  basePath: (process.env.BASE_PATH ?? '/').replace(/\/+$/, '') || '/',
  movieBaseDir: required('MEDIA_IMPORT_MOVIE_BASE_DIR'),
  seriesBaseDir: required('MEDIA_IMPORT_SERIES_BASE_DIR'),
  tempDir: process.env.MEDIA_IMPORT_TEMP_DIR ?? '/tmp/media-import',
  dataDir: process.env.MEDIA_IMPORT_DATA_DIR ?? './data',
  presetPath: process.env.MEDIA_IMPORT_PRESET_PATH ?? './data/presets/default.json',
  tvheadendUrl: process.env.MEDIA_IMPORT_TVHEADEND_URL?.replace(/\/$/, '') ?? '',
  tvheadendUser: process.env.MEDIA_IMPORT_TVHEADEND_USER ?? '',
  tvheadendPass: process.env.MEDIA_IMPORT_TVHEADEND_PASS ?? '',
  tvheadendDvrUuid: process.env.MEDIA_IMPORT_TVHEADEND_DVR_UUID ?? '',
  uncutPath: process.env.MEDIA_IMPORT_UNCUT_PATH ?? '',
};

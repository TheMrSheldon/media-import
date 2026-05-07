import { spawn } from 'child_process';
import { join } from 'path';
import { config } from '../config.js';

export interface AdSegment { start: number; end: number; }
export interface KeepSegment { start: number; end: number; }

export function invertSegments(ads: AdSegment[], duration: number): KeepSegment[] {
  const sorted = [...ads].sort((a, b) => a.start - b.start);
  const kept: KeepSegment[] = [];
  let pos = 0;
  for (const seg of sorted) {
    if (seg.start > pos + 0.1) kept.push({ start: pos, end: seg.start });
    pos = Math.max(pos, seg.end);
  }
  if (pos < duration - 0.1) kept.push({ start: pos, end: duration });
  return kept;
}

export function buildCutFilter(kept: KeepSegment[]): string {
  const parts: string[] = [];
  for (let i = 0; i < kept.length; i++) {
    const { start, end } = kept[i];
    parts.push(`[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${i}]`);
    parts.push(`[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${i}]`);
  }
  const inputs = kept.map((_, i) => `[v${i}][a${i}]`).join('');
  parts.push(`${inputs}concat=n=${kept.length}:v=1:a=1[vout][aout]`);
  return parts.join(';');
}

export async function getVideoDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      filePath,
    ], { stdio: ['ignore', 'pipe', 'ignore'] });

    let out = '';
    proc.stdout.on('data', (chunk: Buffer) => { out += chunk.toString(); });
    proc.on('close', (code) => {
      if (code !== 0) { reject(new Error(`ffprobe exited with code ${code}`)); return; }
      const val = parseFloat(out.trim());
      if (isNaN(val)) { reject(new Error('Could not parse video duration')); return; }
      resolve(val);
    });
    proc.on('error', (err) => reject(new Error(`Failed to start ffprobe: ${err.message}`)));
  });
}

export async function cutToIntermediate(
  sourcePath: string,
  adSegments: AdSegment[],
  outPath: string,
  onLog: (line: string) => void,
): Promise<void> {
  const duration = await getVideoDuration(sourcePath);
  const kept = invertSegments(adSegments, duration);

  if (kept.length === 0) throw new Error('No content to keep after removing ad segments');

  const filter = buildCutFilter(kept);
  const args = [
    '-y', '-i', sourcePath,
    '-filter_complex', filter,
    '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast',
    '-c:a', 'aac', '-b:a', '192k',
    outPath,
  ];

  await new Promise<void>((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let buf = '';
    proc.stderr.on('data', (chunk: Buffer) => {
      buf += chunk.toString();
      const lines = buf.split(/\r\n|\r|\n/);
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) onLog(line);
      }
    });
    proc.on('close', (code) => {
      if (buf.trim()) onLog(buf);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg (cut pass) exited with code ${code}`));
    });
    proc.on('error', (err) => reject(new Error(`Failed to start ffmpeg: ${err.message}`)));
  });
}

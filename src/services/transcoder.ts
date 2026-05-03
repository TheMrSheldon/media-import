import { spawn } from 'child_process';
import type { TranscodeJob } from './preset-parser.js';

function parseDuration(s: string): number {
  const m = s.match(/(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return 0;
  return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3]);
}

function runFfmpeg(
  args: string[],
  trackProgress: boolean,
  onProgress: (percent: number) => void,
  onLog: (line: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });

    let totalSeconds = 0;
    let buf = '';

    proc.stderr.on('data', (chunk: Buffer) => {
      buf += chunk.toString();
      const lines = buf.split(/\r\n|\r|\n/);
      buf = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        onLog(line);

        if (totalSeconds === 0) {
          const dm = line.match(/Duration:\s*(\d+:\d+:\d+(?:\.\d+)?)/);
          if (dm) totalSeconds = parseDuration(dm[1]);
        }

        if (trackProgress) {
          const tm = line.match(/time=(\d+:\d+:\d+(?:\.\d+)?)/);
          if (tm && totalSeconds > 0) {
            const elapsed = parseDuration(tm[1]);
            onProgress(Math.min(99, Math.round((elapsed / totalSeconds) * 100)));
          }
        }
      }
    });

    proc.on('close', (code) => {
      if (buf.trim()) onLog(buf);
      if (code === 0) {
        if (trackProgress) onProgress(100);
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to start ffmpeg: ${err.message}`));
    });
  });
}

export async function transcodeWithPreset(
  job: TranscodeJob,
  onProgress: (percent: number) => void,
  onLog: (line: string) => void,
): Promise<void> {
  const { passes } = job;

  for (let i = 0; i < passes.length; i++) {
    const isLastPass = i === passes.length - 1;
    if (passes.length > 1) {
      onLog(`[media-import] Starting pass ${i + 1} of ${passes.length}`);
    }
    await runFfmpeg(passes[i], isLastPass, onProgress, onLog);
  }
}

import { unlink } from 'fs/promises';
import { join } from 'path';
import { config } from '../config.js';
import { updateJob, appendLog, type ImportRequest } from '../jobs.js';
import { transcodeWithPreset } from './transcoder.js';
import { presetToFfmpeg } from './preset-parser.js';
import { moveToLibrary, type BuildPathOptions } from './filemanager.js';
import { activePreset } from './active-preset.js';

export interface RunTranscodeAndMoveOptions extends BuildPathOptions {
  transcode?: boolean; // default true — set false to move the input as-is, skipping ffmpeg entirely
}

// Shared by import.ts (after download), cut.ts (after the optional cut step), and upload.ts
// (for the main file and each extra) — builds ffmpeg args from the active preset or a
// built-in fallback, transcodes, then moves the result into the library, reporting job
// progress throughout. When opts.transcode is false, the transcode step is skipped and
// inputPath is moved directly (preserving its original container/extension).
export async function runTranscodeAndMove(
  jobId: string,
  inputPath: string,
  req: ImportRequest,
  opts: RunTranscodeAndMoveOptions = {},
): Promise<{ dest: string; renamed: boolean }> {
  if (opts.transcode === false) {
    updateJob(jobId, { phase: 'moving', percent: 100, message: 'Moving to library…' });
    return moveToLibrary(inputPath, req, opts);
  }

  const passLogBase = join(config.tempDir, `${jobId}_ffmpeg2pass`);
  const ffmpegJob = activePreset
    ? presetToFfmpeg(activePreset, inputPath, join(config.tempDir, `${jobId}_transcoded.PLACEHOLDER`), passLogBase)
    : (() => {
        const out = join(config.tempDir, `${jobId}_transcoded.mp4`);
        return {
          passes: [[
            '-y', '-i', inputPath,
            '-c:v', 'libx265', '-crf', '22', '-preset', 'medium',
            '-c:a', 'aac', '-b:a', '192k',
            '-movflags', '+faststart',
            out,
          ]],
          outputExt: 'mp4',
        };
      })();

  const transcodePath = join(config.tempDir, `${jobId}_transcoded.${ffmpegJob.outputExt}`);
  for (let i = 0; i < ffmpegJob.passes.length; i++) {
    ffmpegJob.passes[i] = ffmpegJob.passes[i].map((arg) =>
      arg.endsWith('.PLACEHOLDER') ? transcodePath : arg,
    );
  }

  const finalPassArgs = ffmpegJob.passes[ffmpegJob.passes.length - 1];
  updateJob(jobId, { command: `ffmpeg ${finalPassArgs.join(' ')}` });
  updateJob(jobId, { phase: 'transcoding', percent: 0, message: 'Transcoding…' });

  try {
    await transcodeWithPreset(ffmpegJob, (pct) => {
      updateJob(jobId, { percent: pct, message: `Transcoding… ${pct}%` });
    }, (line) => appendLog(jobId, line));

    updateJob(jobId, { phase: 'moving', percent: 100, message: 'Moving to library…' });
    const { dest, renamed } = await moveToLibrary(transcodePath, req, opts);

    await Promise.all([
      unlink(`${passLogBase}-0.log`).catch(() => {}),
      unlink(`${passLogBase}-0.log.mbtree`).catch(() => {}),
    ]);

    return { dest, renamed };
  } catch (err) {
    await unlink(transcodePath).catch(() => {});
    throw err;
  }
}

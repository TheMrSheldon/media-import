// Global mutex serializing all ffmpeg invocations (transcode, cut, audiobook) so only
// one runs at a time, regardless of how many jobs are in flight concurrently.
let running = false;
const waiting: (() => void)[] = [];

function acquire(): Promise<void> {
  if (!running) {
    running = true;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    waiting.push(() => { running = true; resolve(); });
  });
}

function release(): void {
  const next = waiting.shift();
  if (next) next();
  else running = false;
}

export function queueLength(): number {
  return waiting.length;
}

// Runs `task` once no other ffmpeg process is active. If another one is already running,
// `onWaiting` fires immediately (before task starts) so callers can reflect a "queued" status.
export async function runExclusive<T>(task: () => Promise<T>, onWaiting?: () => void): Promise<T> {
  if (running) onWaiting?.();
  await acquire();
  try {
    return await task();
  } finally {
    release();
  }
}

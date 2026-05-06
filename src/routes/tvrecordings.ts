import { Router, Request, Response, NextFunction } from 'express';
import { tvhGet } from '../services/tvheadend.js';

const router = Router();

function extractTitle(e: Record<string, unknown>): string {
  if (typeof e.disp_title === 'string' && e.disp_title) return e.disp_title;
  if (typeof e.title === 'string') return e.title;
  if (e.title && typeof e.title === 'object') {
    const vals = Object.values(e.title as Record<string, string>);
    return vals[0] ?? 'Unknown';
  }
  return 'Unknown';
}

function normalizeStatus(e: Record<string, unknown>): string {
  const raw = ((e.sched_status ?? e.status) as string ?? '');
  if (raw === 'completed') return 'completed';
  if (raw === 'recording') return 'recording';
  if (raw === 'scheduled') return 'scheduled';
  if (raw.toLowerCase().includes('miss')) return 'missed';
  return 'invalid';
}

router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await tvhGet('/api/dvr/entry/grid?limit=200') as { entries?: Record<string, unknown>[] };

    const entries = (data.entries ?? [])
      .map((e) => ({
        uuid: e.uuid as string,
        title: extractTitle(e),
        channelName: (e.channelname ?? e.channel ?? '') as string,
        start: e.start as number,
        stop: e.stop as number,
        status: normalizeStatus(e),
        filename: (e.filename as string) || undefined,
        filesize: (e.filesize as number) || undefined,
      }))
      .filter((e) => e.status === 'scheduled' || e.status === 'recording')
      .sort((a, b) => a.start - b.start);

    res.json(entries);
  } catch (err) {
    next(err);
  }
});

export default router;

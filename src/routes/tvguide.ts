import { Router, Request, Response, NextFunction } from 'express';
import { tvhGet } from '../services/tvheadend.js';

const router = Router();

interface TVHEvent {
  eventId: number;
  channelName: string;
  title: string;
  subtitle?: string;
  summary?: string;
  description?: string;
  start: number;
  stop: number;
  hd?: number | boolean;
  episodeOnscreen?: string;
  image?: string;
  dvrState?: string;
}

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  const q = (req.query.q as string | undefined)?.trim();
  if (!q) {
    res.status(400).json({ error: 'q is required' });
    return;
  }

  try {
    const data = await tvhGet(
      `/api/epg/events/grid?title=${encodeURIComponent(q)}&limit=25`
    ) as { entries?: TVHEvent[] };

    const results = (data.entries ?? []).map((e) => ({
      eventId: e.eventId,
      channelName: e.channelName,
      title: e.title,
      subtitle: e.subtitle,
      summary: e.summary,
      description: e.description,
      start: e.start,
      stop: e.stop,
      hd: !!e.hd,
      episodeOnscreen: e.episodeOnscreen,
      image: e.image,
      dvrState: e.dvrState,
    }));

    res.json(results);
  } catch (err) {
    next(err);
  }
});

export default router;

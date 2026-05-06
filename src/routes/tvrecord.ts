import { Router, Request, Response, NextFunction } from 'express';
import { tvhPost, getDvrUuid } from '../services/tvheadend.js';

const router = Router();

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  const { channelName, start, stop, title } = req.body as {
    channelName: string;
    start: number;
    stop: number;
    title?: string;
  };

  if (!channelName || !start || !stop) {
    res.status(400).json({ error: 'channelName, start, and stop are required' });
    return;
  }

  try {
    const dvrUuid = await getDvrUuid();
    const conf = {
      start,
      stop,
      channelname: channelName,
      ...(title ? { title: { eng: title } } : {}),
    };
    const data = await tvhPost('/api/dvr/entry/create', {
      conf: JSON.stringify(conf),
      config_uuid: dvrUuid,
    }) as { uuid?: string };
    res.json({ uuid: data.uuid });
  } catch (err) {
    next(err);
  }
});

export default router;

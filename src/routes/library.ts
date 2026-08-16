import { Router, Request, Response } from 'express';
import { config } from '../config.js';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.json({ movieBaseDir: config.movieBaseDir, seriesBaseDir: config.seriesBaseDir });
});

export default router;

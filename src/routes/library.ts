import { Router, Request, Response } from 'express';
import { config } from '../config.js';
import { listLibraryImdbIds } from '../services/filemanager.js';
import { problem } from '../problem.js';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.json({ movieBaseDir: config.movieBaseDir, seriesBaseDir: config.seriesBaseDir });
});

router.get('/imdb-ids', async (_req: Request, res: Response) => {
  try {
    const found = await listLibraryImdbIds();
    res.json({ imdbIds: found });
  } catch (e: any) {
    problem(res, 500, '/problems/internal-error', 'Failed to scan library', e.message);
  }
});

export default router;

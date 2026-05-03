import { Router, Request, Response } from 'express';
import { getJob, listJobs, deleteJob, getLog, subscribe } from '../jobs.js';

const router = Router();

// GET /api/jobs — list all jobs
router.get('/', (_req: Request, res: Response) => {
  res.json(listJobs());
});

// GET /api/jobs/:id/events — SSE stream
router.get('/:id/events', (req: Request, res: Response) => {
  const job = getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  res.write(
    `data: ${JSON.stringify({ phase: job.phase, percent: job.percent, message: job.message })}\n\n`,
  );

  subscribe(req.params.id, res);
});

// GET /api/jobs/:id/log — full ffmpeg log text
router.get('/:id/log', (req: Request, res: Response) => {
  if (!getJob(req.params.id)) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(getLog(req.params.id));
});

// DELETE /api/jobs/:id — dismiss a finished or errored job
router.delete('/:id', (req: Request, res: Response) => {
  const job = getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  if (job.phase !== 'done' && job.phase !== 'error') {
    res.status(409).json({ error: 'Cannot dismiss an active job' });
    return;
  }
  deleteJob(req.params.id);
  res.status(204).end();
});

export default router;

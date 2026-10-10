import { Router, Request, Response } from 'express';
import { getJob, listJobs, deleteJob, getLog, subscribe } from '../jobs.js';
import { problem } from '../problem.js';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.json(listJobs());
});

router.get('/:id/events', (req: Request, res: Response) => {
  const job = getJob(req.params.id);
  if (!job) {
    problem(res, 404, '/problems/not-found', 'Job not found',
      `No job with ID ${req.params.id} exists`);
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  res.write(
    `data: ${JSON.stringify({ phase: job.phase, percent: job.percent, message: job.message, downloadedBytes: job.downloadedBytes, downloadable: job.downloadable ?? false })}\n\n`,
  );

  subscribe(req.params.id, res);
});

router.get('/:id/log', (req: Request, res: Response) => {
  if (!getJob(req.params.id)) {
    problem(res, 404, '/problems/not-found', 'Job not found',
      `No job with ID ${req.params.id} exists`);
    return;
  }
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(getLog(req.params.id));
});

router.delete('/:id', (req: Request, res: Response) => {
  const job = getJob(req.params.id);
  if (!job) {
    problem(res, 404, '/problems/not-found', 'Job not found',
      `No job with ID ${req.params.id} exists`);
    return;
  }
  if (job.phase !== 'done' && job.phase !== 'error') {
    problem(res, 409, '/problems/job-active', 'Cannot dismiss an active job',
      `Job is currently in phase: ${job.phase}`);
    return;
  }
  deleteJob(req.params.id);
  res.status(204).end();
});

export default router;

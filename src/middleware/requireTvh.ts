import { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';

export function requireTvh(_req: Request, res: Response, next: NextFunction): void {
  if (!config.tvheadendUrl) {
    res.status(503).json({ error: 'TVHeadend not configured' });
    return;
  }
  next();
}

export function tvhErrorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const message = err instanceof Error ? err.message : 'TVHeadend request failed';
  res.status(502).json({ error: message });
}

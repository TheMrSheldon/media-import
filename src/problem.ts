import { Response } from 'express';

export function problem(
  res: Response,
  status: number,
  type: string,
  title: string,
  detail?: string,
  extra?: Record<string, unknown>,
): void {
  res
    .status(status)
    .setHeader('Content-Type', 'application/problem+json')
    .json({ type, title, status, ...(detail ? { detail } : {}), ...extra });
}

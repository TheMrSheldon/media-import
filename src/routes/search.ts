import { Router, Request, Response } from 'express';
import https from 'https';
import { problem } from '../problem.js';

const router = Router();

router.post('/', (req: Request, res: Response) => {
  const { query, size = 20, offset = 0 } = req.body as {
    query: string;
    size?: number;
    offset?: number;
  };

  if (!query) {
    problem(res, 400, '/problems/missing-fields', 'Missing required fields', 'query is required');
    return;
  }

  const body = JSON.stringify({
    queries: [{ fields: ['title', 'topic'], query }],
    sortBy: 'timestamp',
    sortOrder: 'desc',
    future: false,
    offset,
    size,
  });

  const options = {
    hostname: 'mediathekviewweb.de',
    path: '/api/query',
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
      'Content-Length': Buffer.byteLength(body),
      'User-Agent': 'media-import/1.0',
    },
  };

  const proxyReq = https.request(options, (proxyRes) => {
    let data = '';
    proxyRes.on('data', (c) => (data += c));
    proxyRes.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        res.json(parsed);
      } catch {
        problem(res, 502, '/problems/upstream-error', 'Invalid upstream response',
          'MediathekViewWeb returned an unparseable response');
      }
    });
  });

  proxyReq.on('error', (err) => {
    problem(res, 502, '/problems/upstream-error', 'Upstream request failed', err.message);
  });

  proxyReq.write(body);
  proxyReq.end();
});

export default router;

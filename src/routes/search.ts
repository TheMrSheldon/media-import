import { Router, Request, Response } from 'express';
import https from 'https';

const router = Router();

router.post('/', (req: Request, res: Response) => {
  const { query, size = 20, offset = 0 } = req.body as {
    query: string;
    size?: number;
    offset?: number;
  };

  if (!query) {
    res.status(400).json({ error: 'query is required' });
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
        res.status(502).json({ error: 'Invalid response from MediathekViewWeb' });
      }
    });
  });

  proxyReq.on('error', (err) => {
    res.status(502).json({ error: err.message });
  });

  proxyReq.write(body);
  proxyReq.end();
});

export default router;

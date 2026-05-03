import { Router, Request, Response } from 'express';
import http from 'http';
import https from 'https';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  const url = req.query.url as string | undefined;
  if (!url) {
    res.status(400).json({ error: 'url is required' });
    return;
  }

  const probe = (u: string, redirects = 5) => {
    if (redirects === 0) {
      res.json({ size: null });
      return;
    }

    const lib = u.startsWith('https') ? https : http;
    const request = lib.request(u, { method: 'HEAD' }, (proxyRes) => {
      if (
        (proxyRes.statusCode === 301 || proxyRes.statusCode === 302) &&
        proxyRes.headers.location
      ) {
        proxyRes.resume();
        probe(proxyRes.headers.location, redirects - 1);
        return;
      }
      proxyRes.resume();
      const raw = proxyRes.headers['content-length'];
      const size = raw ? parseInt(raw, 10) : null;
      res.json({ size: size && size > 0 ? size : null });
    });

    request.on('error', () => res.json({ size: null }));
    request.end();
  };

  probe(url);
});

export default router;

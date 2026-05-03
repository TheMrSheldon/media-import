import { Router, Request, Response } from 'express';
import https from 'https';

const router = Router();

interface ImdbSuggestion {
  id: string;
  l: string;   // label / title
  y?: number;  // year
  q?: string;  // type (feature, TV series, etc.)
  i?: { imageUrl: string; width: number; height: number };
}

router.get('/', (req: Request, res: Response) => {
  const q = (req.query.q as string | undefined)?.trim();
  if (!q) {
    res.status(400).json({ error: 'q is required' });
    return;
  }

  // IMDB's internal suggestion endpoint — first letter + query
  const firstLetter = q[0].toLowerCase().replace(/[^a-z0-9]/, 'a');
  const encoded = encodeURIComponent(q.toLowerCase());
  const path = `/suggestion/${firstLetter}/${encoded}.json`;

  const options = {
    hostname: 'v2.sg.media-imdb.com',
    path,
    method: 'GET',
    headers: { 'User-Agent': 'media-import/1.0' },
  };

  const proxyReq = https.request(options, (proxyRes) => {
    let data = '';
    proxyRes.on('data', (c) => (data += c));
    proxyRes.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        const results = ((parsed.d ?? []) as ImdbSuggestion[])
          .filter((item) => item.id?.startsWith('tt'))
          .slice(0, 8)
          .map((item) => ({
            imdbId: item.id,
            title: item.l,
            year: item.y,
            type: item.q,
            poster: item.i?.imageUrl,
          }));
        res.json(results);
      } catch {
        res.status(502).json({ error: 'Invalid response from IMDB' });
      }
    });
  });

  proxyReq.on('error', (err) => {
    res.status(502).json({ error: err.message });
  });

  proxyReq.end();
});

export default router;

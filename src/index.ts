import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from './config.js';
import { initJobs, flushJobs } from './jobs.js';
import searchRouter from './routes/search.js';
import imdbRouter from './routes/imdb.js';
import importRouter from './routes/import.js';
import jobsRouter from './routes/jobs.js';
import filesizeRouter from './routes/filesize.js';
import tvguideRouter from './routes/tvguide.js';
import recordingsRouter from './routes/recordings.js';
import { requireTvh, tvhErrorHandler } from './middleware/requireTvh.js';
import cutRouter from './routes/cut.js';
import audiobookRouter from './routes/audiobook.js';
import { initPreset } from './services/active-preset.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();

app.use(cors());
app.use(express.json());

// Served at absolute root so index.html can always load it with <script src="/_config.js">
app.get('/_config.js', (_req, res) => {
  res.type('application/javascript');
  res.send(`window._basePath=${JSON.stringify(config.basePath)};`);
});

const router = express.Router();
router.use('/api/search', searchRouter);
router.use('/api/imdb', imdbRouter);
router.use('/api/import', importRouter);
router.use('/api/jobs', jobsRouter);
router.use('/api/filesize', filesizeRouter);
router.use('/api/cut', cutRouter);
router.use('/api/audiobook', audiobookRouter);
router.use('/api/tvguide', requireTvh, tvguideRouter);
router.use('/api/recordings', requireTvh, recordingsRouter);
router.use(['/api/tvguide', '/api/recordings'], tvhErrorHandler);

// Serve built frontend
const publicDir = join(__dirname, '..', 'public');
router.use(express.static(publicDir));
router.get('*', (_req, res) => {
  res.sendFile(join(publicDir, 'index.html'));
});

const base = config.basePath === '/' ? '' : config.basePath;
app.use(base || '/', router);

// Global error handler — catches next(err) from all routes
app.use((_err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(_err);
  res
    .status(500)
    .setHeader('Content-Type', 'application/problem+json')
    .json({
      type: '/problems/internal-error',
      title: 'Internal Server Error',
      status: 500,
      detail: _err.message,
    });
});

await initJobs();
await initPreset();

function shutdown() {
  flushJobs();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

app.listen(config.port, () => {
  console.log(`media-import running on http://localhost:${config.port}`);
  console.log(`  Movies → ${config.movieBaseDir}`);
  console.log(`  Series → ${config.seriesBaseDir}`);
  console.log(`  Temp   → ${config.tempDir}`);
  console.log(`  Data   → ${config.dataDir}`);
});

import express from 'express';
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
import tvrecordRouter from './routes/tvrecord.js';
import tvrecordingsRouter from './routes/tvrecordings.js';
import { requireTvh, tvhErrorHandler } from './middleware/requireTvh.js';

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
router.use('/api/tvguide', requireTvh, tvguideRouter);
router.use('/api/tvrecord', requireTvh, tvrecordRouter);
router.use('/api/tvrecordings', requireTvh, tvrecordingsRouter);
router.use(['/api/tvguide', '/api/tvrecord', '/api/tvrecordings'], tvhErrorHandler);

// Serve built frontend
const publicDir = join(__dirname, '..', 'public');
router.use(express.static(publicDir));
router.get('*', (_req, res) => {
  res.sendFile(join(publicDir, 'index.html'));
});

// Strip trailing slash so '/' becomes '' for app.use (handled by || below)
const base = config.basePath === '/' ? '' : config.basePath;
app.use(base || '/', router);

await initJobs();

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

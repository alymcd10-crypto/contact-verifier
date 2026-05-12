// server/index.js — Express entrypoint.
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import routes from './routes.js';
import { sourceStatus } from './verify.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use('/api', routes);

app.get('/', (_req, res) => {
  res.send('<h1>Contact Verifier API</h1><p>See <a href="/api/health">/api/health</a></p>');
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  const s = sourceStatus();
  console.log(`\n┌─ Contact Verifier ──────────────────────────────`);
  console.log(`│ API:      http://localhost:${PORT}/api`);
  console.log(`│ Sources:`);
  for (const [k, v] of Object.entries(s)) {
    console.log(`│   ${v ? '✓' : '✗'} ${k}${v ? '' : '  (set API key in .env)'}`);
  }
  console.log(`└──────────────────────────────────────────────────\n`);
});

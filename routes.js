// server/routes.js — API surface.
import { Router } from 'express';
import { verifyContact, sourceStatus } from './verify.js';
import { createBatch, getBatch, listBatches } from './jobs.js';
import { stats } from './cache.js';

const router = Router();

// Optional bearer-token auth — enabled only if API_AUTH_TOKEN is set.
router.use((req, res, next) => {
  const token = process.env.API_AUTH_TOKEN;
  if (!token) return next();
  const got = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (got !== token) return res.status(401).json({ error: 'unauthorized' });
  next();
});

router.get('/health', (_req, res) => {
  res.json({ ok: true, sources: sourceStatus(), cache: stats() });
});

router.post('/verify', async (req, res) => {
  const { contact, skipCache } = req.body || {};
  if (!contact?.name) return res.status(400).json({ error: 'contact.name required' });
  try {
    const result = await verifyContact(contact, { skipCache: !!skipCache });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.post('/verify/batch', (req, res) => {
  const { contacts, options } = req.body || {};
  if (!Array.isArray(contacts) || !contacts.length) return res.status(400).json({ error: 'contacts[] required' });
  const job = createBatch(contacts, options);
  res.json(job);
});

router.get('/verify/:jobId', (req, res) => {
  const j = getBatch(req.params.jobId);
  if (!j) return res.status(404).json({ error: 'not found' });
  res.json({
    id: j.id, status: j.status, progress: j.progress, total: j.total,
    startedAt: j.startedAt, finishedAt: j.finishedAt,
    results: j.results, errors: j.errors,
  });
});

router.get('/batches', (_req, res) => {
  res.json({ batches: listBatches() });
});

export default router;

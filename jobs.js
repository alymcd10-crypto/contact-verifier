// server/jobs.js — in-memory batch job queue with rate-limiting and concurrency.
// For 8k-contact jobs: a single-process queue is fine here. If you need durability
// across restarts, swap this for BullMQ + Redis — public interface stays the same.
import { verifyContact } from './verify.js';

const jobs = new Map();
const MAX_CONCURRENCY_DEFAULT = parseInt(process.env.MAX_BATCH_CONCURRENCY || '3', 10);

function mkId() {
  return `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createBatch(contacts, options = {}) {
  const concurrency = Math.min(10, Math.max(1, options.concurrency || MAX_CONCURRENCY_DEFAULT));
  const id = mkId();
  const job = {
    id,
    status: 'running',
    total: contacts.length,
    progress: 0,
    startedAt: Date.now(),
    finishedAt: null,
    results: [],
    errors: [],
    concurrency,
  };
  jobs.set(id, job);
  runBatch(job, contacts).catch(err => { job.status = 'failed'; job.errors.push(String(err)); });
  return { id, status: job.status, total: job.total };
}

async function runBatch(job, contacts) {
  const queue = [...contacts];
  const workers = Array.from({ length: job.concurrency }, async () => {
    while (queue.length) {
      const c = queue.shift();
      try {
        const r = await verifyContact(c);
        job.results.push({ input: c, result: r });
      } catch (e) {
        job.errors.push({ contact: c?.name, error: String(e) });
        job.results.push({ input: c, result: { overall: 'error', error: String(e) } });
      }
      job.progress = job.results.length;
    }
  });
  await Promise.all(workers);
  job.status = 'done';
  job.finishedAt = Date.now();
}

export function getBatch(id) {
  return jobs.get(id) || null;
}

export function listBatches() {
  return [...jobs.values()].map(j => ({
    id: j.id, status: j.status, progress: j.progress, total: j.total,
    startedAt: j.startedAt, finishedAt: j.finishedAt,
  }));
}

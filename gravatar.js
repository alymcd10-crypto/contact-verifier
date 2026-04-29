// server/sources/gravatar.js — free, email-based photo lookup.
import crypto from 'node:crypto';
import { timedFetch } from './util.js';

export const available = () => true;

export async function lookup(email) {
  if (!email) return { source: 'gravatar' };
  const hash = crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
  const testUrl = `https://www.gravatar.com/avatar/${hash}?d=404&s=200&r=pg`;
  try {
    const r = await timedFetch(testUrl, {}, 5000);
    if (r.ok) return { source: 'gravatar', photoUrl: `https://www.gravatar.com/avatar/${hash}?s=400&r=pg` };
  } catch {}
  return { source: 'gravatar' };
}

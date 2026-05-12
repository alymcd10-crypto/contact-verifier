// server/sources/hunter.js — find current work email by name + company domain.
import { timedFetch } from '../util.js';

const KEY = process.env.HUNTER_API_KEY;
export const available = () => !!KEY;

function domainFromUrl(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return null; }
}

export async function lookup(contact, hints = {}) {
  if (!KEY) return { source: 'hunter', skipped: 'no-key' };
  const domain = hints.websiteDomain || (contact.email ? contact.email.split('@')[1] : null);
  if (!domain || !contact.name) return { source: 'hunter' };

  const [first = '', ...rest] = contact.name.trim().split(/\s+/);
  const last = rest.pop() || '';
  if (!first || !last) return { source: 'hunter' };

  try {
    const url = `https://api.hunter.io/v2/email-finder?domain=${encodeURIComponent(domain)}&first_name=${encodeURIComponent(first)}&last_name=${encodeURIComponent(last)}&api_key=${KEY}`;
    const r = await timedFetch(url, {}, 10000);
    if (!r.ok) return { source: 'hunter' };
    const d = await r.json();
    return {
      source: 'hunter',
      email: d.data?.email || null,
      hunterScore: d.data?.score || null, // 0-100, they say >70 = good
      title: d.data?.position || null,
      phone: d.data?.phone_number || null,
      linkedinUrl: d.data?.linkedin || null,
    };
  } catch { return { source: 'hunter' }; }
}

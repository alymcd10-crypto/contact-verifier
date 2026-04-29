// server/sources/website.js — server-side website fetch (no CORS restrictions).
// Visits /, /contact, /about, /team — extracts phones/emails/photos.
import * as cheerio from 'cheerio';
import { timedFetch, extractEmails, extractPhones } from '../util.js';

export const available = () => true;

async function fetchText(url) {
  try {
    const r = await timedFetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ContactVerifier/1.0)' },
    }, 9000);
    if (!r.ok) return null;
    return await r.text();
  } catch { return null; }
}

function findPersonPhoto($, name) {
  const [first, ...rest] = String(name).trim().split(/\s+/);
  const last = rest.pop() || '';
  const pat = new RegExp(`${first}[\\s_-]*${last}|${last}[\\s_-]*${first}`, 'i');
  let best = null;
  $('img').each((_, el) => {
    const src = $(el).attr('src') || '';
    const alt = $(el).attr('alt') || '';
    if (pat.test(alt) || pat.test(src)) best = src;
  });
  return best;
}

export async function lookup(contact, hints = {}) {
  const startUrl = hints.websiteUrl;
  if (!startUrl) return { source: 'website' };

  const base = startUrl.replace(/\/+$/, '');
  const paths = ['', '/contact', '/about', '/team', '/staff', '/agents', '/attorneys'];
  const collected = { phones: [], emails: [], photo: null };

  for (const p of paths) {
    const url = /^https?:\/\//.test(base) ? base + p : `https://${base}${p}`;
    const html = await fetchText(url);
    if (!html) continue;
    const $ = cheerio.load(html);
    const text = $('body').text().replace(/\s+/g, ' ');
    collected.phones.push(...extractPhones(text));
    collected.emails.push(...extractEmails(text));
    if (!collected.photo) {
      const photo = findPersonPhoto($, contact.name);
      if (photo) {
        collected.photo = photo.startsWith('http') ? photo
          : photo.startsWith('//') ? `https:${photo}`
          : `${base}${photo.startsWith('/') ? '' : '/'}${photo}`;
      }
    }
    if (collected.phones.length && collected.emails.length && collected.photo) break;
  }

  return {
    source: 'website',
    phone: collected.phones[0] || null,
    email: collected.emails[0] || null,
    photoUrl: collected.photo || null,
    websiteUrl: startUrl,
  };
}

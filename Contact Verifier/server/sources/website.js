// server/sources/website.js — server-side website fetch (no CORS restrictions).
// Visits /, /contact, /about, /team — extracts phones/emails/photos.
import * as cheerio from 'cheerio';
import { timedFetch, extractEmails, extractPhones } from '../util.js';

export const available = () => true;

// US street-address regex: "123 Main St, Chicago, IL 60601" (suite optional).
const ADDR_RE = /\b(\d{1,6}\s+[A-Z0-9.,'\- ]{3,60}?(?:Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Drive|Dr|Lane|Ln|Way|Court|Ct|Place|Pl|Parkway|Pkwy|Highway|Hwy|Suite|Ste|Floor|Fl|#)[A-Z0-9.,'\- ]{0,40}?,\s*[A-Za-z .'-]{2,40},\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?)\b/g;

function extractAddresses(text) {
  const out = new Set();
  let m;
  while ((m = ADDR_RE.exec(text)) !== null) {
    out.add(m[1].replace(/\s+/g, ' ').trim());
    if (out.size > 5) break;
  }
  return [...out];
}

function pickPersonEmail(emails, name) {
  if (!emails.length) return null;
  const [first = '', ...rest] = String(name || '').toLowerCase().trim().split(/\s+/);
  const last = (rest.pop() || '').toLowerCase();
  // Score: name-matching local-part wins; info@/contact@/hello@ lose.
  const scored = emails.map(e => {
    const [local, domain] = e.toLowerCase().split('@');
    let score = 0;
    if (first && local.includes(first)) score += 5;
    if (last && local.includes(last)) score += 5;
    if (first && last && local.includes(`${first}.${last}`)) score += 5;
    if (/^(info|contact|hello|admin|sales|office|support|hr|jobs|careers|legal|noreply|no-reply)$/i.test(local)) score -= 10;
    if (/wixpress|sentry|example|test/i.test(domain)) score -= 20;
    return { email: e, score };
  }).sort((a, b) => b.score - a.score);
  return scored[0].email;
}

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
  const paths = ['', '/contact', '/contact-us', '/about', '/about-us', '/team', '/staff', '/agents', '/attorneys', '/our-team', '/locations', '/office'];
  const collected = { phones: [], emails: [], addresses: [], photo: null };

  for (const p of paths) {
    const url = /^https?:\/\//.test(base) ? base + p : `https://${base}${p}`;
    const html = await fetchText(url);
    if (!html) continue;
    const $ = cheerio.load(html);
    const text = $('body').text().replace(/\s+/g, ' ');
    collected.phones.push(...extractPhones(text));
    collected.emails.push(...extractEmails(text));
    collected.addresses.push(...extractAddresses(text));

    // mailto: links are higher-signal than scraped text — capture them too
    $('a[href^="mailto:"]').each((_, el) => {
      const href = ($(el).attr('href') || '').replace(/^mailto:/i, '').split('?')[0].trim();
      if (href && /@/.test(href)) collected.emails.push(href);
    });

    // Schema.org PostalAddress JSON-LD blocks
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const data = JSON.parse($(el).contents().text());
        const list = Array.isArray(data) ? data : [data];
        for (const obj of list) {
          const addr = obj?.address || obj?.location?.address;
          if (addr && typeof addr === 'object') {
            const line = [addr.streetAddress, addr.addressLocality, addr.addressRegion, addr.postalCode]
              .filter(Boolean).join(', ');
            if (line) collected.addresses.push(line);
          }
        }
      } catch {}
    });

    if (!collected.photo) {
      const photo = findPersonPhoto($, contact.name);
      if (photo) {
        collected.photo = photo.startsWith('http') ? photo
          : photo.startsWith('//') ? `https:${photo}`
          : `${base}${photo.startsWith('/') ? '' : '/'}${photo}`;
      }
    }
    if (collected.phones.length && collected.emails.length && collected.addresses.length && collected.photo) break;
  }

  // Dedupe + pick best
  const uniqEmails = [...new Set(collected.emails.map(e => e.toLowerCase()))];
  const uniqAddrs = [...new Set(collected.addresses)];

  return {
    source: 'website',
    phone: collected.phones[0] || null,
    email: pickPersonEmail(uniqEmails, contact.name),
    address: uniqAddrs[0] || null,
    photoUrl: collected.photo || null,
    websiteUrl: startUrl,
  };
}

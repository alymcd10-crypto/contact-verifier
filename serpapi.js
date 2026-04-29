// server/sources/serpapi.js — Google Search, Local/Maps, Images via SerpAPI.
// Returns raw hits; the aggregator decides what to trust.
import { timedFetch, extractEmails, extractPhones } from '../util.js';

const KEY = process.env.SERPAPI_KEY;
export const available = () => !!KEY;

async function search(query, extra = {}) {
  if (!KEY) return null;
  const params = new URLSearchParams({ q: query, api_key: KEY, num: '8', ...extra });
  try {
    const r = await timedFetch(`https://serpapi.com/search.json?${params}`, {}, 12000);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

function parseOrganic(results = []) {
  const hits = { phones: [], emails: [], linkedinUrl: null, websiteUrl: null, headline: null };
  for (const r of results.slice(0, 6)) {
    const snippet = `${r.title || ''} ${r.snippet || ''}`;
    const link = r.link || '';
    if (!hits.linkedinUrl && /linkedin\.com\/in\//i.test(link)) {
      hits.linkedinUrl = link;
      if (snippet.includes(' · ')) hits.headline = snippet.split(' · ')[0].trim();
    }
    if (!hits.websiteUrl && link && !/linkedin|facebook|twitter|instagram|yelp\.com|google\.com|zillow|realtor\.com/i.test(link)) {
      hits.websiteUrl = link;
    }
    hits.phones.push(...extractPhones(snippet));
    hits.emails.push(...extractEmails(snippet));
  }
  return hits;
}

export async function lookup(contact) {
  if (!KEY) return { source: 'serpapi', skipped: 'no-key' };
  const name = contact.name;
  const typeTerm = contact.type === 'lawyer' ? 'attorney' : 'realtor';
  const q = [name, contact.company, typeTerm].filter(Boolean).join(' ');

  const [main, linkedin, images] = await Promise.all([
    search(q),
    search(`site:linkedin.com/in "${name}" ${typeTerm}`),
    search(`${name} ${typeTerm} ${contact.company || ''}`.trim(), { tbm: 'isch', num: '3' }),
  ]);

  const out = { source: 'serpapi', phone: null, email: null, company: null, title: null,
                linkedinUrl: null, websiteUrl: null, photoUrl: null, address: null, socials: {} };
  if (!main) return out;

  const org = parseOrganic(main.organic_results);
  if (org.phones[0]) out.phone = org.phones[0];
  if (org.emails[0]) out.email = org.emails[0];
  if (org.linkedinUrl) out.linkedinUrl = org.linkedinUrl;
  if (org.websiteUrl) out.websiteUrl = org.websiteUrl;
  if (org.headline) out.title = org.headline;

  // Knowledge Graph
  const kg = main.knowledge_graph || {};
  if (kg.phone) out.phone = kg.phone;
  if (kg.website) out.websiteUrl = kg.website;
  if (kg.address) out.address = kg.address;
  if (kg.image) out.photoUrl = kg.image;
  if (kg.title && !out.title) out.title = kg.title;

  // Google Maps / Local
  const local = main.local_results?.places?.[0];
  if (local) {
    out.phone = out.phone || local.phone;
    out.websiteUrl = out.websiteUrl || local.website;
    out.address = out.address || local.address;
    if (!out.company && local.title) out.company = local.title;
  }

  // LinkedIn URL fallback
  if (!out.linkedinUrl && linkedin) {
    const li = (linkedin.organic_results || []).find(r => /linkedin\.com\/in\//i.test(r.link || ''));
    if (li) out.linkedinUrl = li.link;
  }

  // Socials harvested from organic
  for (const r of (main.organic_results || [])) {
    const l = r.link || '';
    if (/instagram\.com\//i.test(l) && !out.socials.instagram) out.socials.instagram = l;
    else if (/facebook\.com\//i.test(l) && !out.socials.facebook) out.socials.facebook = l;
    else if (/twitter\.com\/|x\.com\//i.test(l) && !out.socials.twitter) out.socials.twitter = l;
  }

  // Photo
  if (!out.photoUrl && images?.images_results?.[0]?.thumbnail) {
    out.photoUrl = images.images_results[0].thumbnail;
  }

  return out;
}

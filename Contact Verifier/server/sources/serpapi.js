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

// Parse "Title at Company · Location · 500+ connections" pattern from LinkedIn snippets
function parseLinkedInSnippet(text) {
  if (!text) return {};
  const out = {};
  // "Real Estate Broker at Coldwell Banker"
  let m = text.match(/^([A-Z][^·|·]+?)\s+at\s+([A-Z][^·|]+?)(?:\s*[·•|·]|\s*$)/);
  if (m) { out.title = m[1].trim(); out.company = m[2].trim(); return out; }
  // "Senior Partner | Smith & Co"
  m = text.match(/^([A-Z][^|·]+?)\s*\|\s*([A-Z][^|·]+?)(?:\s*[·•|]|\s*$)/);
  if (m) { out.title = m[1].trim(); out.company = m[2].trim(); return out; }
  // Just "Title · 500 connections" — keep title only
  m = text.match(/^([A-Z][A-Za-z &,.\-]+?)\s+[·•]/);
  if (m && !/^\d/.test(m[1])) out.title = m[1].trim();
  return out;
}

function parseOrganic(results = [], contactName = '') {
  const hits = { phones: [], emails: [], linkedinUrl: null, linkedinSnippet: null,
                  websiteUrl: null, headline: null, title: null, company: null };
  const nameRe = contactName ? new RegExp(contactName.split(/\s+/).join('\\s+'), 'i') : null;

  for (const r of results.slice(0, 8)) {
    const title = r.title || '';
    const snippet = r.snippet || '';
    const combined = `${title} ${snippet}`;
    const link = r.link || '';

    // LinkedIn result — strongest signal for title/company
    if (/linkedin\.com\/in\//i.test(link)) {
      if (!hits.linkedinUrl) {
        hits.linkedinUrl = link;
        hits.linkedinSnippet = combined;
        // Parse the snippet AND the title — LinkedIn titles often = "Jane Lee - Realtor - Compass | LinkedIn"
        const parsed = parseLinkedInSnippet(snippet) ;
        if (parsed.title) hits.title = parsed.title;
        if (parsed.company) hits.company = parsed.company;
        // Try parsing the title line: "Name - Role - Company | LinkedIn"
        const tm = title.match(/^[^-|]+-\s*([^-|]+?)\s*-\s*([^|]+?)(?:\s*\||$)/);
        if (tm) {
          if (!hits.title)   hits.title = tm[1].trim();
          if (!hits.company) hits.company = tm[2].trim();
        }
      }
    }
    // External website (not social/directory) - candidate company website
    else if (!hits.websiteUrl && link && !/linkedin|facebook|twitter|instagram|tiktok|yelp\.com|google\.com|zillow|realtor\.com|youtube\.com/i.test(link)) {
      hits.websiteUrl = link;
    }

    // Phones and emails from ALL snippets (including LinkedIn, sometimes the name+number appears)
    hits.phones.push(...extractPhones(combined));
    hits.emails.push(...extractEmails(combined));
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
                linkedinUrl: null, websiteUrl: null, photoUrl: null, address: null, socials: {},
                _raw: {} };
  if (!main && !linkedin) return out;

  // Parse both result sets — LinkedIn-targeted query gives better profile snippets
  const org  = parseOrganic(main?.organic_results || [], name);
  const liOrg = parseOrganic(linkedin?.organic_results || [], name);

  // LinkedIn-specific search wins for title/company
  out.title       = liOrg.title       || org.title       || null;
  out.company     = liOrg.company     || org.company     || null;
  out.linkedinUrl = liOrg.linkedinUrl || org.linkedinUrl || null;

  if (org.phones[0])    out.phone      = org.phones[0];
  if (org.emails[0])    out.email      = org.emails[0];
  if (org.websiteUrl)   out.websiteUrl = org.websiteUrl;

  // Knowledge Graph (high signal when present)
  const kg = main?.knowledge_graph || {};
  if (kg.phone)   out.phone      = kg.phone;
  if (kg.website) out.websiteUrl = kg.website;
  if (kg.address) out.address    = kg.address;
  if (kg.image)   out.photoUrl   = kg.image;
  if (kg.title && !out.title) out.title = kg.title;
  if (kg.type && !out.company && /at\s+(.+)/i.test(kg.type)) {
    out.company = kg.type.replace(/^.*?at\s+/i, '').trim();
  }

  // Google Maps / Local — for the COMPANY, not the person
  const local = main?.local_results?.places?.[0];
  if (local) {
    out.phone   = out.phone   || local.phone;
    out.websiteUrl = out.websiteUrl || local.website;
    out.address = out.address || local.address;
    if (!out.company && local.title) out.company = local.title;
  }

  // Answer box — sometimes has structured data
  const ab = main?.answer_box || {};
  if (ab.phone && !out.phone) out.phone = ab.phone;
  if (ab.address && !out.address) out.address = ab.address;

  // Socials harvested from all organic results
  const allOrganic = [...(main?.organic_results || []), ...(linkedin?.organic_results || [])];
  for (const r of allOrganic) {
    const l = r.link || '';
    if (/instagram\.com\//i.test(l)    && !out.socials.instagram) out.socials.instagram = l;
    else if (/facebook\.com\//i.test(l) && !out.socials.facebook)  out.socials.facebook  = l;
    else if (/(twitter|x)\.com\//i.test(l) && !out.socials.twitter) out.socials.twitter = l;
  }

  // Photo fallback
  if (!out.photoUrl && images?.images_results?.[0]?.thumbnail) {
    out.photoUrl = images.images_results[0].thumbnail;
  }

  // Debug raw data — surfaced in /api/verify response when ?debug=1
  out._raw = {
    knowledgeGraph: kg && Object.keys(kg).length ? { title: kg.title, type: kg.type, phone: kg.phone, website: kg.website, address: kg.address } : null,
    localResults: local ? { title: local.title, phone: local.phone, address: local.address, website: local.website } : null,
    linkedinSnippet: liOrg.linkedinSnippet || org.linkedinSnippet || null,
    organicTitles: (main?.organic_results || []).slice(0, 5).map(r => r.title),
    linkedinOrganicTitles: (linkedin?.organic_results || []).slice(0, 5).map(r => r.title),
  };

  return out;
}

// server/sources/pdl.js — People Data Labs Person Enrichment.
// Highest-signal single source for bulk jobs. Charges per match; uses title_case on match.
import { timedFetch } from './util.js';

const KEY = process.env.PDL_API_KEY;
export const available = () => !!KEY;

export async function lookup(contact) {
  if (!KEY) return { source: 'pdl', skipped: 'no-key' };
  const params = new URLSearchParams({ api_key: KEY, min_likelihood: '6', pretty: 'false' });
  if (contact.name) params.set('name', contact.name);
  if (contact.email) params.set('email', contact.email);
  if (contact.phone) params.set('phone', contact.phone);
  if (contact.company) params.set('company', contact.company);

  try {
    const r = await timedFetch(`https://api.peopledatalabs.com/v5/person/enrich?${params}`, {}, 15000);
    if (!r.ok) return { source: 'pdl' };
    const d = await r.json();
    if (d.status !== 200 || !d.data) return { source: 'pdl', likelihood: d.likelihood || 0 };
    const p = d.data;
    const job = p.job_company_name || null;
    const social = {};
    for (const prof of (p.profiles || [])) {
      if (prof.network === 'linkedin' && !social.linkedin) social.linkedin = prof.url;
      else if (prof.network === 'facebook' && !social.facebook) social.facebook = prof.url;
      else if (prof.network === 'twitter' && !social.twitter) social.twitter = prof.url;
      else if (prof.network === 'instagram' && !social.instagram) social.instagram = prof.url;
    }
    return {
      source: 'pdl',
      likelihood: d.likelihood, // 1-10 (PDL's own confidence)
      email: p.work_email || p.emails?.[0]?.address || null,
      phone: p.phone_numbers?.[0] || p.mobile_phone || null,
      company: job,
      title: p.job_title || null,
      address: [p.location_locality, p.location_region, p.location_country].filter(Boolean).join(', ') || null,
      photoUrl: null, // PDL doesn't provide photos
      linkedinUrl: social.linkedin || null,
      socials: social,
    };
  } catch { return { source: 'pdl' }; }
}

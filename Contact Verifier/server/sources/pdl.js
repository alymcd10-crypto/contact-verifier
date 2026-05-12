// server/sources/pdl.js — People Data Labs Person Enrichment.
// Highest-signal single source for bulk jobs. Charges per match; uses title_case on match.
import { timedFetch } from '../util.js';

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
    if (!r.ok) return { source: 'pdl', httpStatus: r.status };
    const d = await r.json();
    if (d.status !== 200 || !d.data) return { source: 'pdl', likelihood: d.likelihood || 0, pdlStatus: d.status, pdlError: d.error?.message };
    const p = d.data;
    const job = p.job_company_name || null;
    const social = {};
    for (const prof of (p.profiles || [])) {
      if (prof.network === 'linkedin' && !social.linkedin) social.linkedin = prof.url;
      else if (prof.network === 'facebook' && !social.facebook) social.facebook = prof.url;
      else if (prof.network === 'twitter' && !social.twitter) social.twitter = prof.url;
      else if (prof.network === 'instagram' && !social.instagram) social.instagram = prof.url;
    }

    // Email: prefer work_email, then any work-type email in the emails[] array,
    // then personal_emails, then the first listed email.
    const emailsArr = Array.isArray(p.emails) ? p.emails : [];
    const workEmailFromArr = emailsArr.find(e => /work|professional/i.test(e?.type || ''))?.address;
    const personalEmailFromArr = emailsArr.find(e => /personal/i.test(e?.type || ''))?.address;
    const email =
      p.work_email ||
      workEmailFromArr ||
      (Array.isArray(p.personal_emails) && p.personal_emails[0]) ||
      personalEmailFromArr ||
      emailsArr[0]?.address ||
      null;

    // Address: PDL exposes structured job-company location and personal location fields.
    // Prefer the JOB COMPANY street address (matches what users want for B2B contacts),
    // then fall back to the person's home street, then a city/region summary.
    const compStreet = [
      p.job_company_location_street_address,
      p.job_company_location_address_line_2,
    ].filter(Boolean).join(' ').trim() || null;
    const compCityLine = [
      p.job_company_location_locality,
      p.job_company_location_region,
      p.job_company_location_postal_code,
    ].filter(Boolean).join(', ') || null;
    const companyAddress = compStreet
      ? [compStreet, compCityLine].filter(Boolean).join(', ')
      : (p.job_company_location_name || null);

    const personStreet = [p.street_address, p.address_line_2].filter(Boolean).join(' ').trim() || null;
    const personCityLine = [p.location_locality, p.location_region, p.location_postal_code]
      .filter(Boolean).join(', ') || null;
    const personAddress = personStreet
      ? [personStreet, personCityLine].filter(Boolean).join(', ')
      : ([p.location_locality, p.location_region, p.location_country].filter(Boolean).join(', ') || null);

    const address = companyAddress || personAddress || null;

    // Phone: prefer mobile, then first listed work/general phone.
    const phone = p.mobile_phone || p.phone_numbers?.[0] || p.work_phone || null;

    return {
      source: 'pdl',
      likelihood: d.likelihood, // 1-10 (PDL's own confidence)
      email,
      phone,
      company: job,
      title: p.job_title || null,
      address,
      companyAddress,           // expose separately so aggregator can label it
      personAddress,
      photoUrl: null,           // PDL doesn't provide photos
      linkedinUrl: social.linkedin || null,
      socials: social,
      // Debug: which raw PDL keys were populated. Helps diagnose missing fields
      // without dumping PII to the client.
      _debugKeys: Object.keys(p).filter(k => p[k] != null && p[k] !== '' && !(Array.isArray(p[k]) && p[k].length === 0)),
    };
  } catch (e) { return { source: 'pdl', error: String(e?.message || e) }; }
}

// Debug helper — returns the raw PDL JSON for a contact. Mounted at
// GET /api/debug/pdl?name=...&email=... so you can inspect what PDL actually
// returned (vs. what our parser pulled out).
export async function rawLookup(contact) {
  if (!KEY) return { skipped: 'no-key' };
  const params = new URLSearchParams({ api_key: KEY, min_likelihood: '4', pretty: 'true' });
  if (contact.name) params.set('name', contact.name);
  if (contact.email) params.set('email', contact.email);
  if (contact.phone) params.set('phone', contact.phone);
  if (contact.company) params.set('company', contact.company);
  const r = await timedFetch(`https://api.peopledatalabs.com/v5/person/enrich?${params}`, {}, 15000);
  const d = await r.json();
  return { httpStatus: r.status, ...d };
}

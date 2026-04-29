// server/aggregator.js — merge source results into a single verified record.
// Confidence rubric:
//   95+   → auto-update (two independent sources agree, or canonical source like LinkedIn current-company)
//   70-94 → manual review
//   <70   → dropped
import { normalizePhone, normalizeEmail, normalizeName } from './util.js';

const FREE_EMAIL_DOMAINS = ['gmail.com','yahoo.com','hotmail.com','outlook.com','aol.com','icloud.com','me.com'];

// Per-source, per-field trust weights. Higher = more trusted.
const TRUST = {
  linkedin: { title: 95, company: 90, photoUrl: 95, address: 60, headline: 90 },
  pdl:      { email: 85, phone: 80, company: 80, title: 80, address: 70, linkedinUrl: 85 },
  hunter:   { email: 85, title: 60, phone: 55, linkedinUrl: 70 },
  serpapi:  { phone: 70, email: 65, company: 60, title: 55, address: 75, websiteUrl: 90, linkedinUrl: 85, photoUrl: 65 },
  website:  { phone: 75, email: 80, photoUrl: 75 },
  gravatar: { photoUrl: 70 },
};

const BOOST_AGREE = 20;      // two sources agree → add this
const PENALTY_CONFLICT = 15; // sources disagree → subtract
const AUTO_UPDATE_THRESHOLD = 95;
const MANUAL_REVIEW_THRESHOLD = 70;

function normEq(field, a, b) {
  if (a == null || b == null) return false;
  if (field === 'phone') return normalizePhone(a).replace(/^\+?1/, '') === normalizePhone(b).replace(/^\+?1/, '');
  if (field === 'email') return normalizeEmail(a) === normalizeEmail(b);
  if (field === 'company' || field === 'title') {
    const A = normalizeName(a), B = normalizeName(b);
    if (!A || !B) return false;
    // prefix similarity — good enough for "Smith & Co" vs "Smith and Company"
    const n = Math.min(A.length, B.length, 8);
    return A.slice(0, n) === B.slice(0, n) || A.includes(B.slice(0, n)) || B.includes(A.slice(0, n));
  }
  if (field === 'address') {
    return normalizeName(a).slice(0, 10) === normalizeName(b).slice(0, 10);
  }
  return String(a).toLowerCase() === String(b).toLowerCase();
}

/**
 * results: Array<{source, ...fields}>  — raw per-source outputs
 * original: the input contact (name, company, phone, email, address)
 */
export function aggregate(original, results) {
  const FIELDS = ['email', 'phone', 'company', 'title', 'address', 'linkedinUrl', 'photoUrl', 'websiteUrl'];
  const final = {};
  const fieldAudit = {};    // { fieldName: { value, confidence, sources, candidates } }
  const changes = [];
  const autoUpdate = [];
  const manualReview = [];

  for (const field of FIELDS) {
    // Collect candidates per-value, combining trust across agreeing sources.
    const candidates = new Map(); // key=normalized value → { value, confidence, sources }
    for (const r of results) {
      const v = r?.[field];
      if (!v || r.skipped) continue;
      const trust = TRUST[r.source]?.[field];
      if (!trust) continue;

      // Find existing candidate that matches
      let matched = null;
      for (const c of candidates.values()) {
        if (normEq(field, c.value, v)) { matched = c; break; }
      }
      if (matched) {
        matched.confidence = Math.min(99, matched.confidence + BOOST_AGREE);
        matched.sources.push(r.source);
      } else {
        candidates.set(`${r.source}:${v}`, { value: v, confidence: trust, sources: [r.source] });
      }
    }

    if (!candidates.size) continue;

    // Conflict penalty: if there are 2+ DIFFERENT candidates, knock the leader's confidence down.
    const ranked = [...candidates.values()].sort((a, b) => b.confidence - a.confidence);
    if (ranked.length >= 2) ranked[0].confidence = Math.max(0, ranked[0].confidence - PENALTY_CONFLICT);

    const winner = ranked[0];
    final[field] = winner.value;
    fieldAudit[field] = winner;

    // Compare to original
    const origVal = original?.[field === 'linkedinUrl' || field === 'websiteUrl' || field === 'photoUrl' ? '__skip__' : field];
    if (origVal && !normEq(field, origVal, winner.value)) {
      changes.push({ field, from: origVal, to: winner.value, source: winner.sources[0], confidence: winner.confidence });
    }

    if (winner.confidence >= AUTO_UPDATE_THRESHOLD) autoUpdate.push(field);
    else if (winner.confidence >= MANUAL_REVIEW_THRESHOLD) manualReview.push(field);
  }

  // Social profiles: flatten from any source that has them
  const social = {};
  for (const r of results) {
    if (!r?.socials) continue;
    for (const [k, v] of Object.entries(r.socials)) {
      if (v && !social[k]) social[k] = v;
    }
  }
  if (Object.keys(social).length) final.social = social;

  // Email domain sanity — free email from a realtor/lawyer = suspicious, knock it down
  if (final.email) {
    const domain = final.email.split('@')[1] || '';
    if (FREE_EMAIL_DOMAINS.includes(domain) && fieldAudit.email) {
      fieldAudit.email.confidence = Math.max(0, fieldAudit.email.confidence - 10);
    }
  }

  // Overall
  const overallConfidence = Math.round(
    Object.values(fieldAudit).reduce((s, c) => s + c.confidence, 0) / Math.max(1, Object.keys(fieldAudit).length),
  );
  let overall = 'not-found';
  if (fieldAudit.company && fieldAudit.company.confidence >= AUTO_UPDATE_THRESHOLD
      && original?.company && !normEq('company', original.company, fieldAudit.company.value)) {
    overall = 'changed'; // moved firms — critical signal for Agent Office → Top Producer migration
  } else if (autoUpdate.length >= 2) overall = 'verified';
  else if (autoUpdate.length + manualReview.length >= 2) overall = 'partial';
  else if (Object.keys(fieldAudit).length === 0) overall = 'not-found';
  else overall = 'partial';

  return {
    overall,
    confidence: overallConfidence,
    verified: final,
    original,
    changes,
    sources: [...new Set(results.filter(r => r && !r.skipped).map(r => r.source))],
    autoUpdate,
    manualReview,
    fieldAudit,
    timestamp: new Date().toISOString(),
  };
}

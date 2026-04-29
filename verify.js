// server/verify.js — orchestrates all sources for a single contact.
import * as serpapi   from './sources/serpapi.js';
import * as hunter    from './sources/hunter.js';
import * as linkedin  from './sources/linkedin.js';
import * as pdl       from './sources/pdl.js';
import * as website   from './sources/website.js';
import * as gravatar  from './sources/gravatar.js';
import { aggregate } from './aggregator.js';
import { getCached, setCached } from './cache.js';

export function sourceStatus() {
  return {
    serpapi:  serpapi.available(),
    hunter:   hunter.available(),
    linkedin: linkedin.available(),
    pdl:      pdl.available(),
    website:  true,
    gravatar: true,
  };
}

export async function verifyContact(contact, opts = {}) {
  const { skipCache = false } = opts;
  if (!skipCache) {
    const cached = getCached(contact);
    if (cached) return { ...cached, _fromCache: true };
  }

  const results = [];

  // Phase 1 — parallel high-signal sources
  const [pdlRes, serpRes] = await Promise.all([
    pdl.lookup(contact),
    serpapi.lookup(contact),
  ]);
  results.push(pdlRes, serpRes);

  // Phase 2 — sources that depend on Phase 1 findings
  const linkedinUrl = pdlRes?.linkedinUrl || serpRes?.linkedinUrl;
  const websiteUrl  = serpRes?.websiteUrl;
  const websiteDomain = websiteUrl ? (() => { try { return new URL(websiteUrl).hostname.replace(/^www\./, ''); } catch { return null; } })() : null;

  const [liRes, huntRes, webRes] = await Promise.all([
    linkedin.lookup(linkedinUrl),
    hunter.lookup(contact, { websiteDomain }),
    website.lookup(contact, { websiteUrl }),
  ]);
  results.push(liRes, huntRes, webRes);

  // Phase 3 — photo fallback via email we now know
  const knownEmail = results.find(r => r?.email)?.email || contact.email;
  const gravRes = await gravatar.lookup(knownEmail);
  results.push(gravRes);

  const merged = aggregate(contact, results);
  setCached(contact, merged);
  return merged;
}

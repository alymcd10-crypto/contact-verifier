// server/util.js — tiny shared helpers
export const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const RE_PHONE = /^\+?[\d\s().\-]{7,20}$/;

export function normalizePhone(p) {
  return String(p || '').replace(/[^\d+]/g, '');
}
export function normalizeEmail(e) {
  return String(e || '').toLowerCase().trim();
}
export function normalizeName(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function extractPhones(text) {
  const re = /\b(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;
  return [...new Set((String(text).match(re) || []).map(p => p.trim()))];
}
export function extractEmails(text) {
  const re = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  return [...new Set((String(text).match(re) || []).map(e => e.toLowerCase()))]
    .filter(e => !e.match(/\.(png|jpe?g|gif|svg|webp|css|js)$/))
    .filter(e => !/^(noreply|no-reply|donotreply|info|support|admin|webmaster|contact|hello)@/i.test(e));
}

export async function timedFetch(url, options = {}, timeoutMs = 10000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...options, signal: ctl.signal });
    return r;
  } finally {
    clearTimeout(t);
  }
}

export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

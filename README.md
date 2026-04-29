# Contact Verifier

A **real** contact verification pipeline for realtors and lawyers. Takes a CSV of stale contacts (name, old company, old phone/email) and returns current verified data — company, title, phone, email, address, photo, LinkedIn URL, social profiles — pulled from multiple live sources.

Built for migrating **8,000+ contacts from Agent Office → Top Producer** without uploading dead/outdated records. Designed as a reusable API so it can plug into a custom CRM later.

---

## Architecture

```
contact-verifier.html        ← browser UI (upload CSV, review results)
          ↓ fetch
server/                      ← Node.js + Express API
  ├── sources/               ← pluggable data-source modules
  │    ├── serpapi.js        (Google Search, Maps, Images)
  │    ├── hunter.js         (email finder)
  │    ├── linkedin.js       (RapidAPI Fresh LinkedIn Profile Data)
  │    ├── pdl.js            (People Data Labs — bulk enrichment)
  │    ├── website.js        (CORS-free company website scrape)
  │    └── gravatar.js       (email-based photo lookup)
  ├── aggregator.js          ← merges source results, scores confidence
  ├── cache.js               ← SQLite cache (never re-query unless stale)
  ├── jobs.js                ← in-memory batch job queue with rate limiting
  ├── routes.js              ← POST /api/verify, /api/verify/batch, GET /api/verify/:jobId
  └── index.js               ← Express app entry
```

---

## Quick start

```bash
cd server
cp .env.example .env
# edit .env and add your API keys (see below)
npm install
npm start
# → API listening on http://localhost:3001
```

Then open `contact-verifier.html` in a browser. It will auto-detect the local server.

---

## API keys you need

Order of priority — get them in this order as budget allows:

| Service | What it gives you | Free tier | Paid tier | Signup |
|---|---|---|---|---|
| **SerpAPI** | Google Search, Maps, Images | 100 searches/mo | $50/mo → 5k searches | [serpapi.com](https://serpapi.com) |
| **Hunter.io** | Find work email by name + domain | 25 lookups/mo | $49/mo → 500 | [hunter.io](https://hunter.io) |
| **RapidAPI** | LinkedIn profile data (photo, title, company) | Varies | ~$10/mo | [rapidapi.com](https://rapidapi.com/freshdata-freshdata-default/api/fresh-linkedin-profile-data) |
| **People Data Labs** | Bulk person enrichment (best single source) | 100 free credits | $0.10-0.20/match | [peopledatalabs.com](https://peopledatalabs.com) |

**For 8,000 contacts:** PDL at $0.10/match ≈ **$800 one-time** to enrich everything, then ~$50 in SerpAPI for re-checks and ~$49 for Hunter to clean emails. **~$900 total** to clean 40 years of data.

---

## Endpoints

### `POST /api/verify`
Verify a single contact synchronously (blocks up to ~15s).

```json
// request
{ "name": "Jane Doe", "type": "realtor", "company": "Old Firm", "email": "...", "phone": "...", "address": "..." }

// response
{
  "overall": "verified" | "partial" | "changed" | "not-found",
  "confidence": 0-100,
  "verified": { "email": "...", "phone": "...", "company": "...", "title": "...", "linkedin": "...", "photo": "...", "social": {...} },
  "original": { ...echoed input },
  "changes": [{ "field": "company", "from": "Old Firm", "to": "New Firm", "source": "linkedin", "confidence": 92 }],
  "sources": ["serpapi", "linkedin", "website"],
  "autoUpdate": ["company", "title"],
  "manualReview": ["phone"]
}
```

### `POST /api/verify/batch`
Queue a batch. Returns a `jobId` immediately.

```json
{ "contacts": [{...}, {...}, ...], "options": { "concurrency": 3 } }
→ { "jobId": "abc123", "total": 8000, "status": "queued" }
```

### `GET /api/verify/:jobId`
Poll batch progress + partial results.

```json
{ "status": "running", "progress": 142, "total": 8000, "results": [ ...finished so far ] }
```

### `GET /api/health`
Sanity check. Returns which source keys are configured.

---

## Auto-update vs manual review rubric

The aggregator scores each **field** (not the whole contact) on confidence 0-100:

- **95+** → auto-update (two independent sources agree, or one canonical source like LinkedIn's current company)
- **70-94** → flagged for manual review (one source, plausible but unconfirmed)
- **< 70** → dropped (low-quality signal, not surfaced)

You'll see every change with its source so you can audit.

---

## Deployment (for CRM integration later)

Recommended: **Railway** (easiest) or **Fly.io** (cheapest for always-on).

```bash
# Railway
railway login
railway init
railway up
# set env vars in dashboard
```

The API is stateless except for the SQLite cache, which lives in `server/data/cache.db`. For production, swap SQLite → Postgres (trivial; the `cache.js` interface is ~20 lines).

---

## CRM integration path

Once the API is deployed, your custom React/Next.js CRM calls it exactly like the HTML frontend does:

```js
const verified = await fetch(`${VERIFIER_API}/api/verify`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
  body: JSON.stringify(contact),
}).then(r => r.json());
```

For lead verification (your Remine use case) just POST the new lead to `/api/verify` — same endpoint, same response shape.

---

## What this does NOT do (yet)

- Auth — right now any caller can hit the API. Add Clerk or Supabase Auth before exposing publicly.
- Webhooks — no push notifications when a batch finishes; you poll.
- Instagram/Facebook deep scraping — only surfaces profile URLs found via Google, doesn't log in.
- Professional license live-checks (state bar, NAR) — stubbed, not implemented. Call them out as a Phase 2 source if you want it.

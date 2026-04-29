# Hearth CRM

Real estate CRM for the McDonnell Team. Replaces Agent Office + Top Producer.

**The thesis:** Top Producer routes outbound SMS through an email-approval
step that lands in spam filters — that kills speed-to-lead. Hearth sends SMS
directly through Twilio with TCPA consent gates built in, and **Harper**, the
AI lead qualifier, takes the first touch within seconds (research: responding
within 1 minute converts 391% better than within 2).

## Current state — v0.5

- **Harper (LIVE):** AI lead qualifier on SMS. New web-form lead arrives →
  Harper sends the first message immediately → 2-5 turn qualification →
  hands off to Leslie with a structured summary task. Uses `claude-haiku-4-5`
  (~$0.001 per reply). Falls back to a canned greeting + instant handoff if
  no `ANTHROPIC_API_KEY` is set.
- **Backend:** FastAPI + SQLAlchemy + SQLite/Postgres. **76 tests passing**
  (12 new for Harper).
- **Frontend:** React 18 + Vite, Hearth design language.
- **Data model:** Lead vs Contact separation with identity-based dedup.
- **Action plans:** 39 plans (945 steps) parsed from the team's A2K exports.
- **TCPA:** SMS consent gated on every send. Web-form lead sources
  (Dakno, Zillow, Realtor.com, Facebook, Instagram, Remax, Google Business)
  grant implied consent. CSV imports and manual entry do not.
- **Scheduler:** APScheduler fires action-plan steps every 5 minutes.
- **Twilio webhook:** Public endpoint at `/api/webhooks/twilio/sms` with
  HMAC-SHA1 signature validation (auth-token-based, not JWT).

## Not yet built (on the roadmap)

The other seven AI agents — Cove (scheduler), Linden (voice), Atlas (CMA),
Fern (nurture drip), Roan (TC), Juniper (listing copy), Bay (social) — are
placeholders on the **AI Agents** page. We'll build them one at a time,
prioritized by which pain point is next.

Also not yet built: MLS feed (MRED credentials pending), transaction module,
calendar integration, email via Microsoft 365 Graph API.

## Running locally

```bash
cd backend
python3 -m pip install -r requirements.txt
python3 -m uvicorn app.main:app --reload

cd frontend
npm install
npm run dev
```

## Configuration

Environment variables (all optional in demo mode):

- `DATABASE_URL` — Postgres URL; SQLite if unset
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` —
  SMS sending + webhook signature validation. If unset, messages stored
  with status `demo`.
- `ANTHROPIC_API_KEY` — Claude API key for Harper. If unset, Harper runs in
  fallback mode (canned greeting + instant handoff to Leslie).
- `HARPER_ENABLED` — `1` (default) to run Harper; `0` to disable
- `HARPER_MAX_TURNS` — hard stop on conversation length (default 8)
- `HARPER_HANDOFF_AGENT_ID` — agent ID who receives handoff tasks
  (default: first admin, i.e. Leslie)
- `HARPER_MODEL` — override model (default `claude-haiku-4-5`)
- `CORS_ORIGINS` — comma-separated; defaults to `*`
- `LOG_LEVEL` — defaults to INFO

## Twilio webhook setup

In the Twilio console, set the SMS webhook URL for your number to:
```
https://your-domain.com/api/webhooks/twilio/sms
```
Method: `POST`. Twilio's `X-Twilio-Signature` header is validated against
`TWILIO_AUTH_TOKEN` automatically.

## Data model (short version)

- **Agent** — team members (Leslie, Joan, Danielle, Liz, Mark)
- **Contact** — canonical person/household. Has `score` (0-100 fit),
  `ai_flag` (last AI action summary), `budget`, lead status, SMS/email
  consent, assigned agent
- **ContactIdentity** — emails, phones; normalized for dedup
- **Lead** — inbound raw capture with source, dedup confidence
- **HarperConversation** — tracks Harper state (qualifying / handed_off /
  opted_out / booked / expired / error), extracted facts (timeline,
  budget, location, financing, motivation), turn count, handoff reason
- **Activity** — notes, calls, SMS, emails, plan-starts, consent changes,
  AI interactions
- **Task** — scheduled follow-ups, from action plans or manual entry.
  Harper creates these on handoff
- **Message** — SMS record with direction, status, auto-fire flag
- **ActionPlan** / **ActionPlanStep** / **ActionPlanAssignment**
- **AuditLog** — PII access, blocked messages, consent changes

## Frontend routes

- `/` — Today (morning brief, Harper handoff count, speed-to-lead)
- `/pipeline` — 6-stage kanban
- `/contacts` — list with search/filters
- `/contacts/:id` — detail with Harper panel in sidebar
- `/inbox` — review queue for ambiguous lead matches
- `/messages` — SMS conversations
- `/tasks` — grouped by overdue / today / this week / later
- `/plans` — action plan library + step preview
- `/agents` — AI workforce; Harper shown live with recent conversations
- `/listings`, `/transactions` — placeholders (not yet built)
- `/import` — CSV upload
- `/settings` — team, integrations, about

## Versions

- v0.1: backend skeleton, dedup, action plans
- v0.2: tests, scheduler, TCPA enforcement, speed-to-lead metrics
- v0.3: editorial frontend (replaced)
- v0.4: Hearth rebrand
- **v0.5: Harper live** — AI lead qualifier on SMS, public Twilio webhook,
  Harper API + panel, AgentsPage promoted Harper to live

# Closetry Backend — Phase 1 + Phase 2 + Phase 3 + Phase 4 (complete) + Phase 6 (production hardening)

**Branding note:** the app is now named **Closetry**, with the AI stylist
named **Ava** — `app.json`, `package.json`, and the Contact-us email
sender/subject in `config/email.js` all reflect this. This project's
folder itself is now `closetry-backend` (renamed from `wardrobebackend`).
Internal code names (`ClothingItem`, the `Wardrobe` tab, etc.) still say
"Wardrobe" where that's a feature label rather than the app's brand —
see the mobile README for the distinction.

## Profile / account management (new)

`PATCH /api/users/me` (name/email/phone/theme), `POST /api/users/me/avatar`
(multipart `photo`, same Cloudinary/local-fallback pattern as item photos
but no background removal — a face photo shouldn't get that treatment),
`POST /api/users/me/password` (requires `currentPassword` + `newPassword`,
re-verifies the current one before allowing the change), and
`DELETE /api/users/me` (requires `password` in the body as an extra
confirmation step beyond just the bearer token before a destructive,
irreversible action — cascades through every table via the schema's
`onDelete: Cascade`, so this really does delete everything, per the "real
delete, not archive" rule in `09_GHID_PRIVACY_SI_POLITICI.md`).

`register`/`login`/`me` now all return `phone`, `avatarUrl`, and `theme`
(`"gold" | "dark" | "light"`, default `"gold"`) alongside the existing
fields — `auth.controller.js` exports `PUBLIC_USER_FIELDS` so every
endpoint that returns a user shares one field list instead of drifting
apart. No new migration needed for any of this — `phone`/`avatarUrl`/
`theme` were already added to `User` in an earlier update.

Auth (email/password + JWT, now with policy-acceptance tracking),
`ClothingItem` CRUD (now including a `swimwear` category), the AI outfit
generator (`GenerationSession` + `Outfit`, now event-linkable and
name-searchable), all of Phase 4: auto-tagging, weather-aware generation,
My Events, Smart Closet, and a feedback-signal table for possible future
personalization — scoped per user throughout. Phase 5 (monetization) was
deliberately skipped for now to get to publishing faster; Phase 6 adds
production hardening (rate limiting, security headers, logging, image
delivery optimization) on top of the Phase 1-4 feature set.

## Latest update (post-Phase-6)

- **`swimwear`** added as a full category — `Category` enum in the Prisma
  schema, `validators.js`, and the classification prompt all updated
  together (it's a real Prisma enum, unlike `subcategory`/`material`
  which stay app-validated strings — see `02-data-model.md`).
- **Policy acceptance at registration** — `POST /api/auth/register` now
  requires `acceptedPolicies: true` in the body (400 otherwise) and
  records `User.acceptedPoliciesAt`.
- **`Outfit.eventId`** (soft reference, no FK — same pattern as
  `StylePreferenceSignal.sessionId`) lets an outfit be tagged with the
  event it was generated for. `GET /api/outfits` gained `?eventId=` and
  `?name=` (partial match) filters alongside the existing `occasion`/
  `favorite`/`season`.
- **`User` schema extended** ahead of its UI (`phone`, `avatarUrl`,
  `theme` — default `"gold"`) — same "drafted now, built later" pattern
  as `Event`/`Recommendation` before them. Nothing reads/writes these
  yet beyond the default.

## Phase 6 — production hardening

- **`helmet()`** — standard security headers, applied globally, first in
  the middleware chain.
- **`morgan`** — request logging, `combined` format when
  `NODE_ENV=production`, `dev` (terser) otherwise.
- **Rate limiting** (`middleware/rateLimits.js`), three tiers:
  - `generalLimiter` — 300 req/15min per IP, applied to everything.
  - `authLimiter` — 20 req/15min per IP, applied only to `/api/auth/*`
    (register/login/me) — basic brute-force protection.
  - `aiLimiter` — 60 req/hour per IP, applied only to the endpoints that
    actually call an external paid API per request: Generate
    (`POST /api/generation/sessions/:id/messages`), auto-tagging
    (`POST /api/items/classify`), and event outfit generation
    (`POST /api/events/:id/generate`). **This is not the same thing as
    Phase 5's planned per-user freemium quotas** — those are keyed on a
    `Subscription` tier and don't exist yet; this is just baseline
    per-IP abuse/cost protection. Smart Closet's `GET` is deliberately
    NOT under this limiter — it only calls the model for genuinely new
    facts (see its caching logic), so it doesn't carry the same
    per-request cost as the others.
- **CORS** — configurable via `CORS_ORIGIN` (comma-separated list);
  unset = permissive, matching dev defaults. The mobile app itself isn't
  subject to CORS (it's not a browser) — this mainly matters if a
  browser-based client gets added later.
- **`trust proxy`** — enabled when `NODE_ENV=production`, needed for
  correct client-IP detection (rate limiting, logging) behind a reverse
  proxy/load balancer (Render, Railway, Fly.io, Heroku, etc.).
- **Image delivery optimization** — `config/cloudinary.js`'s
  `optimizeDeliveryUrl()` rewrites every stored Cloudinary URL to request
  `f_auto,q_auto,w_1200` instead of the raw upload. Phone camera photos
  routinely come in far larger than anything in this app ever displays;
  this is a URL rewrite (Cloudinary transforms + caches on first
  request), not a re-upload — the original is untouched. 4 new tests in
  `test/cloudinary.test.js`.

None of this required a schema change — no new migration for Phase 6.

## Stack
- Node.js + Express
- PostgreSQL via Prisma ORM
- JWT auth (bcrypt password hashing) — see note below on Firebase/Auth0
- Multer for local dev photo uploads (swap for Cloudinary/S3 before launch)
- Anthropic API (`@anthropic` Messages endpoint) — text-only for outfit
  generation and Smart Closet phrasing, vision for auto-tagging
- OpenWeatherMap for current-conditions weather
- `helmet`, `morgan`, `express-rate-limit` for production hardening (Phase 6) — see below

## Setup

```bash
npm install
cp .env.example .env
# edit .env: set DATABASE_URL to a real Postgres instance, and JWT_SECRET
# (generate one with: openssl rand -hex 32)
# also set ANTHROPIC_API_KEY (console.anthropic.com) — required for the
# Generate endpoints below; everything else works without it

npx prisma generate
npx prisma migrate dev --name init

npm run dev   # nodemon, http://localhost:4000
```

`GET /health` should return `{ "status": "ok" }` once it's running.

## Endpoints (Phase 1 scope)

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/auth/register` | — | `{ name, email, password }` |
| POST | `/api/auth/login` | — | `{ email, password }` → `{ user, token }` |
| GET | `/api/auth/me` | Bearer token | current user |
| GET | `/api/items` | Bearer token | list, filter via `?category=&color=&material=&season=&tag=&archived=` |
| GET | `/api/items/:id` | Bearer token | single item |
| POST | `/api/items/classify` | Bearer token | multipart `photo` → vision-classified suggestion (category/color/material/season/pattern/brand), never persisted — see below |
| POST | `/api/items` | Bearer token | `multipart/form-data` with optional `photo` file, plus `category/subcategory/color/material/season/brand/tags` |
| PATCH | `/api/items/:id` | Bearer token | partial update — also how auto-tagging (Phase 4) suggestions get user-confirmed/edited, never silent |
| DELETE | `/api/items/:id` | Bearer token | real delete (use `PATCH { archived: true }` for soft-archive) |
| POST | `/api/generation/sessions` | Bearer token | start a new outfit-generation chat session |
| GET | `/api/generation/sessions` | Bearer token | list the user's sessions, newest first (id/timestamps only) |
| GET | `/api/generation/sessions/:id` | Bearer token | full session incl. `messages[]` |
| POST | `/api/generation/sessions/:id/messages` | Bearer token | `{ content, contextSeason? }` → runs one generation turn, returns hydrated outfit suggestions |
| POST | `/api/outfits` | Bearer token | `{ occasion, itemIds[], name? }` → save a generated (or any) outfit |
| GET | `/api/outfits` | Bearer token | list saved outfits, `?occasion=&favorite=&season=`, newest first, hydrated with item data |
| GET | `/api/outfits/:id` | Bearer token | single outfit, hydrated |
| PATCH | `/api/outfits/:id` | Bearer token | `{ name?, isFavorite? }` — rename and/or toggle favorite |
| DELETE | `/api/outfits/:id` | Bearer token | real delete |
| POST | `/api/outfits/:id/worn` | Bearer token | `{ date? }` (defaults to now) — appends to the worn-on log |
| POST | `/api/feedback` | Bearer token | `{ itemIds[], occasion, rating: 'up'\|'down', rationale?, sessionId? }` — writes a `StylePreferenceSignal`, isolated table, see below |
| POST | `/api/contact` | Bearer token | `{ subject?, message }` → emails the message via Resend to `CONTACT_EMAIL_TO`, using the authenticated user's own name/email |
| GET | `/api/weather?lat=&lon=` | Bearer token | current conditions (OpenWeatherMap) + a calendar-derived `season` — see below |
| POST | `/api/events` | Bearer token | `{ name, date, occasionType, dressCode?, location? }` |
| GET | `/api/events?upcoming=` | Bearer token | list events; `upcoming=true` filters to `date >= now`, sorted soonest-first |
| GET/PATCH/DELETE | `/api/events/:id` | Bearer token | fetch/edit/delete one event — PATCH also accepts `linkedOutfitId` (ownership-checked) |
| POST | `/api/events/:id/generate` | Bearer token | `{ lat?, lon? }` → one-shot outfit suggestions for the event, see below |
| GET | `/api/smart-closet` | Bearer token | deterministic gap analysis, AI-phrased, cached — see below |
| POST | `/api/smart-closet/:id/dismiss` | Bearer token | hides one insight from future responses |

## Weather (Phase 4)

`GET /api/weather?lat=&lon=` calls OpenWeatherMap (`OPENWEATHER_API_KEY`
in `.env` — 503 if unset, same pattern as the Anthropic key) and returns
current temperature/condition **plus** a `season` field. That `season` is
deliberately **not** derived from temperature — it's the calendar month
mapped to a Northern-hemisphere season (see the comment on
`deriveSeasonFromMonth` in `weather.controller.js`; there's no
hemisphere detection, so this is wrong for southern-hemisphere users
today). Temperature is noisy day-to-day and shouldn't reclassify a cold
February afternoon as "spring" for wardrobe filtering purposes.

The mobile client passes both independently to
`POST /api/generation/sessions/:id/messages`:
- `contextSeason` → the existing `checkSeason` hard filter (Phase 2, was
  already wired up, just unused until now).
- `contextTemp` (°C) + `weatherCondition` → shown to the model directly in
  the prompt (so it can reason about rain/wind judgment calls a fixed rule
  can't capture) **and** enforced by two new rules in
  `outfitValidity.js`:
  - `checkLayering` — **hard** filter: below 10°C, an outfit needs an
    `outerwear` item or it's rejected. This is the exact rule sketched in
    `12_ARHITECTURA_AI_SI_COMPUTER_VISION1.md` §1 ("sub 10°C exclude
    tricouri fără strat peste").
  - `checkHeatMaterials` — **soft** filter: above 27°C, wool/leather/
    cashmere items get a `warning` note, same non-blocking pattern as
    color coordination, since a leather jacket on a hot evening can still
    be a deliberate choice.

Both thresholds (10°C / 27°C) are round numbers, not derived from any
real data — see the comment in `outfitValidity.js` if you want to tune
them once there's real usage.

All of this is fully optional end to end: if the client never calls
`/api/weather` (permission denied, no `OPENWEATHER_API_KEY`, etc.),
`contextTemp`/`weatherCondition` are simply omitted from the generation
request and every new check is a no-op — Phase 2/3 behavior, unchanged.

## My Events (Phase 4)

`Event` (`name`, `date`, `occasionType`, `dressCode?`, `location?`,
`linkedOutfitId?`, `weatherSnapshot?`) is plain CRUD, same ownership
pattern as everything else. The one interesting piece is
`POST /api/events/:id/generate`:

- It does **not** create a `GenerationSession` — it's a separate, one-shot
  entry point into the same `generateOutfits()` used by the Generate chat
  (`generation.service.js`). Not a parallel/duplicate implementation, the
  exact same function, just called with `sessionMessages: []` and a
  synthesized occasion string built from the event's fields.
- `contextSeason` always comes from the event's own `date` (via
  `deriveSeasonFromMonth`, reused from the weather controller) — this
  works for any future date, unlike weather.
- `contextTemp`/`weatherCondition` only get attached if the event is
  within `WEATHER_LOOKAHEAD_MS` (2 days) **and** the client sent
  `lat`/`lon`. This is a real limitation worth knowing: we only integrated
  OpenWeatherMap's *current*-weather endpoint (see the Weather section
  above), not a forecast API, so "weather for an event 3 weeks out" isn't
  attempted at all rather than guessed from today's conditions.
- On success, `weatherSnapshot` is saved onto the `Event` purely as a
  record of what conditions the outfit was generated against — it's never
  read back into any generation call.
- `linkedOutfitId` is set separately, via a normal
  `PATCH /api/events/:id` once the user actually saves one of the
  suggested outfits (`POST /api/outfits`, unchanged) — generation and
  linking are two distinct steps, not one atomic action.

## Smart Closet (Phase 4 — last piece)

Three-layer pipeline, deliberately split across three files so the
boundary in `03-ai-integration.md` (gap_analysis must never share a
prompt, session, or code path with outfit generation or shopping
recommendations) is structural, not just a convention:

1. **`services/wardrobeGapAnalysis.js`** — pure, deterministic, zero I/O.
   Takes the wardrobe array, returns `fact` objects (`key`, a plain-English
   `fact` sentence, and the supporting numbers). This is the ONLY place
   that decides what's true. Three rules ship: category imbalance (lots of
   one core category, almost none of another), a shoe formality gap
   (several casual shoes, zero formal ones — the literal example from
   `12_ARHITECTURA_AI_SI_COMPUTER_VISION1.md` §1, includes a rough
   "unlocks ~N combinations" estimate), and season coverage (zero items
   tagged for a given season, only checked once the wardrobe is large
   enough for that to mean something). 11 tests, all pure — no mocking
   needed since there's no I/O to mock.
2. **`services/smartCloset.service.js`** — the ONLY place that calls
   Claude for this feature. Its prompt only ever sees `{ key, fact }`
   pairs, never raw item data, and its job is explicitly restricted to
   rephrasing, not deciding — the system prompt tells it not to invent or
   change any number. A phrasing that references a `key` we didn't ask
   about is dropped (same grounding discipline as generation/
   classification). If this call fails entirely (no key, network error),
   callers fall back to the plain deterministic `fact` string — Smart
   Closet still works, just less warmly worded.
3. **`controllers/smartCloset.controller.js`** — orchestrates the two
   above and caches results in `Recommendation` (`type: gap_analysis`),
   keyed by each fact's stable `key`. A gap that's still present next
   time doesn't get re-phrased (cheaper, and consistent wording); a gap
   that's no longer present (user added the missing item) gets its row
   deleted rather than left stale; a dismissed insight
   (`POST /:id/dismiss`) stays hidden until the gap fully resolves and
   reappears later as a new row.

Neither `generation.service.js` nor `classification.service.js` is
imported anywhere in this pipeline, and neither of them imports anything
from it — there's no code path for a Smart Closet insight to influence an
outfit suggestion, or vice versa.

## Contact us (Resend)

`POST /api/contact` requires auth (not an anonymous form) so the sender
identity always comes from the DB (`user.name`/`user.email`), never from
something the client could spoof in the request body. `config/email.js`
wraps Resend; if `RESEND_API_KEY` isn't set, the endpoint returns 503
with a clear message instead of a silent failure. `replyTo` is set to the
user's own email, so replying to the notification in your inbox goes
straight back to them. Rate-limited to 5/hour per IP
(`middleware/rateLimits.js`'s `contactLimiter`) to protect the inbox from
being flooded.

`CONTACT_EMAIL_TO` defaults to `cristianpoenaru7@gmail.com` if unset.
`CONTACT_EMAIL_FROM` defaults to Resend's shared sandbox sender
(`onboarding@resend.dev`), which works without verifying your own
domain — fine for testing, but swap it for a verified address before
real launch (better deliverability, and Resend may restrict sandbox-sender
volume in production).

**Unverified, same caveat as every other external API in this project:**
no real `RESEND_API_KEY` in this sandbox, so the actual send call was
never exercised. Send yourself a real test message once you've added the
key and confirm it lands.

## Style preference signals (future-training data, not a live feature)

Every outfit card in the Generate chat has a 👍/👎. Tapping one calls
`POST /api/feedback`, which writes to `StylePreferenceSignal` —
`prisma/schema.prisma` has the full reasoning in its comment, but the
short version: this table is **isolated on purpose**. Nothing else in the
app reads from it, it doesn't personalize today's generations, and it has
no relation-cascade coupling to `GenerationSession` (a signal survives
even if its session is later deleted). Its only job is to accumulate real
`{ occasion, itemIds, rationale, rating }` records so that *if* the
trigger conditions in `12_ARHITECTURA_AI_SI_COMPUTER_VISION1.md` §7 are
ever actually met, a future style-reasoning model has real preference
data instead of zero. There's no export/list endpoint yet — for now,
`npm run prisma:studio` is the way to look at what's accumulated.

Auth on every protected route: header `Authorization: Bearer <token>`.

## Outfit generation (Phase 2)

`POST /api/generation/sessions/:id/messages` is the core endpoint. On each
call it:
1. Loads the user's non-archived wardrobe fresh from the DB.
2. Replays the session's recent message history (last 20 entries) to the
   model so follow-ups like "something without the dress" resolve against
   what was already suggested — see `03-ai-integration.md`.
3. Calls Claude (text-only, `CLAUDE_MODEL` in `.env`, defaults to
   `claude-sonnet-5`) with a system prompt that requires strict JSON output
   referencing only real wardrobe item ids.
4. **Grounds** the response: any item id the model returns that isn't
   actually in the wardrobe is dropped. This never trusts the model's ids
   at face value.
5. Runs the **deterministic validity layer**
   (`src/services/outfitValidity.js`) on what's left — composition
   (top+bottom or dress, plus shoes) is a hard filter; season is a hard
   filter only when the caller passes `contextSeason` (unused until Phase
   4's weather/event context); basic color coordination is soft — it
   annotates a `warning`, it never silently drops an otherwise-good outfit
   on its own.
6. Persists a compact form (item ids + rationale text, not full item
   objects) to `GenerationSession.messages`, and returns a hydrated form
   (full item objects, for immediate thumbnail rendering) to the caller.

If `ANTHROPIC_API_KEY` isn't set, this endpoint returns `503` with a clear
message instead of a confusing fetch failure — everything else in the API
still works without it.

Smart Closet and shopping recommendations (Phase 4/5) must never reuse this
service or its prompt — see the hard boundary in `03-ai-integration.md` and
`11_GHID_MONETIZARE_SI_BUSINESS_MODEL.md`.

## Photo storage & background removal

Background removal runs **locally**, via a separate Python microservice
in `/bg-removal-service` (rembg + u2net, both permissively licensed — no
external API, account, or per-image cost). See that folder's README to
set it up and start it. This backend calls it at `http://localhost:5001`
by default (`BG_REMOVAL_URL` in `.env` to override). If it's not running,
uploads still succeed — they just skip background removal and log a
warning, so you can work on other features without it up.

Storage (where the resulting photo ends up) is a separate concern from
removal: Cloudinary if configured (optional, for a real CDN), otherwise
local disk (dev only). To use Cloudinary: create a free account, copy the
three keys from Settings → API Keys into `.env`. No add-on needs
enabling — Cloudinary is storage-only here, it doesn't do the removal.

## Why JWT instead of Firebase Auth / Auth0 right now

`05-tech-stack-and-constraints.md` recommends Firebase Auth or Auth0 to
avoid rolling custom auth. That's still the right call for real
production — but wiring either one up requires *your* project credentials
(Firebase project / Auth0 tenant), which I don't have here.

So this scaffold uses a small, isolated JWT + bcrypt module
(`src/utils/authUtils.js`) instead, as a placeholder that's easy to swap:
- `register`/`login` in `src/controllers/auth.controller.js` are the only
  places that would change.
- `requireAuth` middleware (`src/middleware/auth.js`) would swap its
  token-verification call for Firebase Admin SDK / Auth0's JWT verification.
- Nothing in `items.controller.js` or the routes needs to change — they
  only depend on `req.userId` being set, not on how it got there.

**Recommendation:** swap to Firebase Auth or Auth0 before this goes to real
users — don't ship custom auth to production. Tell me when you have a
Firebase/Auth0 project set up and I'll wire it in.

## What I could NOT verify in this sandbox

**Phase 6 note:** `npm install` was run for real this time (unlike
earlier updates), so `helmet`/`morgan`/`express-rate-limit` are confirmed
installable and 48/48 tests pass with them present. What's still
unverified: the app was never actually **booted** — `new PrismaClient()`
in `config/db.js` throws immediately without a generated client
(`prisma generate` needs `binaries.prisma.sh`, blocked in this sandbox),
so I couldn't confirm the full middleware chain (`helmet` → `morgan` →
`cors` → rate limiters → routes) actually works end-to-end against a real
request. I reviewed it by reading, not by running it. Start the server for
real and hit `/health` first — if that works, the chain is fine.

**New this update:** `prisma/schema.prisma` changed again — `swimwear`
added to the `Category` enum, `User` gained `phone`/`avatarUrl`/`theme`/
`acceptedPoliciesAt`, `Outfit` gained `eventId`. On top of the
still-pending `Recommendation`/`RecommendationType`, `Event`, and
`StylePreferenceSignal`/`PreferenceRating` from earlier updates if you
haven't migrated since then. Run `npx prisma migrate dev` (or
`npm run prisma:migrate`) before starting the server — an enum value
change (`swimwear`) needs a migration same as a new table would, or
saving an item with that category will fail against the old enum.

This sandbox's network is restricted to a fixed allow-list of domains
(npm registry, GitHub, PyPI, etc.) — it does **not** include
`binaries.prisma.sh`, so `npx prisma generate` / `prisma validate` fail
here with a 403 on the engine binary download. I syntax-checked every
`.js` file (`node --check`, all pass) and reviewed the Prisma schema by
hand, but I have not run this against a real PostgreSQL database or
confirmed `prisma generate` succeeds on your machine. Run the Setup steps
above in your own environment (which has normal internet access) and tell
me if `prisma generate`/`migrate` throws anything — I'll fix it from the
error.

## Database migration needed after this update

Two schema changes since the last version: `isFavorite` on `ClothingItem`,
and photo uploads now go through Cloudinary instead of local disk. Run:

```bash
npx prisma migrate dev --name add-favorites
```

## Auto-tagging (Phase 4)

`POST /api/items/classify` sends the raw uploaded photo (no background
removal step — kept decoupled from the create-item pipeline for
simplicity; the vision model handles backgrounds fine for classification
purposes) to Claude with a vision content block, in
`src/services/classification.service.js` — a **separate call site** from
`generation.service.js`, per the hard boundary in `03-ai-integration.md`
between the three AI use cases.

The model is instructed to return strict JSON; `sanitizeSuggestion()`
then validates every field against the same controlled enums
`validateItemInput` checks on save (`CATEGORIES`/`MATERIALS`/`SEASONS`
from `utils/validators.js`) — an invented category or material is dropped,
never passed through. Brand is only included if the model actually
returned one; a missing/uncertain brand is treated as omitted, never
guessed (see 03-ai-integration.md).

This endpoint **never writes to the database** — it returns a suggestion
object the client pre-fills into the same editable form used for manual
entry. The actual save still goes through the existing
`POST /api/items` / `PATCH /api/items/:id`, so the "always
user-confirmable, never silently auto-applied" rule
(`07_GHID_DEZVOLTARE_APLICATIE.md` §4) holds by construction — there's no
code path where a classification result reaches the DB without passing
through the same validation as a manual entry.

## What's deliberately NOT here yet (later phases)

- Full filter sheet on `/api/items` — already supported actually
  (category/color/material/season/tag/favorite query params existed since
  Phase 1); nothing new needed backend-side for Phase 3's wardrobe filters.
- `Outfit` has no `season` field of its own (see `02-data-model.md`) — the
  `?season=` filter on `GET /api/outfits` is **derived**: an outfit
  matches if every one of its hydrated items is season-compatible
  (`item.season === 'all'` or equal to the filter), reusing the same
  `checkSeason` rule the generation service's deterministic validity layer
  already applies. This runs in JS after hydration, not as a Prisma
  `where` clause, since it depends on joined item data.
- Style-preference learning actually feeding back into generation — the
  `StylePreferenceSignal` table above accumulates data but nothing reads
  from it yet, by design.
- `shopping_item` recommendations (Phase 5) — the `Recommendation` model
  supports the type, nothing writes it yet; Smart Closet only ever
  produces `gap_analysis` rows.
- Freemium/generation limits, billing (Phase 5) — nothing here currently
  caps how many generation turns a user can run.

## What I could NOT verify for Phase 4 (Smart Closet)

Same limitation, third time: no live Anthropic call was made against
`smartCloset.service.js`'s phrasing prompt. What's real: 44/44 tests pass
overall, 11 of them new and directly against
`wardrobeGapAnalysis.js`'s three rules (including the exact numbers each
one computes, tie-breaking behavior, and the combinatorial unlock
estimate) — all pure logic, no mocking needed since there's no I/O in
that file. The caching/staleness logic in the controller (new gaps get
phrased, resolved gaps get deleted, unchanged gaps get reused) is written
carefully but only exercised by reasoning through it, not by hitting a
real database. Add a handful of items that create an obvious gap (e.g.
three pairs of sneakers and no other shoes), hit `GET /api/smart-closet`,
then fix the gap and hit it again — tell me if a row doesn't get created
or cleaned up the way the README above describes.

## What I could NOT verify for Phase 4 (weather)

No `OPENWEATHER_API_KEY` in this sandbox either, so the actual HTTP call
in `config/weather.js` was never exercised — I did run 33/33 tests (8 new:
`checkLayering`/`checkHeatMaterials` in `outfitValidity.test.js`, plus
`deriveSeasonFromMonth` covering all 12 months in `weather.test.js`) and
syntax-checked everything. Try a real `GET /api/weather?lat=&lon=` call
and tell me if OpenWeatherMap's response shape doesn't match what
`fetchCurrentWeather` expects (`data.main.temp` / `data.weather[0].main`)
— I built that from their documented API shape, not a live response.

## What I could NOT verify for Phase 4 (auto-tagging)

Same as Phase 2's caveat: **no real vision API call was made** — no
Anthropic key in this sandbox. I did run 25/25 tests (17 pre-existing +
8 new in `test/classification.test.js`, covering `sanitizeSuggestion`'s
enum-grounding and hex validation against realistic model outputs) and
syntax-checked every file, but the actual image → JSON round-trip is
untested. Try it with a few real item photos, including at least one
that's ambiguous or not clearly a single clothing item, and tell me if
the model's response shape ever breaks the parser or `sanitizeSuggestion`.

## What I could NOT verify for Phase 2

Same sandbox limitation as before (no `binaries.prisma.sh` access, so
`prisma generate` wasn't re-run) — schema is unchanged from Phase 1 so no
migration is needed for this update. I ran the new
`test/outfitValidity.test.js` suite for real (`node --test`, 17/17 passing
including the pre-existing validator tests) and syntax-checked every file,
but **the actual Anthropic API call was not exercised** — I don't have an
API key in this sandbox. The prompt/parsing/grounding logic is written
defensively (handles non-JSON responses, invented item ids, missing
fields) but you should run a handful of real generation turns yourself —
including a follow-up like "something without the dress" — and tell me if
the model's output shape ever surprises the parser.

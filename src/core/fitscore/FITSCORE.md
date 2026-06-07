# FitScore — ICP Scoring Layer (native TDE module)

Turns TDE into an **Ideal Customer Profile scoring engine**: generate a rubric
from a solution's research, score companies against it, and mine the scored set
for patterns that suggest new rubric signals.

It is **not a separate app** — it lives inside TDE and reuses TDE's brain:

| Concern | Where it lives |
|---|---|
| Solution materials → intel | TDE `/research`, `/upload`, atoms |
| Company (lead) intel | TDE `company_intel` cache (`/intel/research/company`) |
| Rubric | solution collection `metadata.fitscore_rubric` |
| Per-lead score | `company_intel.fitscore[<solutionCollectionId>]` (additive JSONB column) |
| "Ask AI about this lead" | TDE `/ask`, `/reconstruct`, `/agent/query` |
| Auth / tenancy | TDE `api_keys` + collection scoping |

FitScore's own IP (not in TDE): the deterministic **rubric → score → colour**
engine and the **pattern miner** (`src/core/fitscore/`).

## Endpoints

```
POST /icp/rubric/:collectionId          generate (or set {rubric}) the ICP rubric
GET  /icp/rubric/:collectionId          fetch the stored rubric
POST /icp/score/:collectionId           score a lead   body: { domain, company_name?, url? }
GET  /icp/leads/:collectionId           list scored leads (score, colour, status)
PATCH /icp/leads/:collectionId/:domain  assign / set status
POST /icp/analyze/:collectionId         Section 9 mining: findings, suggested_signals, hidden_gems
POST /icp/rubric/:collectionId/apply    body: { keys:[...] } → append suggestions to rubric
```

`:collectionId` is the **solution collection** (the vendor's product), which
doubles as the ICP "project". Auth + collection scoping are inherited from TDE.

## Public ICP page (Drix.com front door)

A no-auth, public surface for "look up the ICP for any vendor/solution":

```
GET  /icp  (alias /ideal-customer-profile)   the GUI page (src/public/icp.html)
POST /icp/profile          body: { name?, url?, type?, force? }  generate-or-fetch an ICP
GET  /icp/profile/:domain  fetch a cached ICP if one exists
```

`POST /icp/profile` resolves the name → domain (via Serper, else `<name>.com`),
returns the **cached** ICP if it's fresh (`ICP_TTL_DAYS`, default 30), otherwise
runs TDE research (swarm), synthesizes the ICP, **saves it on the collection
metadata** (`metadata.icp_profile`), and returns it. So the second lookup of any
company is instant, and anything older than 30 days is re-researched on access.

Link the Drix.com "Ideal Customer Profile" button to `/icp`. If the page is
hosted on Drix.com itself (different origin), set `API_BASE` in `icp.html` to the
TDE service URL — CORS is already open on TDE.

These three routes are intentionally **public** (no API key) so the page works
without embedding secrets. Add rate-limiting / a captcha before promoting it
widely, since a cache miss triggers a live (LLM) research run.

## Typical flow

1. `POST /research/:sol` — research the vendor's solution (existing TDE).
2. `POST /icp/rubric/:sol` — synthesize the ICP rubric from that research.
3. For each prospect: `POST /intel/research/company` (role=customer) to populate
   `company_intel`, then `POST /icp/score/:sol { domain }`.
4. `GET /icp/leads/:sol` — the scored, colour-banded pipeline.
5. `POST /icp/analyze/:sol` — discover what Dark Green leads share; review
   `suggested_signals` and `hidden_gems`.
6. `POST /icp/rubric/:sol/apply { keys }` — fold accepted signals into the rubric
   and re-score. The discovery loop, closed.

## Scoring inputs

`resolveSignals()` maps rubric signals to points from two complementary sources:
- **TDE `company_intel`** — qualitative: industry, growth signals, pain points,
  buying triggers, tech stack (from the company swarm).
- **`firmographics.js`** — hard, verified: Apollo headcounts/funding + public-DNS
  email hygiene (SPF/DMARC policy/MX provider/security.txt) + derived ratios.
  Counts only, no individuals. Apollo is gated on `APOLLO_API_KEY`; DNS is free.

Everything degrades gracefully: with no Apollo key and no cached intel, scoring
still runs on whatever signals are available.

## Tests

```
node --test src/core/fitscore/__tests__/
```

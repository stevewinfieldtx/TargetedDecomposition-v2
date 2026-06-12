# PartnerFit — IPP Scoring Layer (native TDE module)

The channel-side twin of **FitScore (ICP)**. Where FitScore scores companies as
**customers**, PartnerFit scores companies as **resellers / channel partners**:
generate an Ideal Partner Profile rubric from a vendor's research, score reseller
firms against it, and mine the scored set for the traits winning partners share.

It is **not a separate app** — it lives inside TDE and reuses TDE's brain:

| Concern | Where it lives |
|---|---|
| Vendor materials → intel | TDE `/research`, `/upload`, atoms |
| Reseller intel | TDE `company_intel` cache (`/intel/research/company`) |
| Rubric | solution collection `metadata.ipp_rubric` |
| Per-reseller score | `company_intel.ippscore[<solutionCollectionId>]` (additive JSONB column) |
| Public IPP profile | solution collection `metadata.ipp_profile` |
| Auth / tenancy | TDE `api_keys` + collection scoping |

PartnerFit's own IP (`src/core/partnerfit/`): the shared partner **vocabulary**,
the **rubric → score → colour** resolver, and the reseller **discriminator
generator**. It **reuses** FitScore's generic pieces unchanged — `scoring.js`,
`firmographics.js`, `miner.js` — so nothing is duplicated.

## Shared vocabulary + per-vendor rubric

`vocab.js` is the one canonical partner-variable vocabulary. Every vendor's
`ipp_rubric` draws its signal keys from it, so a reseller's resolved features
(stored once in `company_intel`) are reusable across **all** vendors — scan a
partner once, match it to many vendors. `company_intel` becomes a dual ledger: a
firm can carry a `fitscore` (as a customer) **and** an `ippscore` (as a partner).

## Endpoints

```
POST  /ipp/rubric/:collectionId         generate (or set {rubric}) the IPP rubric
GET   /ipp/rubric/:collectionId         fetch the stored rubric
POST  /ipp/score/:collectionId          score a reseller  body: { domain, company_name?, url? }
GET   /ipp/leads/:collectionId          list scored resellers (score, colour, status)
PATCH /ipp/leads/:collectionId/:domain  assign / set status
POST  /ipp/analyze/:collectionId        mine: findings, suggested_signals, hidden_gems
POST  /ipp/rubric/:collectionId/apply   body: { keys:[...] } → append (vocab-governed) suggestions
```

`:collectionId` is the **vendor/solution collection**, which doubles as the IPP
"project". Auth + collection scoping inherited from TDE.

## Public IPP page (Drix.com front door)

```
GET  /ipp  (alias /ideal-partner-profile)   the GUI page (src/public/ipp.html)
POST /ipp/profile          body: { name?, url?, force? }  generate-or-fetch an IPP
GET  /ipp/profile/:domain  fetch a cached IPP if one exists
```

`POST /ipp/profile` resolves the name → domain, returns the **cached** IPP if
fresh (`IPP_TTL_DAYS`, default 30), else runs TDE research over the vendor's
**channel** evidence (partner program, named partners, evidence pages), builds
reseller **discriminators**, saves them on `metadata.ipp_profile`, and returns
them. The discriminators each carry a detection method + a **discovery query**
that surfaces net-new reseller firms.

These three routes are intentionally **public** (no API key). Add rate-limiting
before promoting widely — a cache miss triggers a live research run.

## Mount (server.js, pg-ready block)

```js
require('./routes/ipp-routes')(app, auth, engine.store.pg, engine); // PartnerFit — IPP scoring layer
```

## Typical flow

1. `POST /ipp/profile { name, url }` — research the vendor's channel + build the
   reseller discriminators (public front door), OR
   `POST /ipp/rubric/:sol` — synthesize the IPP rubric from existing research.
2. For each candidate reseller: `POST /intel/research/company` then
   `POST /ipp/score/:sol { domain }`.
3. `GET /ipp/leads/:sol` — the scored, colour-banded partner pipeline.
4. `POST /ipp/analyze/:sol` — what Dark Green partners share; review
   `suggested_signals` (vocab-governed) and `hidden_gems`.
5. `POST /ipp/rubric/:sol/apply { keys }` — fold accepted signals into the rubric
   and re-score. The discovery loop, closed.

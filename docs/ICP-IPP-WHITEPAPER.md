# Two-Sided Go-to-Market Intelligence: ICP & IPP on TDE

*A WinTech Partners white paper — business & technical perspective*

---

## Executive summary

Every go-to-market organization has to answer two questions:

1. **Who should we sell to?** — the Ideal **Customer** Profile (ICP)
2. **Who should sell for us?** — the Ideal **Partner** Profile (IPP)

Most companies answer the first with a slide deck and the second with a gut feel.
We answer both with the same engine. On top of the **Targeted Decomposition
Engine (TDE)** we run two native modules — **FitScore (ICP)** and **PartnerFit
(IPP)** — that turn any vendor's public footprint into a scored, evidence-backed
profile, then score real companies against it and tell you exactly how to find
more of them. ICP and IPP are mirror images of one another sharing one brain, one
data store, and one scoring discipline.

---

## The business problem

A direct sales motion and a channel motion are both **search problems over the
same universe of companies** — they just score that universe with different
rubrics. A hospital is a *customer* for an email-security vendor; a regional MSSP
that serves hospitals is a *partner*. Treating these as two unrelated projects
(two tools, two data sets, two teams) is why "who's our ICP?" and "which partners
should we recruit?" are usually answered slowly, subjectively, and without proof.

Our thesis: **build the profile once, score the world twice.** The same company
intelligence that qualifies a buyer also qualifies a reseller — you only change
the lens.

---

## ICP — FitScore (the customer lens)

**Business value.** Point FitScore at a vendor URL and it produces an Ideal
Customer Profile made of **discriminators** — observable, web-findable traits that
separate a real buyer from a generic company in the same category (e.g. "operates
under NERC CIP," "hiring GRC analysts," "weak/absent DMARC"), not marketing
wallpaper. Each discriminator ships with a **detection method and a discovery
query**, so the profile is not a description — it's a *search plan*. Sales teams
get a scored, colour-banded pipeline (dark-green / green / yellow) instead of a
list of names someone liked.

**Technical view.** The vendor's materials are ingested into TDE and decomposed
into 9-dimension-tagged **atoms**. `reconstruct()` synthesizes a rubric from those
atoms; a strong model converts evidence about *who the vendor actually sells to*
into discriminators. Scoring is **deterministic**: rubric signals resolve to
points from TDE's `company_intel` cache (qualitative: industry, pains, triggers,
tech) plus hard firmographics (Apollo headcounts + free public-DNS email hygiene),
then map to a 0–100 score and colour band. A **pattern miner** compares the
dark-green cohort against the bottom cohort and proposes new rubric signals — the
ICP sharpens itself as leads are scored.

---

## IPP — PartnerFit (the partner lens)

**Business value.** Point PartnerFit at the same vendor URL and it produces an
Ideal *Partner* Profile: the kind of reseller — MSP, MSSP, VAR — most likely to
succeed selling this vendor, again as **observable discriminators** ("Microsoft
CSP," "markets managed email security," "carries a competing line we displace")
each with a discovery query that surfaces *net-new reseller firms you don't already
know*. This converts channel recruiting from networking into a repeatable,
evidence-backed funnel: find candidate partners, score them, and prioritize the
dark-green ones — with the two roles to contact identified up front.

**Technical view.** PartnerFit is the structural twin of FitScore. The difference
is the *lens*: it reads the vendor's **channel** evidence (partner program, named
partners, "become-a-partner" pages, reseller directories) and scores a company's
**reseller** traits rather than its buyer traits. Crucially, every vendor's IPP
rubric draws its signals from **one shared partner vocabulary**, so a reseller
profiled once is comparable across every vendor. PartnerFit reuses FitScore's
generic scoring, firmographics, and pattern-mining code unchanged — only the
vocabulary, the signal resolver, and the discriminator prompt are partner-specific.

---

## One engine, one data store: why this is cheap and compounding

ICP and IPP add **no new database tables.** They reuse TDE's existing objects:

| Concern | ICP (FitScore) | IPP (PartnerFit) |
|---|---|---|
| Rubric | `collections.metadata.fitscore_rubric` | `collections.metadata.ipp_rubric` |
| Per-company score | `company_intel.fitscore[vendor]` | `company_intel.ippscore[vendor]` |
| Public profile | `metadata.icp_profile` | `metadata.ipp_profile` |
| Front door | `/icp` | `/ipp` |

The payoff is `company_intel` as a **dual ledger**: a single company can carry a
`fitscore` (as a customer) *and* an `ippscore` (as a partner), for one vendor or
many. Because a reseller's resolved features live **once**, scanning it makes it
matchable against every vendor's rubric — *scan a partner once, match it to many
vendors.* Adding the partner lens to a platform that already had the customer lens
cost a vocabulary, a resolver, and a set of routes — not a second system.

This also enforces a discipline WinTech cares about: **don't fork the engine.**
Both modules are consumers of TDE's ingest, atoms, `reconstruct`, intel cache, and
auth — never re-implementations of them.

---

## The compounding flywheel

1. **Profile** a vendor from its URL (ICP and/or IPP) → discriminators + rubric.
2. **Score** real companies → colour-banded pipeline, stored on `company_intel`.
3. **Mine** the winners → the system proposes sharper signals from what dark-green
   accounts actually share ("mimic that"), governed so it can only suggest
   vocabulary it already understands.
4. **Apply & re-score** → the profile improves. Every scored company makes the next
   profile better, and intelligence gathered for one vendor is reusable for the
   next.

---

## Differentiation

- **Discriminators, not descriptions.** Profiles are built to *find* companies on
  the open web, with detection methods and discovery queries — not adjectives.
- **Deterministic, auditable scoring.** Scores come from resolved signals with
  evidence, not an LLM's vibe; the same inputs always produce the same score.
- **Two-sided from one brain.** Customer and partner intelligence share a store,
  so the same firm can be evaluated as buyer and as reseller without duplication.
- **Self-sharpening.** The pattern miner turns a scored pipeline back into a better
  rubric, automatically.

---

## Status & roadmap

FitScore (ICP) and PartnerFit (IPP) are live as native TDE modules with public
front doors at `/icp` and `/ipp`. Near-term: a partner-flavored **discovery**
swarm (auto-surface net-new resellers from IPP discriminators), contact resolution
for the two target roles per partner, and registration of both modules in the TDE
governance registry.

*"Ingest anything. Atomize everything. Synthesize on demand" — now pointed at both
sides of the go-to-market."*

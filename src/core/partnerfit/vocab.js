/**
 * PartnerFit — the SHARED partner variable vocabulary.
 * ───────────────────────────────────────────────────────────────────
 * This is the reconciliation of the "IPP Variable Catalog" idea with the
 * FitScore model: instead of a separate versioned table, every vendor's IPP
 * rubric draws its signal keys from this ONE canonical vocabulary. Because all
 * rubrics share keys, a reseller's resolved features (stored once in
 * company_intel) are reusable across every vendor — scan a partner once, match
 * it to many vendors.
 *
 * Each key is an OBSERVABLE trait of a reseller/channel partner (not of the
 * end customer). signals.js knows how to resolve every key here; rubric.js
 * constrains the LLM to pick from these keys; the miner can only suggest keys
 * that already live here, keeping the vocabulary governed.
 */
const PARTNER_VOCAB = [
  { key: 'partner_type', label: 'Partner type', type: 'categorical', weight: 18,
    good_values: ['MSP', 'MSSP', 'VAR', 'SI', 'Consultant', 'reseller', 'managed service'],
    description: 'Is the company the right kind of channel partner (MSP/MSSP/VAR/SI)?' },
  { key: 'managed_services', label: 'Managed / recurring services', type: 'boolean', weight: 14,
    description: 'Delivers ongoing managed services (recurring revenue), not pure break-fix.' },
  { key: 'complementary_vendors', label: 'Carries complementary lines', type: 'boolean', weight: 12,
    description: 'Already resells/manages adjacent products the vendor co-sells with.' },
  { key: 'certifications', label: 'Relevant certifications', type: 'categorical', weight: 10,
    good_values: ['Microsoft CSP', 'CSP', 'SOC2', 'CompTIA', 'gold', 'partner'],
    description: 'Holds vendor-adjacent competencies (e.g. Microsoft CSP).' },
  { key: 'tech_stack', label: 'Platform alignment', type: 'boolean', weight: 10,
    description: 'Operates on the same platform the vendor plugs into (M365, Google Workspace, etc.).' },
  { key: 'target_industries', label: 'Serves the right verticals', type: 'categorical', weight: 9,
    description: 'Serves the industries the vendor sells into.' },
  { key: 'customer_size', label: 'Customer-size match', type: 'range', weight: 8,
    description: 'Serves end customers in the vendor’s ideal seat-count band.' },
  { key: 'region', label: 'Geography', type: 'categorical', weight: 7,
    description: 'Operates in the vendor’s target geography.' },
  { key: 'recurring_revenue', label: 'Recurring-revenue model', type: 'boolean', weight: 6,
    description: 'Sells on monthly/annual contracts (bundles software into a service).' },
  { key: 'growth_signals', label: 'Growth / momentum', type: 'boolean', weight: 6,
    description: 'Hiring or funding momentum suggesting capacity to take on a new line.' },
];

const VOCAB_KEYS = PARTNER_VOCAB.map((v) => v.key);

module.exports = { PARTNER_VOCAB, VOCAB_KEYS };

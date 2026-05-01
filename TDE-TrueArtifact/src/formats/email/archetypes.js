/**
 * Email Archetypes — templates for different email types.
 * Each defines the structure, tone, and atom query for sourcing content.
 */

const EMAIL_ARCHETYPES = {
  cold_outreach: {
    id: 'cold_outreach',
    label: 'Cold Outreach',
    structure: ['hook', 'pain', 'bridge', 'proof', 'cta'],
    tone: 'direct, peer-to-peer, no fluff',
    maxWords: 150,
    atomQuery: { buying_stage: ['awareness'], emotional_driver: ['fear', 'curiosity'] },
    promptHint: 'Short and punchy. Lead with a pain point or surprising stat. No "I hope this finds you well."',
  },
  follow_up: {
    id: 'follow_up',
    label: 'Follow-Up',
    structure: ['reference', 'value_add', 'cta'],
    tone: 'warm, helpful, low-pressure',
    maxWords: 100,
    atomQuery: { evidence_type: ['case_study', 'statistic'], buying_stage: ['consideration'] },
    promptHint: 'Reference previous touchpoint. Add one new piece of value. Single clear ask.',
  },
  nurture: {
    id: 'nurture',
    label: 'Nurture / Value Drop',
    structure: ['insight', 'relevance', 'resource', 'soft_cta'],
    tone: 'educational, thought-leader',
    maxWords: 200,
    atomQuery: { evidence_type: ['statistic', 'market_data', 'insight'], credibility: [4, 5] },
    promptHint: 'Lead with an industry insight or trend. Connect to their world. Offer a resource. Soft CTA only.',
  },
  partner_recruitment: {
    id: 'partner_recruitment',
    label: 'Partner Recruitment',
    structure: ['opportunity', 'economics', 'differentiation', 'next_step'],
    tone: 'business-opportunity, data-driven',
    maxWords: 200,
    atomQuery: { persona: ['partner'], economic_driver: ['margin', 'recurring_revenue'] },
    promptHint: 'Lead with the market opportunity. Show the economics. Differentiate from other vendor programs.',
  },
  executive_intro: {
    id: 'executive_intro',
    label: 'Executive Introduction',
    structure: ['credibility', 'relevance', 'ask'],
    tone: 'concise, respectful of time, peer-level',
    maxWords: 120,
    atomQuery: { persona: ['executive', 'c_suite'], buying_stage: ['awareness'] },
    promptHint: 'One sentence of credibility. One sentence of relevance to their specific situation. One sentence ask.',
  },
  event_follow_up: {
    id: 'event_follow_up',
    label: 'Event Follow-Up',
    structure: ['reference_event', 'key_takeaway', 'bridge', 'cta'],
    tone: 'warm, timely, conversational',
    maxWords: 150,
    atomQuery: { evidence_type: ['insight', 'statistic'], buying_stage: ['awareness', 'consideration'] },
    promptHint: 'Reference the event or session. Share one relevant takeaway. Bridge to a conversation.',
  },
  renewal_reminder: {
    id: 'renewal_reminder',
    label: 'Renewal Reminder',
    structure: ['value_delivered', 'whats_new', 'next_steps'],
    tone: 'appreciative, forward-looking',
    maxWords: 180,
    atomQuery: { evidence_type: ['case_study', 'statistic'], economic_driver: ['retention', 'roi'] },
    promptHint: 'Highlight value delivered during the term. Preview what\'s coming. Make renewal the obvious choice.',
  },
};

const EMAIL_ARCHETYPE_MAP = Object.fromEntries(
  Object.values(EMAIL_ARCHETYPES).map(a => [a.id, a])
);

module.exports = { EMAIL_ARCHETYPES, EMAIL_ARCHETYPE_MAP };

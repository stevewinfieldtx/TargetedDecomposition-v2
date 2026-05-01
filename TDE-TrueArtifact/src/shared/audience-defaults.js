/**
 * Default archetype orderings per audience type.
 * Each value is an ordered array of archetype IDs that defines the default deck structure.
 */
const AUDIENCE_DEFAULTS = {
  partner_msp: [
    'title', 'agenda', 'market_opportunity', 'client_demand', 'product_overview',
    'product_deep_dive', 'competitive_comparison', 'revenue_model', 'retention_play',
    'sales_playbook', 'partner_tracks', 'distributor_value', 'onboarding_timeline',
    'objection_handling', 'proof_points', 'cta', 'appendix',
  ],
  partner_si: [
    'title', 'agenda', 'market_opportunity', 'client_demand', 'product_overview',
    'product_deep_dive', 'competitive_comparison', 'revenue_model', 'compliance_mapping',
    'bundling_strategy', 'enterprise_readiness', 'partner_tracks', 'distributor_value',
    'sales_playbook', 'onboarding_timeline', 'objection_handling', 'proof_points',
    'cta', 'appendix',
  ],
  partner_var: [
    'title', 'agenda', 'market_opportunity', 'client_demand', 'product_overview',
    'product_deep_dive', 'attach_playbook', 'competitive_comparison', 'revenue_model',
    'retention_play', 'compliance_mapping', 'partner_tracks', 'distributor_value',
    'sales_playbook', 'objection_handling', 'onboarding_timeline', 'proof_points',
    'cta', 'appendix',
  ],
  direct_ciso: [
    'title', 'agenda', 'pain_points_reflected', 'threat_landscape', 'product_overview',
    'product_deep_dive', 'competitive_comparison', 'compliance_mapping', 'roi_calculator',
    'use_cases', 'enterprise_readiness', 'onboarding_timeline', 'proof_points',
    'cta', 'appendix',
  ],
  direct_cto: [
    'title', 'agenda', 'pain_points_reflected', 'threat_landscape', 'product_overview',
    'product_deep_dive', 'enterprise_readiness', 'competitive_comparison', 'roi_calculator',
    'use_cases', 'onboarding_timeline', 'proof_points', 'cta', 'appendix',
  ],
  direct_cfo: [
    'title', 'agenda', 'threat_landscape', 'product_overview', 'roi_calculator',
    'compliance_mapping', 'competitive_comparison', 'proof_points', 'onboarding_timeline',
    'cta', 'appendix',
  ],
  executive: [
    'title', 'agenda', 'pain_points_reflected', 'threat_landscape', 'product_overview',
    'roi_calculator', 'compliance_mapping', 'use_cases', 'proof_points',
    'onboarding_timeline', 'cta', 'appendix',
  ],
  technical: [
    'title', 'agenda', 'threat_landscape', 'product_overview', 'product_deep_dive',
    'enterprise_readiness', 'competitive_comparison', 'use_cases', 'onboarding_timeline',
    'proof_points', 'cta', 'appendix',
  ],
};

module.exports = { AUDIENCE_DEFAULTS };

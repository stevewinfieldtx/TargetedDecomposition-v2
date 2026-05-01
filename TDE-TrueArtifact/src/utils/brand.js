function resolveBrand(overrides = {}) {
  return {
    accent: overrides.accent || '#2563eb',
    accentLight: overrides.accentLight || '#3b82f6',
    accentDark: overrides.accentDark || '#1d4ed8',
    bg: overrides.bg || '#0f172a',
    bgCard: overrides.bgCard || '#1e293b',
    text: overrides.text || '#e2e8f0',
    textMuted: overrides.textMuted || '#94a3b8',
    warning: overrides.warning || '#f59e0b',
    success: overrides.success || '#10b981',
    fontFamily: overrides.fontFamily || "'Segoe UI', system-ui, -apple-system, sans-serif",
    logoUrl: overrides.logoUrl || '',
    sellerName: overrides.sellerName || '',
    ...overrides,
  };
}

module.exports = { resolveBrand };

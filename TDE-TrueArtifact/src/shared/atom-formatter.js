function formatAtomsForPrompt(atoms) {
  return atoms.map((a, i) => {
    const tags = [];
    if (a.persona) tags.push(`Persona: ${a.persona}`);
    if (a.buying_stage || a.buyingStage) tags.push(`Stage: ${a.buying_stage || a.buyingStage}`);
    if (a.evidence_type || a.evidenceType) tags.push(`Evidence: ${a.evidence_type || a.evidenceType}`);
    if (a.credibility) tags.push(`Credibility: ${a.credibility}/5`);
    if (a.emotional_driver || a.emotionalDriver) tags.push(`Driver: ${a.emotional_driver || a.emotionalDriver}`);
    return `[ATOM ${i + 1}] ${tags.join(' | ')}\n${a.text}`;
  }).join('\n\n');
}

module.exports = { formatAtomsForPrompt };

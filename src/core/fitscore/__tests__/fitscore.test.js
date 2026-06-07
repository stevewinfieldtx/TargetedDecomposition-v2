const test = require('node:test');
const assert = require('node:assert');
const { colourFor, scoreFromSignals } = require('../scoring');
const { mine, twoProportionTest, cohensD, flatten } = require('../miner');

test('colour bands', () => {
  const t = { dark_green: 80, green: 60, yellow: 40 };
  assert.equal(colourFor(95, t), 'dark_green');
  assert.equal(colourFor(65, t), 'green');
  assert.equal(colourFor(45, t), 'yellow');
  assert.equal(colourFor(10, t), 'unqualified');
});

test('score from signals clamps and bands', () => {
  const rubric = { thresholds: { dark_green: 80, green: 60, yellow: 40 } };
  const r = scoreFromSignals(rubric, { industry: 25, size: 20, tech: 20, growth: 20 });
  assert.equal(r.score, 85);
  assert.equal(r.colour, 'dark_green');
  assert.equal(scoreFromSignals(rubric, { a: 999 }).score, 100); // clamp
});

test('two-proportion test basic', () => {
  const r = twoProportionTest(18, 20, 4, 20);
  assert.equal(r.diff, 0.7);
  assert.equal(r.lift, 4.5);
  assert.ok(r.p_value < 0.01);
});

test("cohen's d direction", () => {
  const r = cohensD([10, 11, 9, 12, 10], [2, 3, 1, 2, 2]);
  assert.ok(r.d > 1.0);
});

test('flatten explodes lists + recurses', () => {
  const f = flatten({ dns: { dmarc_policy: 'none' }, website: { pain_language: ['hipaa', 'gdpr'] } });
  assert.equal(f['dns.dmarc_policy'], 'none');
  assert.equal(f['website.pain_language:hipaa'], true);
  assert.equal(f['website.pain_language__count'], 2);
});

function mkLead(colour, weakDmarc, ratio, name, score) {
  return { id: name, company_name: name, domain: name + '.com', score, colour,
    features: { dns: { dmarc_policy: weakDmarc ? 'none' : 'reject' },
                derived: { ratios: { technical_to_sales_ratio: ratio } } } };
}
function dataset() {
  const leads = [];
  for (let i = 0; i < 8; i++) leads.push(mkLead('dark_green', true, 0.4, 'win' + i, 90));
  for (let i = 0; i < 8; i++) leads.push(mkLead('unqualified', false, 2.0, 'lose' + i, 20));
  leads.push(mkLead('unqualified', true, 0.4, 'gem', 25)); // hidden gem
  return leads;
}

test('miner finds discriminating signal + suggests it', () => {
  const r = mine(dataset());
  assert.equal(r.top_n, 8);
  assert.ok(r.findings.some((f) => f.feature.includes('dmarc_policy=none')));
  assert.ok(r.suggested_signals.some((s) => s.key.startsWith('dns_dmarc_policy')));
});

test('miner flags hidden gem', () => {
  const r = mine(dataset());
  assert.ok(r.hidden_gems.some((g) => g.company_name === 'gem'));
});

test('miner guards small cohorts', () => {
  const r = mine([mkLead('dark_green', true, 0.4, 'a', 90), mkLead('unqualified', false, 2, 'b', 10)]);
  assert.equal(r.findings.length, 0);
  assert.ok(r.notes.length > 0);
});

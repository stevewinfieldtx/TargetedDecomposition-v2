const test = require('node:test');
const assert = require('node:assert');
const { parseDmarcPolicy, classifyMx, deriveAbsence } = require('../firmographics');
const { resolveSignals } = require('../signals');

test('dmarc + mx parsers', () => {
  assert.equal(parseDmarcPolicy(['v=DMARC1; p=reject']), 'reject');
  assert.equal(parseDmarcPolicy(['v=DMARC1; p=none']), 'none');
  assert.equal(parseDmarcPolicy(['nope']), null);
  assert.equal(classifyMx(['aspmx.l.google.com']), 'google');
  assert.equal(classifyMx(['x.mail.protection.outlook.com']), 'microsoft');
  assert.equal(classifyMx([]), null);
});

test('absence flags', () => {
  const a = deriveAbsence({ dmarc_present: true, dmarc_policy: 'none', spf_present: true, security_txt_present: false });
  assert.equal(a.weak_dmarc_policy, true);
  assert.equal(a.missing_dmarc, false);
  assert.equal(a.no_security_txt, true);
});

test('resolveSignals awards weight on evidence', () => {
  const rubric = { signals: [
    { key: 'industry', weight: 25, good_values: ['cyber', 'saas'] },
    { key: 'employee_count', weight: 20 },
    { key: 'email_security_gap', weight: 15 },
    { key: 'tech_stack', weight: 20 },
  ] };
  const intel = { industry: 'Cybersecurity' };
  const firmo = { apollo: { company_size: 120, technology_names: ['M365'] },
                  dns: { dmarc_present: true, dmarc_policy: 'none' } };
  const s = resolveSignals(rubric, intel, firmo);
  assert.equal(s.industry, 25);            // matches good_values
  assert.equal(s.employee_count, 20);      // size present
  assert.equal(s.email_security_gap, 15);  // weak dmarc
  assert.equal(s.tech_stack, 20);          // tech present
});

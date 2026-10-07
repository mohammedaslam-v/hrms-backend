import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SALARY_RULES,
  grossFromCtc,
  payStructure,
  ptOf,
  structure,
  structureFromComponents,
} from './salary.domain';

/*
 * The salary rules HR specified: Basic 40% of Gross, HRA 50% of Basic, Special
 * the balance, PF 12% of Basic on a wage capped at ₹25,000, Gratuity 4.81% of
 * Basic, and CTC = Gross + Employer PF + Gratuity. PF wage capped at ₹25,000.
 */

test('the parts add back to the CTC exactly, monthly and annually', () => {
  for (const ctc of [180000, 300000, 600000, 999999, 1500000, 4200000]) {
    const s = structure(ctc);
    assert.equal(s.grossA + s.erPfA + s.gratA, ctc, `annual ${ctc}`);
    assert.equal(s.grossM + s.erPfM + s.gratM, Math.round(ctc / 12), `monthly ${ctc}`);
    assert.equal(s.basicM + s.hraM + s.specialM, s.grossM, `gross split ${ctc}`);
  }
});

test('₹3,00,000: Basic is 40% of Gross and HRA half of Basic', () => {
  const s = structure(300000);
  assert.equal(s.grossM, 23425);
  assert.equal(s.basicM, 9370);
  assert.equal(s.hraM, 4685);
  assert.equal(s.specialM, 9370);
  assert.equal(s.erPfM, 1124);
  assert.equal(s.eePfM, 1124);
  assert.equal(s.gratM, 451);
});

test('₹6,00,000: Basic of ₹18,740 is under the ₹25,000 cap, so PF is 12% of Basic', () => {
  const s = structure(600000);
  assert.equal(s.grossM, 46850);
  assert.equal(s.basicM, 18740);
  assert.equal(s.hraM, 9370);
  assert.equal(s.pfWage, 18740);
  assert.equal(s.erPfM, 2249);
  assert.equal(s.eePfM, 2249);
  assert.equal(s.grossM + s.erPfM + s.gratM, 50000);
});

test('₹15,00,000: Basic is over the cap, so PF stops at 12% of ₹25,000', () => {
  // Capped line: Gross = (1,25,000 − 3,000) / (1 + 0.40 × 0.0481) = 1,19,697.
  const s = structure(1500000);
  assert.equal(s.grossM, 119697);
  assert.equal(s.pfWage, 25000);
  assert.equal(s.erPfM, 3000);
  assert.equal(s.grossM + s.erPfM + s.gratM, 125000);
});

test('PF never exceeds 12% of the ₹25,000 wage ceiling', () => {
  for (const ctc of [1500000, 4200000]) {
    const s = structure(ctc);
    assert.equal(s.erPfM, 3000, `employer ${ctc}`);
    assert.equal(s.eePfM, 3000, `employee ${ctc}`);
  }
});

test('the pension (EPS) slice stays on the statutory ₹15,000', () => {
  const s = structure(1500000);
  assert.equal(s.epsM, 1250);
  assert.equal(s.erEpfM, 3000 - 1250);
});

test('gratuity is 4.81% of Basic', () => {
  const s = structure(1500000);
  assert.equal(s.gratM, Math.round(s.basicM * SALARY_RULES.gratuityPctOfBasic));
});

test('grossFromCtc uses the capped line only once Basic passes the ceiling', () => {
  // Just under the cap: uncapped line.
  const g1 = grossFromCtc(39000, 15000);
  assert.ok(g1 * SALARY_RULES.basicPctOfGross <= 15000);
  // Well over: PF fixed at ₹1,800.
  const g2 = grossFromCtc(125000, 15000);
  assert.ok(g2 * SALARY_RULES.basicPctOfGross > 15000);
  assert.ok(Math.abs(g2 + 1800 + g2 * 0.4 * 0.0481 - 125000) < 0.01);
});

test('a zero or missing CTC gives an all-zero structure', () => {
  const s = structure(0);
  assert.equal(s.grossM, 0);
  assert.equal(s.erPfM, 0);
  assert.equal(s.basicA, 0);
});

// ── Saved components (HR overrode the formula at onboarding) ──────────────────

const edited = {
  basicM: 30000, hraM: 15000, specialM: 26618,
  employerPfM: 1800, gratuityM: 1443, employeePfM: 1800, professionalTaxM: null,
};

test('saved components are used as-is, and annual is twelve months', () => {
  const s = structureFromComponents(900000, edited);
  assert.equal(s.basicM, 30000);
  assert.equal(s.hraM, 15000);
  assert.equal(s.grossM, 71618);
  assert.equal(s.basicA, 360000);
  assert.equal(s.erPfM, 1800);
});

test('payStructure falls back to the formula when nothing is saved', () => {
  assert.deepEqual(payStructure(900000, null), payStructure(900000, undefined));
  assert.equal(payStructure(900000, null).hraM, Math.round(payStructure(900000, null).basicM * 0.5));
});

test('payStructure prefers saved components over the formula', () => {
  assert.equal(payStructure(900000, edited).basicM, 30000);
});

test('professional tax: HR figure when set, state slab otherwise', () => {
  assert.equal(ptOf({ ...edited, professionalTaxM: 150 }, 'Karnataka', 71618), 150);
  assert.equal(ptOf(edited, 'Karnataka', 71618), 200);
  assert.equal(ptOf(null, 'Karnataka', 20000), 0);
});

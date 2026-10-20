import assert from 'node:assert/strict';
import test from 'node:test';
import { calculate, GRADE_POINTS, SEMESTERS } from '../dist/gpa.mjs';

const course = (id, credits = 2, overrides = {}) => ({
  id,
  semester: '1-I',
  code: id,
  title: `Course ${id}`,
  credits,
  gpa: true,
  ...overrides,
});
const result = (grade, overrides = {}) => ({
  grade,
  repeat: false,
  confirmed: false,
  note: '',
  ...overrides,
});
const semester = (calculation, name) =>
  calculation.semesters.find((item) => item.semester === name);

test('uses the published grade scale and semester sequence', () => {
  assert.deepEqual(GRADE_POINTS, {
    'A+': 4, A: 4, 'A-': 3.7, 'B+': 3.3, B: 3, 'B-': 2.7,
    'C+': 2.3, C: 2, 'C-': 1.7, 'D+': 1.3, D: 1, E: 0,
  });
  assert.deepEqual(SEMESTERS, [
    'Orientation', '1-I', '1-II', '2-I', '2-II',
    '3-I', '3-II', '4-I', '4-II',
  ]);
});

test('weights grades by credits and preserves full precision', () => {
  const weighted = calculate(
    [course('A', 3), course('B', 1)],
    { A: result('A'), B: result('B') },
  );
  assert.equal(weighted.gpa, 3.75);
  assert.equal(weighted.points, 15);
  assert.equal(weighted.credits, 4);
  assert.equal(weighted.gradedCount, 2);
  assert.equal(weighted.rows[0].weightedPoints, 12);
  assert.deepEqual(weighted.issues, []);

  const precise = calculate(
    [course('A', 1), course('B', 2)],
    { A: result('A'), B: result('C') },
  );
  assert.equal(precise.gpa, 8 / 3);
  assert.notEqual(precise.gpa, 2.67);
});

test('keeps E grades in the denominator', () => {
  const actual = calculate(
    [course('PASS'), course('FAIL')],
    { PASS: result('A'), FAIL: result('E') },
  );
  assert.equal(actual.gpa, 2);
  assert.equal(actual.credits, 4);
  assert.equal(actual.rows[1].included, true);
  assert.equal(actual.rows[1].gradePoint, 0);
  assert.equal(actual.rows[1].weightedPoints, 0);
});

test('retains non-GPA results without including credits or points', () => {
  const courses = [
    course('GPA', 3),
    course('ENGLISH', 2, { gpa: false }),
    course('ORIENTATION', null, { gpa: false, semester: 'Orientation' }),
  ];
  const actual = calculate(courses, {
    GPA: result('B'),
    ENGLISH: result('E'),
    ORIENTATION: result('A'),
  });
  assert.equal(actual.gpa, 3);
  assert.equal(actual.credits, 3);
  assert.equal(actual.points, 9);
  assert.equal(actual.gradedCount, 1);
  assert.equal(actual.rows.length, 3);
  assert.equal(actual.rows[1].grade, 'E');
  assert.equal(actual.rows[1].included, false);
  assert.equal(actual.rows[1].weightedPoints, null);
  assert.equal(semester(actual, 'Orientation').gpa, null);
  assert.deepEqual(actual.issues, []);

  const changed = calculate(courses, {
    GPA: result('B'),
    ENGLISH: result('A'),
    ORIENTATION: result('D'),
  });
  assert.equal(changed.gpa, actual.gpa);
});

test('excludes blank and pending results without blocking current GPA', () => {
  const actual = calculate(
    [course('GRADED'), course('PENDING'), course('BLANK')],
    { GRADED: result('B+'), PENDING: result('Pending') },
  );
  assert.equal(actual.gpa, 3.3);
  assert.equal(actual.credits, 2);
  assert.equal(actual.pendingCount, 1);
  assert.equal(actual.blankCount, 1);
  assert.equal(actual.rows[1].gradePoint, null);
  assert.equal(actual.rows[2].grade, '');
  assert.equal(semester(actual, '1-I').pendingCount, 1);
  assert.deepEqual(actual.issues, []);
});

test('returns unavailable for no GPA results and zero for an awarded E', () => {
  assert.equal(calculate([], {}).gpa, null);
  assert.equal(calculate([course('A')], {}).gpa, null);
  assert.equal(calculate([course('A')], { A: result('Pending') }).gpa, null);
  assert.equal(calculate([course('A')], { A: result('E') }).gpa, 0);
});

test('combines weighted totals rather than averaging semester GPAs', () => {
  const actual = calculate(
    [course('FIRST', 1), course('SECOND', 3, { semester: '1-II' })],
    { FIRST: result('A'), SECOND: result('C') },
  );
  assert.equal(semester(actual, '1-I').gpa, 4);
  assert.equal(semester(actual, '1-II').gpa, 2);
  assert.equal(actual.gpa, 2.5);
  assert.notEqual(actual.gpa, 3);
});

test('withholds GPA for an unconfirmed repeat but keeps diagnostic totals', () => {
  const actual = calculate(
    [course('REPEAT'), course('OTHER', 2, { semester: '1-II' })],
    { REPEAT: result('C', { repeat: true }), OTHER: result('A') },
  );
  assert.equal(actual.gpa, null);
  assert.equal(actual.rawGpa, 3);
  assert.equal(actual.hasUnresolvedRepeats, true);
  assert.equal(actual.issues.length, 1);
  assert.equal(actual.issues[0].id, 'REPEAT');
  assert.equal(semester(actual, '1-I').gpa, null);
  assert.equal(semester(actual, '1-I').rawGpa, 2);
  assert.equal(semester(actual, '1-II').gpa, 4);
});

test('accepts a confirmed effective repeat result within the C cap', () => {
  for (const grade of ['C', 'C-', 'D+', 'D', 'E']) {
    const actual = calculate(
      [course('R')],
      { R: result(grade, { repeat: true, confirmed: true }) },
    );
    assert.equal(actual.gpa, GRADE_POINTS[grade]);
    assert.equal(actual.hasUnresolvedRepeats, false);
    assert.deepEqual(actual.issues, []);
  }
});

test('does not silently cap an above-C repeat result', () => {
  const actual = calculate(
    [course('R')],
    { R: result('B', { repeat: true, confirmed: true }) },
  );
  assert.equal(actual.gpa, null);
  assert.equal(actual.rawGpa, 3);
  assert.equal(actual.rows[0].grade, 'B');
  assert.equal(actual.hasUnresolvedRepeats, true);
  assert.match(actual.issues[0].message, /caps repeat grades at C/);
});

test('pending GPA repeats and non-GPA repeats do not trigger cap issues', () => {
  const actual = calculate(
    [course('GRADED'), course('PENDING'), course('ENGLISH', 2, { gpa: false })],
    {
      GRADED: result('A'),
      PENDING: result('Pending', { repeat: true }),
      ENGLISH: result('A', { repeat: true }),
    },
  );
  assert.equal(actual.gpa, 4);
  assert.equal(actual.hasUnresolvedRepeats, false);
  assert.deepEqual(actual.issues, []);
});

test('rejects invalid or missing GPA credits without reporting a partial GPA', () => {
  for (const credits of [0, -1, null, '', ' ', NaN, Infinity, 'two', true]) {
    const actual = calculate(
      [course('VALID'), course('INVALID', credits)],
      { VALID: result('A'), INVALID: result('B') },
    );
    assert.equal(actual.gpa, null, `credits=${String(credits)}`);
    assert.equal(actual.rawGpa, 4);
    assert.equal(actual.issues.length, 1);
    assert.equal(actual.rows[1].included, false);
    assert.equal(semester(actual, '1-I').gpa, null);
  }
});

test('allows numeric credit strings and fractional credits', () => {
  const actual = calculate(
    [course('A', '1.5'), course('B', 0.5)],
    { A: result('A'), B: result('C') },
  );
  assert.equal(actual.gpa, 3.5);
  assert.equal(actual.credits, 2);
  assert.deepEqual(actual.issues, []);
});

test('rejects invalid grades, including grades on non-GPA courses', () => {
  for (const grade of ['F', 'A++', 4, {}, ['A'], 'Not taken']) {
    const actual = calculate(
      [course('VALID'), course('INVALID', 2, { gpa: false })],
      { VALID: result('A'), INVALID: result(grade) },
    );
    assert.equal(actual.gpa, null);
    assert.equal(actual.issues.length, 1);
    assert.equal(actual.rows[1].gradePoint, null);
  }
});

test('normalizes unicode minus, surrounding spaces and grade letter case', () => {
  const actual = calculate([course('A')], { A: result(' a\u2212 ') });
  assert.equal(actual.rows[0].grade, 'A-');
  assert.equal(actual.gpa, 3.7);
});

test('rejects duplicate course codes regardless of case and whitespace', () => {
  const actual = calculate(
    [
      course('A', 2, { code: ' ec 11201 ' }),
      course('B', 2, { code: 'EC11201', semester: '1-II' }),
    ],
    { A: result('A'), B: result('B') },
  );
  assert.equal(actual.gpa, null);
  assert.equal(actual.issues.length, 2);
  assert.equal(semester(actual, '1-I').gpa, null);
  assert.equal(semester(actual, '1-II').gpa, null);
  assert.equal(actual.credits, 0);
});

test('rejects invalid semesters and duplicate identifiers', () => {
  const invalidSemester = calculate(
    [course('A'), course('B', 2, { semester: '5-I' })],
    { A: result('A'), B: result('A') },
  );
  assert.equal(invalidSemester.gpa, null);
  assert.equal(semester(invalidSemester, '1-I').gpa, 4);
  assert.equal(invalidSemester.issues.length, 1);
  assert.equal(invalidSemester.rows[1].included, false);

  const duplicateId = calculate(
    [course('A', 2, { code: 'ONE' }), course('A', 2, { code: 'TWO' })],
    { A: result('A') },
  );
  assert.equal(duplicateId.gpa, null);
  assert.equal(duplicateId.issues.length, 2);
});

test('does not mutate courses or results and ignores unrelated saved results', () => {
  const courses = [course('A')];
  const results = {
    A: result('B-', { note: 'Published result' }),
    UNRELATED: result('E'),
  };
  const originalCourses = structuredClone(courses);
  const originalResults = structuredClone(results);
  const actual = calculate(courses, results);
  assert.deepEqual(courses, originalCourses);
  assert.deepEqual(results, originalResults);
  assert.equal(actual.gpa, 2.7);
  assert.equal(actual.rows[0].note, 'Published result');
  assert.equal(actual.rows.length, 1);
});

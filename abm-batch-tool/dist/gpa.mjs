/**
 * Credit-weighted current GPA calculations for the supplied ABM handbook.
 * No rounding or repeat-attempt replacement policy is applied here.
 *
 * Counts describe GPA courses. `included` describes arithmetic inclusion in
 * raw totals; an unresolved repeat still withholds the publishable `gpa`.
 */
export const GRADE_POINTS = Object.freeze({
  'A+': 4.0,
  A: 4.0,
  'A-': 3.7,
  'B+': 3.3,
  B: 3.0,
  'B-': 2.7,
  'C+': 2.3,
  C: 2.0,
  'C-': 1.7,
  'D+': 1.3,
  D: 1.0,
  E: 0.0,
});

export const SEMESTERS = Object.freeze([
  'Orientation',
  '1-I',
  '1-II',
  '2-I',
  '2-II',
  '3-I',
  '3-II',
  '4-I',
  '4-II',
]);

function normalizedGrade(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') return value;
  const trimmed = value.trim().replace(/\u2212/g, '-');
  if (trimmed.toLowerCase() === 'pending') return 'Pending';
  return trimmed.toUpperCase();
}

function normalizedCode(value) {
  return typeof value === 'string'
    ? value.toUpperCase().replace(/\s/g, '')
    : '';
}

function numericCredits(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'number' && typeof value !== 'string') return NaN;
  if (typeof value === 'string' && value.trim() === '') return null;
  return Number(value);
}

function emptyTotals(semester) {
  return {
    ...(semester === undefined ? {} : { semester }),
    gpa: null,
    rawGpa: null,
    credits: 0,
    points: 0,
    gradedCount: 0,
    pendingCount: 0,
    blankCount: 0,
  };
}

/**
 * Calculate semester and current cumulative GPAs from one effective result
 * per course. Repeated GPA results need explicit departmental confirmation
 * that the entered value is the single effective result for GPA purposes.
 *
 * Non-GPA courses may have unknown (null/blank) or zero credits. GPA courses
 * require finite, positive credits. Invalid inputs block public GPAs, while
 * `rawGpa` is diagnostic only and must not be presented as a valid result.
 */
export function calculate(courses, results = {}) {
  if (!Array.isArray(courses)) {
    throw new TypeError('Courses must be an array.');
  }

  const issues = [];
  const rows = [];
  const totals = emptyTotals();
  const semesters = SEMESTERS.map(emptyTotals);
  const semesterMap = new Map(semesters.map((item) => [item.semester, item]));
  const blockedSemesters = new Set();
  const codeCounts = new Map();
  const idCounts = new Map();
  let hasUnresolvedRepeats = false;

  for (const course of courses) {
    const code = normalizedCode(course?.code);
    if (code) codeCounts.set(code, (codeCounts.get(code) || 0) + 1);
    const id = course?.id;
    if (typeof id === 'string' && id.trim()) {
      idCounts.set(id, (idCounts.get(id) || 0) + 1);
    }
  }

  for (const [index, inputCourse] of courses.entries()) {
    const course =
      inputCourse && typeof inputCourse === 'object' ? inputCourse : {};
    const inputRecord =
      results &&
      typeof results === 'object' &&
      Object.prototype.hasOwnProperty.call(results, course.id)
        ? results[course.id]
        : {};
    const record =
      inputRecord && typeof inputRecord === 'object' ? inputRecord : {};
    const grade = normalizedGrade(record.grade);
    const repeat = record.repeat === true;
    const confirmed = record.confirmed === true;
    const credits = numericCredits(course.credits);
    const code = normalizedCode(course.code);
    const semesterTotals = semesterMap.get(course.semester);
    const hasGrade =
      typeof grade === 'string' &&
      Object.prototype.hasOwnProperty.call(GRADE_POINTS, grade);
    const gradePoint = hasGrade ? GRADE_POINTS[grade] : null;
    const isGpa = course.gpa === true;
    let invalidArithmetic = false;

    const addIssue = (message, invalid = true) => {
      issues.push({ id: course.id ?? `row-${index + 1}`, message });
      if (semesterTotals) blockedSemesters.add(course.semester);
      if (invalid) invalidArithmetic = true;
    };

    if (typeof course.id !== 'string' || !course.id.trim()) {
      addIssue('A unique course identifier is required.');
    } else if (idCounts.get(course.id) > 1) {
      addIssue('This course identifier appears more than once.');
    }

    if (!code) {
      addIssue('A course code is required.');
    } else if (codeCounts.get(code) > 1) {
      addIssue(
        'This course code appears more than once. Enter one effective result per course.',
      );
    }

    if (!semesterTotals) addIssue('Choose a valid year and semester.');
    if (typeof course.gpa !== 'boolean') {
      addIssue('Specify whether this course contributes to GPA.');
    }

    if (
      (isGpa && (credits === null || !Number.isFinite(credits) || credits <= 0)) ||
      (!isGpa && credits !== null && (!Number.isFinite(credits) || credits < 0))
    ) {
      addIssue(
        isGpa
          ? 'GPA courses require a positive credit value.'
          : 'Non-GPA credits must be blank or a valid non-negative value.',
      );
    }

    if (grade !== '' && grade !== 'Pending' && !hasGrade) {
      addIssue('Choose a valid published grade or mark the result as pending.');
    }

    if (isGpa && repeat && hasGrade) {
      if (!confirmed) {
        hasUnresolvedRepeats = true;
        addIssue(
          'Confirm that the department has approved this as the single effective GPA result for the repeated course.',
          false,
        );
      }
      if (gradePoint > GRADE_POINTS.C) {
        hasUnresolvedRepeats = true;
        addIssue(
          'The supplied handbook caps repeat grades at C. Verify this repeated result with the department.',
          false,
        );
      }
    }

    const included = isGpa && hasGrade && !invalidArithmetic;
    const weightedPoints = included ? credits * gradePoint : null;
    rows.push({
      ...course,
      grade,
      repeat,
      confirmed,
      note: typeof record.note === 'string' ? record.note : '',
      gradePoint,
      weightedPoints,
      included,
    });

    if (isGpa) {
      for (const target of [totals, semesterTotals].filter(Boolean)) {
        if (grade === '') target.blankCount += 1;
        else if (grade === 'Pending') target.pendingCount += 1;
        if (included) {
          target.gradedCount += 1;
          target.credits += credits;
          target.points += weightedPoints;
        }
      }
    }
  }

  totals.rawGpa = totals.credits > 0 ? totals.points / totals.credits : null;
  totals.gpa = issues.length === 0 ? totals.rawGpa : null;
  for (const semester of semesters) {
    semester.rawGpa =
      semester.credits > 0 ? semester.points / semester.credits : null;
    semester.gpa = blockedSemesters.has(semester.semester)
      ? null
      : semester.rawGpa;
  }

  return { ...totals, issues, semesters, rows, hasUnresolvedRepeats };
}

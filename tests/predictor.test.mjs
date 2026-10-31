import test from 'node:test';
import assert from 'node:assert/strict';

function calculatePredictorMetrics({ curCredits, curGpa, remCredits }) {
  const curPoints = curCredits * curGpa;
  const totalCredits = curCredits + remCredits;
  const maxPossiblePoints = curPoints + (remCredits * 4.0);
  const maxPossibleGpa = totalCredits > 0 ? (maxPossiblePoints / totalCredits) : 4.0;

  const targets = [
    { label: 'First Class', min: 3.70 },
    { label: 'Second Class (Upper)', min: 3.30 },
    { label: 'Second Class (Lower)', min: 3.00 },
    { label: 'General Pass', min: 2.00 },
  ].map(t => {
    if (totalCredits <= 0) {
      return { ...t, status: 'pending', reqAvg: null };
    }
    if (remCredits === 0) {
      return { ...t, status: curGpa >= t.min ? 'achieved' : 'not_achieved', reqAvg: null };
    }
    const neededPoints = (t.min * totalCredits) - curPoints;
    const reqAvg = neededPoints / remCredits;
    let status = 'achievable';
    if (curCredits > 0 && reqAvg <= 0) status = 'secured';
    else if (reqAvg > 4.0) status = 'impossible';
    return { ...t, status, reqAvg };
  });

  return { maxPossibleGpa, targets, totalCredits };
}

function calculateRepeatImpact({ curCredits, curGpa, repeatableCourses }) {
  const curPoints = curCredits * curGpa;
  const analyzed = repeatableCourses.map(c => {
    const ptDiff = 2.0 - c.gradePoint;
    const gainedPoints = ptDiff * c.credits;
    const newGpa = (curPoints + gainedPoints) / curCredits;
    const gpaGain = newGpa - curGpa;
    return { ...c, gainedPoints, newGpa, gpaGain };
  }).sort((a, b) => b.gpaGain - a.gpaGain);

  const totalGainedPoints = analyzed.reduce((acc, c) => acc + c.gainedPoints, 0);
  const allUpgradedGpa = curCredits > 0 ? (curPoints + totalGainedPoints) / curCredits : curGpa;
  const allGpaGain = allUpgradedGpa - curGpa;

  return { analyzed, totalGainedPoints, allUpgradedGpa, allGpaGain };
}

test('predicts ceiling and target feasibilities accurately for mid-degree student', () => {
  const res = calculatePredictorMetrics({ curCredits: 70, curGpa: 3.20, remCredits: 55 });
  assert.equal(res.maxPossibleGpa.toFixed(2), '3.55');

  const firstClass = res.targets.find(t => t.label === 'First Class');
  assert.equal(firstClass.status, 'impossible');
  assert.equal(firstClass.reqAvg.toFixed(2), '4.34');

  const secondUpper = res.targets.find(t => t.label === 'Second Class (Upper)');
  assert.equal(secondUpper.status, 'achievable');
  assert.equal(secondUpper.reqAvg.toFixed(2), '3.43');

  const generalPass = res.targets.find(t => t.label === 'General Pass');
  assert.equal(generalPass.status, 'achievable');
  assert.equal(generalPass.reqAvg.toFixed(2), '0.47');
});

test('handles completed degree edge case', () => {
  const res = calculatePredictorMetrics({ curCredits: 125, curGpa: 3.45, remCredits: 0 });
  assert.equal(res.maxPossibleGpa.toFixed(2), '3.45');
  const secondUpper = res.targets.find(t => t.label === 'Second Class (Upper)');
  assert.equal(secondUpper.status, 'achieved');
  const firstClass = res.targets.find(t => t.label === 'First Class');
  assert.equal(firstClass.status, 'not_achieved');
});

test('calculates repeat upgrade ROI with C cap rule', () => {
  const repeats = [
    { code: 'BL11301', credits: 3, grade: 'E', gradePoint: 0.0 },
    { code: 'EC12201', credits: 2, grade: 'D', gradePoint: 1.0 },
  ];
  const res = calculateRepeatImpact({ curCredits: 70, curGpa: 3.20, repeatableCourses: repeats });
  assert.equal(res.analyzed[0].code, 'BL11301');
  assert.equal(res.analyzed[0].gpaGain.toFixed(3), '0.086');
  assert.equal(res.analyzed[1].code, 'EC12201');
  assert.equal(res.analyzed[1].gpaGain.toFixed(3), '0.029');
  assert.equal(res.allUpgradedGpa.toFixed(2), '3.31');
  assert.equal(res.allGpaGain.toFixed(2), '0.11');
});


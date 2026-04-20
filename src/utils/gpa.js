export const GRADE_POINTS = {
  'A+': 5.0, 'A': 5.0, 'A-': 4.5,
  'B+': 4.0, 'B': 3.5, 'B-': 3.0,
  'C+': 2.5, 'C': 2.0,
  'D+': 1.5, 'D': 1.0,
  'F': 0.0,
};

const NON_GRADED = new Set(['S', 'U', 'CS', 'CU', 'EXE', 'IC', 'IP', 'W', 'WU', 'I']);

export function isGraded(grade) {
  return grade in GRADE_POINTS;
}

export function isNonGraded(grade) {
  return NON_GRADED.has(grade);
}

export function calculateGPA(courses) {
  let totalPoints = 0;
  let totalUnits = 0;

  for (const course of courses) {
    if (course.su) continue;
    const pts = GRADE_POINTS[course.grade];
    if (pts === undefined) continue;
    totalPoints += pts * course.units;
    totalUnits += course.units;
  }

  return {
    gpa: totalUnits > 0 ? totalPoints / totalUnits : null,
    totalUnits,
  };
}

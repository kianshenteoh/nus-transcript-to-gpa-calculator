import * as pdfjsLib from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

const COURSE_CODE_RE = /^[A-Z]{1,4}\d{4}[A-Z]?$/;
const GRADE_RE = /^(A\+|A-|A|B\+|B-|B|C\+|C-|C|D\+|D|F|S|U|CS|CU|EXE|IC|IP|W|WU)$/;
const UNITS_RE = /^\d+\.\d{2}$/;
const SEMESTER_RE = /ACADEMIC\s+YEAR\s+(\d{4}\/\d{4})\s+SEMESTER\s+(\d)/;

async function extractItems(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const items = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    for (const item of content.items) {
      const str = item.str.trim();
      if (!str) continue;
      items.push({
        str,
        x: Math.round(item.transform[4]),
        y: Math.round(item.transform[5]),
        page: p,
        pageWidth: Math.round(viewport.width),
      });
    }
  }
  return items;
}

function groupIntoRows(items) {
  const YTOL = 4;
  const rows = [];
  for (const item of items) {
    const row = rows.find(
      r => r.page === item.page && Math.abs(r.y - item.y) <= YTOL
    );
    if (row) {
      row.items.push(item);
    } else {
      rows.push({ page: item.page, y: item.y, items: [item] });
    }
  }
  // Sort rows: page asc, then y desc (top of page = high y in PDF coords)
  rows.sort((a, b) => a.page - b.page || b.y - a.y);
  rows.forEach(r => r.items.sort((a, b) => a.x - b.x));
  return rows;
}

function parseCourseTokens(tokens, semester, out) {
  let i = 0;
  while (i < tokens.length) {
    if (!COURSE_CODE_RE.test(tokens[i])) { i++; continue; }
    const code = tokens[i++];

    const nameParts = [];
    while (i < tokens.length && !GRADE_RE.test(tokens[i]) && !COURSE_CODE_RE.test(tokens[i])) {
      nameParts.push(tokens[i++]);
    }

    if (i >= tokens.length || !GRADE_RE.test(tokens[i])) continue;
    const grade = tokens[i++];

    if (i >= tokens.length || !UNITS_RE.test(tokens[i])) continue;
    const units = parseFloat(tokens[i++]);

    out.push({ code, name: nameParts.join(' '), grade, units, semester });
  }
}

export async function parseTranscript(file) {
  const items = await extractItems(file);
  const rows = groupIntoRows(items);

  // Split each row into left/right columns at page midpoint.
  // Process left column of all rows first (top→bottom), then right column.
  // This gives correct reading order for NUS two-column transcripts.
  const pageWidth = items[0]?.pageWidth ?? 595;
  const mid = pageWidth / 2;

  const courses = [];

  for (const side of ['left', 'right']) {
    let currentSemester = '';

    for (const row of rows) {
      const colItems = row.items.filter(it =>
        side === 'left' ? it.x < mid : it.x >= mid
      );
      if (colItems.length === 0) continue;

      const joined = colItems.map(i => i.str).join(' ');

      const semMatch = joined.match(SEMESTER_RE);
      if (semMatch) {
        currentSemester = `AY${semMatch[1]} Semester ${semMatch[2]}`;
        continue;
      }

      const tokens = colItems.map(i => i.str);
      parseCourseTokens(tokens, currentSemester, courses);
    }
  }

  // Deduplicate by course code (two-column layout can cause double-parsing)
  const seen = new Set();
  return courses.filter(c => {
    if (seen.has(c.code)) return false;
    seen.add(c.code);
    return true;
  });
}

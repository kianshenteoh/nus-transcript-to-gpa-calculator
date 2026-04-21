import * as pdfjsLib from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

const COURSE_CODE_RE = /^[A-Z]{1,4}\d{4}[A-Z]?$/;
const GRADE_RE = /^(A\+|A-|A|B\+|B-|B|C\+|C-|C|D\+|D|F|S|U|CS|CU|EXE|IC|IP|W|WU)$/;
const UNITS_RE = /^\d+\.\d{2}$/;

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
    const row = rows.find(r => r.page === item.page && Math.abs(r.y - item.y) <= YTOL);
    if (row) {
      row.items.push(item);
    } else {
      rows.push({ page: item.page, y: item.y, items: [item] });
    }
  }
  // Sort top→bottom (high y = top of page in PDF coords)
  rows.sort((a, b) => a.page - b.page || b.y - a.y);
  rows.forEach(r => r.items.sort((a, b) => a.x - b.x));
  return rows;
}

// Some PDFs split a course code at the letter/digit boundary (e.g. "CG" + "1111A").
// Repeatedly merge adjacent items until the combined string forms a valid code.
// Multiple passes handle 3-way splits like "C" + "G" + "1111A".
function mergeCodeFragments(rows) {
  for (const row of rows) {
    let changed = true;
    while (changed) {
      changed = false;
      const items = row.items;
      for (let i = 0; i < items.length - 1; i++) {
        const a = items[i].str;
        const b = items[i + 1].str;
        if (/^[A-Z]{1,4}$/.test(a) && COURSE_CODE_RE.test(a + b)) {
          items[i] = { ...items[i], str: a + b };
          items.splice(i + 1, 1);
          changed = true;
          break;
        }
      }
    }
  }
  return rows;
}

// Find the column split x: largest gap between course-code x-positions
function detectMid(items, fallback) {
  const xs = items
    .filter(i => COURSE_CODE_RE.test(i.str))
    .map(i => i.x)
    .sort((a, b) => a - b);
  if (xs.length < 4) return fallback;
  let maxGap = 0, mid = fallback;
  for (let i = 1; i < xs.length; i++) {
    const gap = xs[i] - xs[i - 1];
    if (gap > maxGap && gap > 80) {
      maxGap = gap;
      mid = (xs[i] + xs[i - 1]) / 2;
    }
  }
  return mid;
}

// Normalise a matched semester string into the label format used by the app.
// Handles "SEMESTER 1", "SEMESTER 2", "SPECIAL TERM I", "SPECIAL TERM II",
// and numeric variants ("SPECIAL TERM 1", "SPECIAL TERM 2").
function normalizeSemLabel(ay, term) {
  const t = term.trim().toUpperCase();
  if (t.startsWith('SEMESTER')) {
    return `AY${ay} Semester ${t.replace(/\D/g, '')}`;
  }
  // Special Term — accept Roman (I/II) or Arabic (1/2)
  const isSecond = /\bII\b|\b2\b/.test(t);
  return `AY${ay} Special Term ${isSecond ? 'II' : 'I'}`;
}

// Given a course code's x/y and a sorted list of semester headers,
// return the most appropriate semester label.
// Right-column courses with no preceding right-column header fall back to lastSem
// (the overflow section always belongs to the last/current semester).
function assignSemester(codeX, rowY, mid, semHeaders, lastSem) {
  const col = codeX >= mid ? 'right' : 'left';
  let result = '';
  for (const hdr of semHeaders) {
    if (hdr.y <= rowY) break;          // header is at or below course row
    if (col === 'right' && hdr.col === 'left') continue; // right-col courses skip left-col headers
    result = hdr.label;
  }
  if (!result && col === 'right') return lastSem;
  return result;
}

// Parse course entries from all items in a row (no column splitting —
// splitting broke because grade/units of left-column courses sit at x > mid).
// The course code's x-position is used only to determine semester assignment.
function parseCourseItems(items, rowY, mid, semHeaders, lastSem, out) {
  let i = 0;
  while (i < items.length) {
    if (!COURSE_CODE_RE.test(items[i].str)) { i++; continue; }
    const codeItem = items[i++];
    const code = codeItem.str;

    const nameParts = [];
    while (
      i < items.length &&
      !GRADE_RE.test(items[i].str) &&
      !COURSE_CODE_RE.test(items[i].str)
    ) {
      nameParts.push(items[i++].str);
    }

    if (i >= items.length || !GRADE_RE.test(items[i].str)) continue;
    const grade = items[i++].str;

    if (i >= items.length || !UNITS_RE.test(items[i].str)) continue;
    const units = parseFloat(items[i++].str);

    const semester = assignSemester(codeItem.x, rowY, mid, semHeaders, lastSem);
    out.push({ code, name: nameParts.join(' '), grade, units, semester });
  }
}

// Detect programme names from "PROGRAMME:" label rows.
// Only picks up items in the left column (x < progLabel.x + 350) to avoid
// the GPA-summary lines in the right column that also mention degree names.
function detectDegrees(rows) {
  const degrees = [];
  for (const row of rows) {
    const progLabel = row.items.find(i => i.str.trim() === 'PROGRAMME:');
    if (!progLabel) continue;
    const nameItem = row.items.find(i =>
      i.x > progLabel.x &&
      i.x < progLabel.x + 350 &&
      (i.str.includes('BACHELOR') || i.str.includes('MASTER') ||
       i.str.includes('DOCTOR') || i.str.includes('JURIS'))
    );
    if (nameItem && !degrees.includes(nameItem.str.trim())) {
      degrees.push(nameItem.str.trim());
    }
  }
  return degrees;
}

// Matches "SEMESTER 1", "SEMESTER 2", "SPECIAL TERM I", "SPECIAL TERM II",
// and numeric variants used on some transcript layouts.
const SEM_HEADER_RE =
  /ACADEMIC\s+YEAR\s+(\d{4}\/\d{4})\s+(SEMESTER\s+\d|SPECIAL\s+TERM\s+(?:I{1,2}|\d+))/g;
const SEM_SKIP_RE =
  /ACADEMIC\s+YEAR\s+\d{4}\/\d{4}\s+(SEMESTER\s+\d|SPECIAL\s+TERM)/;

export async function parseTranscript(file) {
  const items = await extractItems(file);
  const rows = mergeCodeFragments(groupIntoRows(items));
  const pageWidth = items[0]?.pageWidth ?? 595;
  const mid = detectMid(items, pageWidth / 2);

  const degrees = detectDegrees(rows);

  // Pass 1: collect all semester headers with their position + column
  const semHeaders = [];
  for (const row of rows) {
    const joined = row.items.map(i => i.str).join(' ');
    for (const m of joined.matchAll(SEM_HEADER_RE)) {
      const anchor = row.items.find(i => i.str.includes('ACADEMIC') || i.str.includes('YEAR'));
      semHeaders.push({
        label: normalizeSemLabel(m[1], m[2]),
        y: row.y,
        col: anchor && anchor.x >= mid ? 'right' : 'left',
      });
    }
  }
  // semHeaders is already top→bottom order (rows sorted high y first)
  const lastSem = semHeaders.at(-1)?.label ?? '';

  // Pass 2: parse courses, skip semester-header rows
  const courses = [];
  for (const row of rows) {
    const joined = row.items.map(i => i.str).join(' ');
    if (SEM_SKIP_RE.test(joined)) continue;
    parseCourseItems(row.items, row.y, mid, semHeaders, lastSem, courses);
  }

  // Deduplicate by course code
  const seen = new Set();
  const deduped = courses.filter(c => {
    if (seen.has(c.code)) return false;
    seen.add(c.code);
    return true;
  });

  return { courses: deduped, degrees };
}

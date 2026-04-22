import * as pdfjsLib from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

const COURSE_CODE_RE = /^[A-Z]{1,4}\d{4}[A-Z]{0,2}$/;
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
  // Sort top→bottom across pages (high y = top of page in PDF coords)
  rows.sort((a, b) => a.page - b.page || b.y - a.y);
  rows.forEach(r => r.items.sort((a, b) => a.x - b.x));
  return rows;
}

// Some PDFs split a course code at the letter/digit boundary (e.g. "CG" + "1111A").
// Repeatedly merge adjacent items until combined string forms a valid code.
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

// Returns both the mid-point between columns AND the minimum x of right-column course codes.
// rightStart is the true start of the right column and is used as the item split boundary.
// Using rightStart (not mid) ensures left-column grade/units items — which may be between
// mid and rightStart — stay in the left group.
function detectColumns(items, fallback) {
  const xs = items
    .filter(i => COURSE_CODE_RE.test(i.str))
    .map(i => i.x)
    .sort((a, b) => a - b);
  if (xs.length < 4) return { mid: fallback, rightStart: Infinity };
  let maxGap = 0, mid = fallback, rightStart = Infinity;
  for (let i = 1; i < xs.length; i++) {
    const gap = xs[i] - xs[i - 1];
    if (gap > maxGap && gap > 80) {
      maxGap = gap;
      mid = (xs[i] + xs[i - 1]) / 2;
      rightStart = xs[i];
    }
  }
  return { mid, rightStart };
}

// Find the row item that "owns" the character at matchIndex in the space-joined string.
// This correctly identifies which column a semester header belongs to even when two
// headers from different columns share the same row.
function anchorForMatch(items, matchIndex) {
  let pos = 0;
  for (const item of items) {
    const end = pos + item.str.length;
    if (matchIndex <= end) return item;
    pos = end + 1; // +1 for the space used in join(' ')
  }
  return items[0];
}

// A course belongs to the nearest semester header that precedes it in reading order.
// Reading order = page ascending, then y descending within a page (high y = top).
function assignSemester(codeX, rowPage, rowY, mid, semHeaders, lastSem) {
  const col = codeX >= mid ? 'right' : 'left';
  let result = '';
  for (const hdr of semHeaders) {
    // Stop when we reach a header that comes at or after this course in reading order
    if (hdr.page > rowPage || (hdr.page === rowPage && hdr.y <= rowY)) break;
    if (hdr.col !== col) continue;
    result = hdr.label;
  }
  // Column-break layout: the semester header sits at the bottom of the left column
  // while its courses appear at the top of the right column, so no right-column header
  // precedes those courses. Fall back to the bottommost left-column header on this page.
  if (!result && col === 'right') {
    let lowestY = Infinity;
    for (const hdr of semHeaders) {
      if (hdr.page === rowPage && hdr.col === 'left' && hdr.y < lowestY) {
        lowestY = hdr.y;
        result = hdr.label;
      }
    }
  }
  return result || lastSem;
}

// Core sequential parser: given a single column's items from one row, extract courses.
function parseSingleColumn(items, rowPage, rowY, mid, semHeaders, lastSem, out) {
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

    const semester = assignSemester(codeItem.x, rowPage, rowY, mid, semHeaders, lastSem);
    out.push({ code, name: nameParts.join(' '), grade, units, semester });
  }
}

// Split a row's items at the right-column boundary before parsing.
// This prevents right-column course codes (which sit between left-column grade and units
// in x-sorted order) from breaking left-column course detection.
function parseCourseItems(items, rowPage, rowY, mid, rightStart, semHeaders, lastSem, out) {
  if (rightStart === Infinity) {
    parseSingleColumn(items, rowPage, rowY, mid, semHeaders, lastSem, out);
    return;
  }
  const leftItems  = items.filter(i => i.x < rightStart);
  const rightItems = items.filter(i => i.x >= rightStart);
  parseSingleColumn(leftItems,  rowPage, rowY, mid, semHeaders, lastSem, out);
  parseSingleColumn(rightItems, rowPage, rowY, mid, semHeaders, lastSem, out);
}

// Detect programme names from "PROGRAMME:" label rows.
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

const SEM_HEADER_RE = /ACADEMIC\s+YEAR\s+(\d{4}\/\d{4})\s+(SEMESTER\s+\d|SPECIAL\s+TERM)/g;
const SEM_SKIP_RE   = /ACADEMIC\s+YEAR\s+\d{4}\/\d{4}\s+(SEMESTER\s+\d|SPECIAL\s+TERM)/;

export async function parseTranscript(file) {
  const items = await extractItems(file);
  const rows = mergeCodeFragments(groupIntoRows(items));
  const pageWidth = items[0]?.pageWidth ?? 595;
  const { mid, rightStart } = detectColumns(items, pageWidth / 2);

  const degrees = detectDegrees(rows);

  // Pass 1: collect all semester headers with their reading position and column.
  // anchorForMatch uses the character offset of each regex match in the joined string
  // to correctly attribute a header to its column even when two headers share a row.
  const semHeaders = [];
  for (const row of rows) {
    const joined = row.items.map(i => i.str).join(' ');
    for (const m of joined.matchAll(SEM_HEADER_RE)) {
      const anchor = anchorForMatch(row.items, m.index);
      let label;
      if (m[2].toUpperCase().startsWith('SEMESTER')) {
        label = `AY${m[1]} Semester ${m[2].replace(/\D/g, '')}`;
      } else {
        const rest = joined.slice(m.index + m[0].length);
        const n = /\b(II|2)\b/i.test(rest) ? 'II' : 'I';
        label = `AY${m[1]} Special Term ${n}`;
      }
      semHeaders.push({
        label,
        y: row.y,
        page: row.page,
        col: anchor.x >= mid ? 'right' : 'left',
      });
    }
  }
  const lastSem = semHeaders.at(-1)?.label ?? '';

  // Pass 2: parse courses, skip semester-header rows.
  // In two-column layout a semester header (left col) and a course (right col) can share
  // the same y — split such rows by column so only the header side is skipped.
  const courses = [];
  for (const row of rows) {
    const joined = row.items.map(i => i.str).join(' ');
    if (!SEM_SKIP_RE.test(joined)) {
      parseCourseItems(row.items, row.page, row.y, mid, rightStart, semHeaders, lastSem, courses);
      continue;
    }
    if (rightStart === Infinity) continue; // single-column: skip whole row
    const leftItems  = row.items.filter(i => i.x < rightStart);
    const rightItems = row.items.filter(i => i.x >= rightStart);
    // No SEM_SKIP_RE guard here — parseSingleColumn skips non-course words naturally,
    // so semester header text on either side is harmlessly ignored.
    parseSingleColumn(leftItems,  row.page, row.y, mid, semHeaders, lastSem, courses);
    parseSingleColumn(rightItems, row.page, row.y, mid, semHeaders, lastSem, courses);
  }

  // Deduplicate by (code, semester) — keeps repeated courses across different semesters
  // (e.g. a project module spanning two semesters) while dropping parser duplicates.
  const seen = new Set();
  const deduped = courses.filter(c => {
    const key = `${c.code}|${c.semester}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { courses: deduped, degrees };
}

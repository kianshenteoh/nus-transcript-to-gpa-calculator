import { useState, useCallback, useRef, useEffect } from 'react';
import { Analytics } from '@vercel/analytics/react';
import { parseTranscript } from './utils/parseTranscript';
import { calculateGPA, GRADE_POINTS } from './utils/gpa';
import { useNUSMods } from './hooks/useNUSMods';
import { CodeInput } from './components/CodeInput';
import { SpeedInsights } from '@vercel/speed-insights/react';
import './App.css';

const ALL_GRADES = [
  'A+', 'A', 'A-',
  'B+', 'B', 'B-',
  'C+', 'C',
  'D+', 'D',
  'F',
  'S', 'U', 'CS', 'CU', 'EXE', 'IC', 'IP', 'W', 'WU', 'I',
];

const currentYear = new Date().getFullYear();
const AY_OPTIONS = Array.from({ length: 21 }, (_, i) => {
  const start = currentYear - 10 + i;
  return `${start}/${start + 1}`;
});
const SEM_OPTIONS = ['Semester 1', 'Semester 2', 'Special Term I', 'Special Term II'];

function semesterLabel(ay, sem) {
  return `AY${ay} ${sem}`;
}

function semesterSortKey(sem) {
  if (sem === 'Manual') return Infinity;
  const m = sem.match(/AY(\d{4})\/\d{4} (.+)/);
  if (!m) return Infinity;
  const year = parseInt(m[1]);
  const s = m[2];
  const order = { 'Semester 1': 1, 'Semester 2': 2, 'Special Term I': 3, 'Special Term II': 4 };
  return year * 10 + (order[s] ?? 9);
}

function newRow(semester = '') {
  return { id: crypto.randomUUID(), code: '', name: '', grade: 'A', units: 4, su: false, semester, degree: '' };
}

function shortDegreeName(name) {
  const n = name.toUpperCase();
  if (n.includes('COMPUTING') && n.includes('COMPUTER SCIENCE')) return 'BComp (CS)';
  if (n.includes('COMPUTING') && n.includes('INFORMATION SECURITY')) return 'BComp (IS)';
  if (n.includes('COMPUTING') && n.includes('COMPUTER ENGINEERING')) return 'BComp (CE)';
  if (n.includes('COMPUTING')) return 'BComp';
  if (n.includes('BUSINESS ADMINISTRATION')) return 'BBA';
  if (n.includes('ACCOUNTANCY')) return 'BAcc';
  if (n.includes('SOCIAL SCIENCES')) return 'BSocSci';
  if (n.includes('ENGINEERING')) return 'BEng';
  if (n.includes('SCIENCE')) return 'BSc';
  if (n.includes('ARTS')) return 'BA';
  if (n.includes('LAW')) return 'LLB';
  return name;
}

// Round to 3dp first to correct floating-point imprecision (e.g. 4.425 stored as 4.4249999…),
// then display at 2dp with standard half-up rounding.
function fmtGPA(gpa) {
  return (Math.round(Math.round(gpa * 1000) / 10) / 100).toFixed(2);
}

function GpaBadge({ gpa }) {
  if (gpa === null) return <span className="gpa-value muted">—</span>;
  return <span className="gpa-value">{fmtGPA(gpa)}</span>;
}

export default function App() {
  const [courses, setCourses] = useState(() => {
    try {
      const raw = localStorage.getItem('gpa-data');
      return raw ? (JSON.parse(raw).courses ?? []) : [];
    } catch { return []; }
  });
  const [degrees, setDegrees] = useState(() => {
    try {
      const raw = localStorage.getItem('gpa-data');
      return raw ? (JSON.parse(raw).degrees ?? []) : [];
    } catch { return []; }
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  // dropTarget: null | { sem } for semester-level | { id, above: bool } for row-level
  const [dropTarget, setDropTarget] = useState(null);
  const [addSemAY, setAddSemAY] = useState('2025/2026');
  const [addSemType, setAddSemType] = useState('Semester 1');
  // Per-semester NUSMods import state: { [sem]: { url, loading, error } }
  const [nusmodsState, setNusmodsState] = useState({});
  const fileInputRef = useRef(null);
  const fileInputRef2 = useRef(null);
  const jsonInputRef = useRef(null);

  const { modules, ready, refreshModules, fetchCredits, importFromNUSMods } = useNUSMods();

  useEffect(() => {
    localStorage.setItem('gpa-data', JSON.stringify({ courses, degrees }));
  }, [courses, degrees]);

  function exportJSON() {
    const blob = new Blob([JSON.stringify({ degrees, courses }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nus-gpa.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImportJSON(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (!Array.isArray(data.courses)) throw new Error();
        setCourses(data.courses.map(c => ({ ...c, id: crypto.randomUUID() })));
        setDegrees(data.degrees ?? []);
        setError('');
        setNusmodsState({});
      } catch {
        setError('Failed to import: invalid JSON file.');
      }
    };
    reader.readAsText(file);
  }

  const handleFile = useCallback(async (file) => {
    const isPdf = file && (
      file.type === 'application/pdf' ||
      /\.pdf$/i.test(file.name ?? '')
    );
    if (!isPdf) {
      setError('Please upload a PDF file.');
      return;
    }
    setError('');
    setNusmodsState({});
    setLoading(true);
    try {
      const { courses: parsed, degrees: parsedDegrees } = await parseTranscript(file);
      if (parsed.length === 0) {
        setError('No courses found. Ensure the PDF is an NUS transcript, or add courses manually.');
      } else {
        window.gtag?.('event', 'transcript_upload');
      }
      setDegrees(parsedDegrees);
      setCourses(parsed.map(c => ({ ...c, id: crypto.randomUUID(), su: c.grade === 'S', degree: '' })));
    } catch (e) {
      console.error(e);
      setError('Failed to parse transcript. You can add courses manually.');
      setDegrees([]);
      setCourses([newRow()]);
    } finally {
      setLoading(false);
    }
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    handleFile(e.dataTransfer.files[0]);
  }, [handleFile]);

  const update = (id, field, value) =>
    setCourses(cs => cs.map(c => c.id === id ? { ...c, [field]: value } : c));

  const remove = (id) => setCourses(cs => cs.filter(c => c.id !== id));

  const addRow = (semester = '') => setCourses(cs => [...cs, newRow(semester)]);

  // NUSMods: when a module is selected from autocomplete
  async function handleModuleSelect(courseId, mod) {
    update(courseId, 'name', mod.title);
    const credits = await fetchCredits(mod.moduleCode);
    if (credits !== null) update(courseId, 'units', credits);
  }

  function getNusmodsSem(sem) {
    return nusmodsState[sem] ?? { url: '', loading: false, error: '' };
  }
  function setNusmodsSem(sem, patch) {
    setNusmodsState(s => ({ ...s, [sem]: { ...getNusmodsSem(sem), ...patch } }));
  }

  async function handleNusmodsImport(sem) {
    const { url } = getNusmodsSem(sem);
    if (!url.trim()) return;
    setNusmodsSem(sem, { loading: true, error: '' });
    try {
      const mods = await importFromNUSMods(url.trim());
      const semester = sem === 'Manual' ? '' : sem;
      setCourses(cs => [
        ...cs,
        ...mods.map(m => ({ ...newRow(semester), code: m.code, name: m.name, units: m.units })),
      ]);
      setNusmodsSem(sem, { url: '', loading: false, error: '' });
    } catch (e) {
      setNusmodsSem(sem, { loading: false, error: e.message || 'Failed to import from NUSMods.' });
    }
  }

  // Semester management
  const semesters = [...new Set(courses.map(c => c.semester || 'Manual'))]
    .sort((a, b) => semesterSortKey(a) - semesterSortKey(b));

  function addSemester() {
    const label = semesterLabel(addSemAY, addSemType);
    if (semesters.includes(label)) return; // already exists
    setCourses(cs => [...cs, newRow(label)]);
  }

  function deleteSemester(sem) {
    const count = courses.filter(c => (c.semester || 'Manual') === sem).length;
    const msg = count > 0
      ? `Delete "${sem}" and its ${count} course${count > 1 ? 's' : ''}?`
      : `Delete semester "${sem}"?`;
    if (window.confirm(msg)) {
      setCourses(cs => cs.filter(c => (c.semester || 'Manual') !== sem));
    }
  }

  const reset = () => { setCourses([]); setDegrees([]); setError(''); setNusmodsState({}); };
  const isDoubleDegree = degrees.length >= 2;
  const effectiveDegree = (course) => course.degree || degrees[0] || '';

  const { gpa, totalUnits } = calculateGPA(courses);

  return (
    <div className="app">
      <header>
        <div className="header-inner">
          <div className="header-title">
            <h1>NUS GPA Calculator - Transcript Upload</h1>
            <p>Calculate and track your GPA through uploading your unofficial transcript!</p>
          </div>
          {isDoubleDegree ? (
            <div className="header-degree-gpas">
              {degrees.map(deg => {
                const { gpa: degGpa, totalUnits: degUnits } = calculateGPA(
                  courses.filter(c => effectiveDegree(c) === deg)
                );
                return (
                  <div key={deg} className="header-degree-gpa">
                    <div className="gpa-label">{shortDegreeName(deg)}</div>
                    <GpaBadge gpa={degGpa} />
                    <div className="gpa-units">{degUnits} graded MCs</div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="cumulative-gpa">
              <div className="gpa-label">Cumulative GPA</div>
              <GpaBadge gpa={gpa} />
              <div className="gpa-units">{totalUnits} graded MCs</div>
            </div>
          )}
        </div>
      </header>
      <div className="header-toolbar">
        <div className="header-toolbar-inner">
          {courses.length > 0 && (
            <button className="btn btn-header-tool" onClick={exportJSON}>Export JSON</button>
          )}
          <button className="btn btn-header-tool" onClick={() => jsonInputRef.current?.click()}>Import JSON</button>
          <input
            ref={jsonInputRef}
            type="file"
            accept="application/json"
            hidden
            onChange={(e) => { handleImportJSON(e.target.files[0]); e.target.value = ''; }}
          />
        </div>
      </div>

      <main>
        {courses.length === 0 ? (
          <div className="upload-section">
            <ol className="upload-instructions">
              <li>Go to <strong>EduRec</strong> &gt; <strong>Academics</strong> &gt; <strong>Transcripts</strong> &gt; <strong>View Unofficial Transcript</strong> &gt; <strong>Undergraduate Unofficial</strong> &gt; <strong>Submit</strong></li>
              <li>Upload your unofficial transcript below</li>
              <li>For semesters not yet reflected in the transcript: Add new semester and insert NUSMODS <strong>original</strong> (not shortened!) link to populate it with your courses.</li>
            </ol>
            <div
              className={`upload-zone ${dragging ? 'dragging' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                hidden
                onChange={(e) => handleFile(e.target.files[0])}
              />
              {loading ? (
                <div className="loading-state">
                  <div className="spinner" />
                  <p>Parsing transcript…</p>
                </div>
              ) : (
                <>
                  <div className="upload-icon">📄</div>
                  <p className="upload-title">Drop your NUS transcript here</p>
                  <p className="upload-sub">or click to select a PDF</p>
                </>
              )}
            </div>
            {error && <p className="error">{error}</p>}
            <div className="divider"><span>or</span></div>
            <button className="btn btn-secondary" onClick={() => setCourses([newRow()])}>
              Add courses manually
            </button>
          </div>
        ) : (
          <>
            {loading && (
              <div className="loading-bar">
                <div className="spinner" /> Parsing transcript…
              </div>
            )}
            {error && <p className="error">{error}</p>}

            {semesters.map(sem => {
              const semCourses = courses.filter(c => (c.semester || 'Manual') === sem);
              const { gpa: semGpa } = calculateGPA(semCourses);
              return (
                <section
                  key={sem}
                  className={`semester-block${dropTarget?.sem === sem && !dropTarget?.id ? ' drop-target' : ''}`}
                  onDragOver={e => {
                    e.preventDefault();
                    // Only treat as semester-level target when not over a row
                    if (!dropTarget?.id) setDropTarget({ sem });
                  }}
                  onDrop={e => {
                    e.preventDefault();
                    const dragId = e.dataTransfer.getData('text/plain');
                    if (!dragId) { setDropTarget(null); return; }
                    if (dropTarget?.id) {
                      // Row-level drop: reorder within courses array
                      const targetId = dropTarget.id;
                      const above = dropTarget.above;
                      setCourses(cs => {
                        const next = cs.filter(c => c.id !== dragId);
                        const insertIdx = next.findIndex(c => c.id === targetId);
                        if (insertIdx === -1) return cs;
                        const pos = above ? insertIdx : insertIdx + 1;
                        const dragged = { ...cs.find(c => c.id === dragId), semester: sem === 'Manual' ? '' : sem };
                        next.splice(pos, 0, dragged);
                        return next;
                      });
                    } else {
                      // Semester-level drop: just move to this semester, append at end
                      update(dragId, 'semester', sem === 'Manual' ? '' : sem);
                    }
                    setDropTarget(null);
                  }}
                >
                  <div className="semester-heading">
                    <h2>{sem}</h2>
                    <div className="sem-heading-right">
                      {semGpa !== null && (
                        <span className="sem-gpa">
                          Sem GPA&nbsp;<strong>{fmtGPA(semGpa)}</strong>
                        </span>
                      )}
                      <button
                        className="btn-delete-sem"
                        onClick={() => deleteSemester(sem)}
                        title={`Delete ${sem}`}
                      >
                        🗑
                      </button>
                    </div>
                  </div>

                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th className="col-drag" />
                          <th className="col-code">Code</th>
                          <th className="col-name">Course</th>
                          <th className="col-grade">Grade</th>
                          <th className="col-units">MCs</th>
                          <th className="col-su">S/U</th>
                          {isDoubleDegree && <th className="col-degree">Degree</th>}
                          <th className="col-pts">Grade Points</th>
                          <th className="col-del" />
                        </tr>
                      </thead>
                      <tbody>
                        {semCourses.map(course => {
                          const pts = course.su ? null : (GRADE_POINTS[course.grade] ?? null);
                          return (
                            <tr
                              key={course.id}
                              draggable
                              onDragStart={e => {
                                e.dataTransfer.setData('text/plain', course.id);
                                e.dataTransfer.effectAllowed = 'move';
                              }}
                              onDragEnd={() => setDropTarget(null)}
                              onDragOver={e => {
                                e.preventDefault();
                                e.stopPropagation();
                                const above = e.clientY < e.currentTarget.getBoundingClientRect().top + e.currentTarget.offsetHeight / 2;
                                setDropTarget({ id: course.id, sem, above });
                              }}
                              className={[
                                course.su ? 'row-su' : '',
                                dropTarget?.id === course.id && dropTarget.above ? 'drop-above' : '',
                                dropTarget?.id === course.id && !dropTarget.above ? 'drop-below' : '',
                              ].filter(Boolean).join(' ')}
                            >
                              <td className="col-drag"><span className="drag-handle">⠿</span></td>
                              <td className="td-code">
                                <CodeInput
                                  value={course.code}
                                  onChange={val => update(course.id, 'code', val)}
                                  onSelect={mod => handleModuleSelect(course.id, mod)}
                                  modules={modules}
                                  ready={ready}
                                  ensureModulesLoaded={refreshModules}
                                />
                              </td>
                              <td className="td-name">
                                <input
                                  value={course.name}
                                  onChange={e => update(course.id, 'name', e.target.value)}
                                  placeholder="Course name"
                                  className="inp-name"
                                />
                              </td>
                              <td>
                                <select
                                  value={course.grade}
                                  onChange={e => update(course.id, 'grade', e.target.value)}
                                  className="sel-grade"
                                >
                                  {ALL_GRADES.map(g => (
                                    <option key={g} value={g}>{g}</option>
                                  ))}
                                </select>
                              </td>
                              <td>
                                <input
                                  type="number"
                                  value={course.units ?? ''}
                                  min={0}
                                  step={1}
                                  onChange={e => {
                                    const nextUnits = e.target.value === '' ? null : parseFloat(e.target.value);
                                    update(course.id, 'units', Number.isFinite(nextUnits) ? nextUnits : null);
                                  }}
                                  className="inp-units"
                                />
                              </td>
                              <td className="col-su-cell">
                                <input
                                  type="checkbox"
                                  checked={course.su}
                                  onChange={e => update(course.id, 'su', e.target.checked)}
                                  className="chk-su"
                                />
                              </td>
                              {isDoubleDegree && (
                                <td>
                                  <select
                                    value={effectiveDegree(course)}
                                    onChange={e => update(course.id, 'degree', e.target.value)}
                                    className="sel-degree"
                                  >
                                    {degrees.map(d => (
                                      <option key={d} value={d}>{shortDegreeName(d)}</option>
                                    ))}
                                  </select>
                                </td>
                              )}
                              <td className="col-pts-cell">
                                {pts !== null ? pts.toFixed(1) : <span className="muted">—</span>}
                              </td>
                              <td>
                                <button className="btn-del" onClick={() => remove(course.id)} title="Remove">✕</button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="sem-footer">
                    <button
                      className="btn btn-ghost btn-add-row"
                      onClick={() => addRow(sem === 'Manual' ? '' : sem)}
                    >
                      + Add course
                    </button>
                    <div className="nusmods-block">
                      <div className="nusmods-inline">
                        <input
                          className="inp-nusmods"
                          type="text"
                          placeholder="Paste NUSMods timetable link…"
                          value={getNusmodsSem(sem).url}
                          onChange={e => {
                            const url = e.target.value;
                            setNusmodsSem(sem, {
                              url,
                              error: url.trim() ? getNusmodsSem(sem).error : '',
                            });
                          }}
                          onKeyDown={e => e.key === 'Enter' && handleNusmodsImport(sem)}
                        />
                        <button
                          className="btn btn-ghost"
                          onClick={() => handleNusmodsImport(sem)}
                          disabled={getNusmodsSem(sem).loading || !getNusmodsSem(sem).url.trim()}
                        >
                          {getNusmodsSem(sem).loading ? 'Importing…' : 'Import'}
                        </button>
                      </div>
                      {getNusmodsSem(sem).error && (
                        <p className="error nusmods-err">{getNusmodsSem(sem).error}</p>
                      )}
                    </div>
                  </div>
                </section>
              );
            })}

            {/* Add Semester */}
            <div className="add-sem-card">
              <span className="add-sem-label">Add semester</span>
              <select value={addSemAY} onChange={e => setAddSemAY(e.target.value)} className="sel-ay">
                {AY_OPTIONS.map(ay => <option key={ay} value={ay}>AY{ay}</option>)}
              </select>
              <select value={addSemType} onChange={e => setAddSemType(e.target.value)} className="sel-semtype">
                {SEM_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <button className="btn btn-primary" onClick={addSemester}>Add</button>
            </div>


<div className="bottom-actions">
              <button className="btn btn-secondary" onClick={() => fileInputRef2.current?.click()}>
                Re-upload transcript
              </button>
              <input
                ref={fileInputRef2}
                type="file"
                accept="application/pdf"
                hidden
                onChange={(e) => handleFile(e.target.files[0])}
              />
              <button className="btn btn-ghost" onClick={reset}>Clear all</button>
            </div>
          </>
        )}
      </main>

      <footer>
        <p>
          A+/A = 5.0 · A- = 4.5 · B+ = 4.0 · B = 3.5 · B- = 3.0 · C+ = 2.5 · C = 2.0 · D+ = 1.5 · D = 1.0 · F = 0.0
        </p>
        <p>S/U-opted, non-graded, and courses without MCs are excluded from GPA computation.</p>
        <p>Transcript parsing is not perfect. Do check for mistakes and adjust your courses when necessary.</p>
      </footer>
      <Analytics />
      <SpeedInsights />
    </div>
  );
}

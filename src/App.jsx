import { useState, useCallback, useRef } from 'react';
import { parseTranscript } from './utils/parseTranscript';
import { calculateGPA, GRADE_POINTS, isNonGraded } from './utils/gpa';
import { useNUSMods } from './hooks/useNUSMods';
import { CodeInput } from './components/CodeInput';
import './App.css';

const ALL_GRADES = [
  'A+', 'A', 'A-',
  'B+', 'B', 'B-',
  'C+', 'C',
  'D+', 'D',
  'F',
  'S', 'U', 'CS', 'CU', 'EXE', 'IC', 'IP', 'W', 'WU',
];

// Generate AY options from 2018/2019 to 2029/2030
const AY_OPTIONS = Array.from({ length: 12 }, (_, i) => {
  const start = 2018 + i;
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
  return { id: crypto.randomUUID(), code: '', name: '', grade: 'A', units: 4, su: false, semester };
}

function GpaBadge({ gpa }) {
  if (gpa === null) return <span className="gpa-value muted">—</span>;
  return <span className="gpa-value">{gpa.toFixed(2)}</span>;
}

export default function App() {
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [addSemAY, setAddSemAY] = useState('2025/2026');
  const [addSemType, setAddSemType] = useState('Semester 1');
  const fileInputRef = useRef(null);
  const fileInputRef2 = useRef(null);

  const { modules, ready, fetchCredits } = useNUSMods();

  const handleFile = useCallback(async (file) => {
    if (!file || file.type !== 'application/pdf') {
      setError('Please upload a PDF file.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const parsed = await parseTranscript(file);
      if (parsed.length === 0) {
        setError('No courses found. Ensure the PDF is an NUS transcript, or add courses manually.');
      }
      setCourses(parsed.map(c => ({ ...c, id: crypto.randomUUID(), su: isNonGraded(c.grade) })));
    } catch (e) {
      console.error(e);
      setError('Failed to parse transcript. You can add courses manually.');
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
    // Fetch real credit count in background
    const credits = await fetchCredits(mod.moduleCode);
    if (credits !== null) update(courseId, 'units', credits);
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

  const reset = () => { setCourses([]); setError(''); };

  const { gpa, totalUnits } = calculateGPA(courses);

  return (
    <div className="app">
      <header>
        <div className="header-inner">
          <div className="header-title">
            <h1>NUS GPA Calculator</h1>
          </div>
          <div className="cumulative-gpa">
            <div className="gpa-label">Cumulative GPA</div>
            <GpaBadge gpa={gpa} />
            <div className="gpa-units">{totalUnits} graded MCs</div>
          </div>
        </div>
      </header>

      <main>
        {courses.length === 0 ? (
          <div className="upload-section">
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
                <section key={sem} className="semester-block">
                  <div className="semester-heading">
                    <h2>{sem}</h2>
                    <div className="sem-heading-right">
                      {semGpa !== null && (
                        <span className="sem-gpa">
                          Sem GPA&nbsp;<strong>{semGpa.toFixed(2)}</strong>
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
                          <th className="col-code">Code</th>
                          <th className="col-name">Course</th>
                          <th className="col-grade">Grade</th>
                          <th className="col-units">MCs</th>
                          <th className="col-su">S/U</th>
                          <th className="col-pts">Grade Points</th>
                          <th className="col-del" />
                        </tr>
                      </thead>
                      <tbody>
                        {semCourses.map(course => {
                          const pts = course.su ? null : (GRADE_POINTS[course.grade] ?? null);
                          return (
                            <tr key={course.id} className={course.su ? 'row-su' : ''}>
                              <td className="td-code">
                                <CodeInput
                                  value={course.code}
                                  onChange={val => update(course.id, 'code', val)}
                                  onSelect={mod => handleModuleSelect(course.id, mod)}
                                  modules={modules}
                                  ready={ready}
                                />
                              </td>
                              <td>
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
                                  value={course.units}
                                  min={0}
                                  step={1}
                                  onChange={e => update(course.id, 'units', parseFloat(e.target.value) || 0)}
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

                  <button
                    className="btn btn-ghost btn-add-row"
                    onClick={() => addRow(sem === 'Manual' ? '' : sem)}
                  >
                    + Add course to {sem}
                  </button>
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
        <p>S/U-opted and non-graded courses are excluded from GPA computation.</p>
      </footer>
    </div>
  );
}

import { useState, useRef, useEffect, useCallback } from 'react';

export function CodeInput({ value, onChange, onSelect, modules, ready }) {
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [highlighted, setHighlighted] = useState(0);
  const wrapRef = useRef(null);
  const listRef = useRef(null);

  const getSuggestions = useCallback((q) => {
    if (!q || q.length < 2 || !modules.length) return [];
    const upper = q.toUpperCase();
    return modules
      .filter(m => m.moduleCode.startsWith(upper))
      .slice(0, 8);
  }, [modules]);

  function handleChange(e) {
    const q = e.target.value.toUpperCase();
    onChange(q);
    const sugs = getSuggestions(q);
    setSuggestions(sugs);
    setHighlighted(0);
    setOpen(sugs.length > 0);
  }

  function handleFocus() {
    const sugs = getSuggestions(value);
    if (sugs.length > 0) { setSuggestions(sugs); setOpen(true); }
  }

  function handleKeyDown(e) {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted(h => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted(h => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (suggestions[highlighted]) select(suggestions[highlighted]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  function select(mod) {
    onChange(mod.moduleCode);
    onSelect(mod);
    setOpen(false);
    setSuggestions([]);
  }

  // Scroll highlighted item into view
  useEffect(() => {
    if (listRef.current) {
      const el = listRef.current.children[highlighted];
      el?.scrollIntoView({ block: 'nearest' });
    }
  }, [highlighted]);

  // Close on outside click
  useEffect(() => {
    function onClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <div className="code-input-wrap" ref={wrapRef}>
      <input
        value={value}
        onChange={handleChange}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        placeholder={ready ? 'e.g. CS1101S' : '…'}
        className="inp-code"
        autoComplete="off"
        spellCheck={false}
      />
      {open && suggestions.length > 0 && (
        <ul className="suggestions" ref={listRef}>
          {suggestions.map((mod, idx) => (
            <li
              key={mod.moduleCode}
              className={`suggestion-item ${idx === highlighted ? 'highlighted' : ''}`}
              onMouseDown={() => select(mod)}
              onMouseEnter={() => setHighlighted(idx)}
            >
              <span className="sug-code">{mod.moduleCode}</span>
              <span className="sug-title">{mod.title}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

export function CodeInput({ value, onChange, onSelect, modules, ready }) {
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [highlighted, setHighlighted] = useState(0);
  const [dropdownStyle, setDropdownStyle] = useState({});
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const getSuggestions = useCallback((q) => {
    if (!q || q.length < 2 || !modules.length) return [];
    const upper = q.toUpperCase();
    return modules
      .filter(m => m.moduleCode.startsWith(upper))
  }, [modules]);

  function positionDropdown() {
    if (!inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    setDropdownStyle({
      position: 'fixed',
      top: rect.bottom + 4,
      left: rect.left,
      minWidth: Math.max(rect.width, 340),
      zIndex: 9999,
    });
  }

  function openWith(sugs) {
    positionDropdown();
    setSuggestions(sugs);
    setHighlighted(0);
    setOpen(true);
  }

  function handleChange(e) {
    const q = e.target.value.toUpperCase();
    onChange(q);
    const sugs = getSuggestions(q);
    if (sugs.length > 0) openWith(sugs);
    else setOpen(false);
  }

  function handleFocus() {
    const sugs = getSuggestions(value);
    if (sugs.length > 0) openWith(sugs);
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
      listRef.current.children[highlighted]?.scrollIntoView({ block: 'nearest' });
    }
  }, [highlighted]);

  // Close on outside click; reposition on scroll/resize
  useEffect(() => {
    function onOutside(e) {
      if (inputRef.current && !inputRef.current.closest('.code-input-wrap')?.contains(e.target) &&
          listRef.current && !listRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    function onScroll() { if (open) positionDropdown(); }
    document.addEventListener('mousedown', onOutside);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  const dropdown = open && suggestions.length > 0
    ? createPortal(
        <ul className="suggestions" ref={listRef} style={dropdownStyle}>
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
        </ul>,
        document.body
      )
    : null;

  return (
    <div className="code-input-wrap" ref={inputRef}>
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
      {dropdown}
    </div>
  );
}

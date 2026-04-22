import { useState, useEffect } from 'react';

const BASE = 'https://api.nusmods.com/v2';
// Fetch current and previous AY for broad coverage
const YEARS = ['2025-2026', '2024-2025'];

let cachedModules = null;
let fetchPromise = null;

async function loadModules() {
  if (cachedModules) return cachedModules;
  if (fetchPromise) return fetchPromise;

  fetchPromise = (async () => {
    const all = new Map();
    for (const year of YEARS) {
      try {
        const res = await fetch(`${BASE}/${year}/moduleList.json`);
        if (!res.ok) continue;
        const list = await res.json();
        // Don't overwrite — first year (newest) takes priority
        for (const m of list) {
          if (!all.has(m.moduleCode)) all.set(m.moduleCode, m);
        }
      } catch {
        // silently skip if offline or API down
      }
    }
    cachedModules = [...all.values()];
    return cachedModules;
  })();

  return fetchPromise;
}

export function useNUSMods() {
  const [modules, setModules] = useState([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    loadModules().then(list => {
      setModules(list);
      setReady(true);
    });
  }, []);

  async function fetchCredits(moduleCode) {
    for (const year of YEARS) {
      try {
        const res = await fetch(`${BASE}/${year}/modules/${moduleCode}.json`);
        if (!res.ok) continue;
        const data = await res.json();
        return data.moduleCredit ? Number(data.moduleCredit) : null;
      } catch {
        // continue to next year
      }
    }
    return null;
  }

  // Parse a NUSMods share URL and return [{code, name, units}] for each module.
  // URL format: https://nusmods.com/timetable/sem-1/share?CS2040=LEC:1,TUT:2&MA1521=...
  async function importFromNUSMods(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error('Invalid URL');
    }
    if (!parsed.hostname.includes('nusmods.com')) {
      throw new Error('Not a NUSMods URL');
    }

    const codes = [...parsed.searchParams.keys()];
    if (codes.length === 0) throw new Error('No modules found in URL');

    // Fetch module list to get titles (already cached from loadModules)
    const list = await loadModules();
    const titleMap = Object.fromEntries(list.map(m => [m.moduleCode, m.title]));

    const results = await Promise.all(
      codes.map(async (code) => {
        const credits = await fetchCredits(code);
        return { code, name: titleMap[code] ?? '', units: credits ?? 4 };
      })
    );
    return results;
  }

  return { modules, ready, fetchCredits, importFromNUSMods };
}

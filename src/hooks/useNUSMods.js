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

  return { modules, ready, fetchCredits };
}

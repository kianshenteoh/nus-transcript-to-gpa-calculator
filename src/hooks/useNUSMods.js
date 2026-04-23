import { useState, useEffect, useCallback } from 'react';

const BASE = 'https://api.nusmods.com/v2';
const MODULE_CODE_RE = /^[A-Z]{1,4}\d{4}[A-Z]{0,3}$/;

function getAcademicYears(count = 8) {
  const now = new Date();
  const currentAyStart = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  return Array.from({ length: count }, (_, i) => {
    const start = currentAyStart - i;
    return `${start}-${start + 1}`;
  });
}

const YEARS = getAcademicYears();

let cachedModules = null;
let fetchPromise = null;
const detailCache = new Map();
const detailPromises = new Map();

function normalizeModuleCode(code) {
  return String(code ?? '').trim().toUpperCase();
}

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
        // Keep the newest AY's entry when a module exists in multiple years.
        for (const m of list) {
          if (!all.has(m.moduleCode)) all.set(m.moduleCode, m);
        }
      } catch {
        // Silently skip if offline or the API is unavailable.
      }
    }

    if (all.size === 0) {
      throw new Error('Failed to load modules');
    }

    cachedModules = [...all.values()];
    return cachedModules;
  })();

  try {
    return await fetchPromise;
  } finally {
    fetchPromise = null;
  }
}

async function fetchModuleDetails(moduleCode) {
  const code = normalizeModuleCode(moduleCode);
  if (!code) return null;
  if (detailCache.has(code)) return detailCache.get(code);
  if (detailPromises.has(code)) return detailPromises.get(code);

  const pending = (async () => {
    for (const year of YEARS) {
      try {
        const res = await fetch(`${BASE}/${year}/modules/${code}.json`);
        if (!res.ok) continue;
        const data = await res.json();
        const details = {
          title: data.title ?? '',
          credits: data.moduleCredit ? Number(data.moduleCredit) : null,
        };
        detailCache.set(code, details);
        return details;
      } catch {
        // Continue to older AYs on lookup failures.
      }
    }
    return null;
  })();

  detailPromises.set(code, pending);
  try {
    return await pending;
  } finally {
    detailPromises.delete(code);
  }
}

export function useNUSMods() {
  const [modules, setModules] = useState([]);
  const [ready, setReady] = useState(false);

  const refreshModules = useCallback(async () => {
    try {
      const list = await loadModules();
      setModules(list);
      return list;
    } catch {
      setModules([]);
      return [];
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    loadModules()
      .then(list => {
        if (!cancelled) setModules(list);
      })
      .catch(() => {
        if (!cancelled) setModules([]);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function fetchCredits(moduleCode) {
    const details = await fetchModuleDetails(moduleCode);
    return details?.credits ?? null;
  }

  // Parse a NUSMods share URL and return [{code, name, units}] for each module.
  // URL format: https://nusmods.com/timetable/sem-1/share?CS2040=LEC:1,TUT:2&MA1521=...
  async function importFromNUSMods(url) {
    let parsed;
    try {
      parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    } catch {
      throw new Error('Invalid URL');
    }

    const hostname = parsed.hostname.toLowerCase();
    if (hostname !== 'nusmods.com' && !hostname.endsWith('.nusmods.com')) {
      throw new Error('Not a NUSMods URL');
    }

    const codes = [...new Set(
      [...parsed.searchParams.keys()]
        .map(normalizeModuleCode)
        .filter(code => MODULE_CODE_RE.test(code))
    )];
    if (codes.length === 0) throw new Error('No modules found in URL');

    let titleMap = {};
    try {
      const list = await loadModules();
      titleMap = Object.fromEntries(list.map(m => [m.moduleCode, m.title]));
    } catch {
      // Continue - per-module lookups can still populate names and credits.
    }

    const results = await Promise.all(
      codes.map(async (code) => {
        const details = await fetchModuleDetails(code);
        return {
          code,
          name: titleMap[code] ?? details?.title ?? '',
          units: details?.credits ?? null,
        };
      })
    );
    return results;
  }

  return { modules, ready, refreshModules, fetchCredits, importFromNUSMods };
}

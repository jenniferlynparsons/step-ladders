// Local persistence, settings, and JSON import/export. Bundled workouts are never
// written to storage; local copies override them by id until reset.

import { validateWorkout } from './workout-model.js';

export const LIBRARY_KEY = 'workoutGuide.library';
export const SETTINGS_KEY = 'workoutGuide.settings';
export const STORE_VERSION = 1;
export const EXPORT_FORMAT = 'workout-guide-export';
export const MAX_IMPORT_BYTES = 1_000_000;

export const DEFAULT_SETTINGS = Object.freeze({
  voice: true,
  rate: 1,
  prepSeconds: 3,
  warning: true,
  countdown: true,
  wakeLock: true,
});

// Add an entry here (from -> to) when the stored shape changes; never overwrite old data blindly.
const MIGRATIONS = {};

const emptyData = () => ({ version: STORE_VERSION, workouts: {}, hidden: [] });

export function createStore(storage = globalThis.localStorage) {
  let warning = '';

  function read() {
    warning = '';
    let raw;
    try {
      raw = storage.getItem(LIBRARY_KEY);
    } catch {
      warning = 'Local storage is unavailable; changes will not be saved.';
      return emptyData();
    }
    if (!raw) return emptyData();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      warning = 'Saved workouts could not be read. They were left untouched; new saves are disabled.';
      return null;
    }
    while (data && data.version !== STORE_VERSION && MIGRATIONS[data.version]) {
      data = MIGRATIONS[data.version](data);
    }
    if (!data || data.version !== STORE_VERSION || typeof data.workouts !== 'object') {
      warning = 'Saved workouts use an unknown format. They were left untouched; new saves are disabled.';
      return null;
    }
    return { version: STORE_VERSION, workouts: data.workouts || {}, hidden: Array.isArray(data.hidden) ? data.hidden : [] };
  }

  function write(data) {
    if (!data) throw new Error(warning || 'Saving is disabled.');
    try {
      storage.setItem(LIBRARY_KEY, JSON.stringify(data));
    } catch {
      throw new Error('Could not save to this browser’s storage (it may be full or disabled).');
    }
  }

  function mutate(fn) {
    const data = read();
    if (!data) throw new Error(warning);
    fn(data);
    write(data);
  }

  return {
    get warning() {
      return warning;
    },

    /** Merge bundled workouts with local ones. Returns [{ workout, origin }] where origin is bundled|edited|local. */
    getLibrary(bundled) {
      const data = read() || emptyData();
      const bundledIds = new Set(bundled.map((w) => w.id));
      const list = [];
      for (const b of bundled) {
        if (data.hidden.includes(b.id)) continue;
        const local = data.workouts[b.id];
        const checked = local && validateWorkout(local);
        list.push(checked?.ok ? { workout: checked.workout, origin: 'edited' } : { workout: b, origin: 'bundled' });
      }
      for (const [id, w] of Object.entries(data.workouts)) {
        if (bundledIds.has(id)) continue;
        const checked = validateWorkout(w);
        if (checked.ok) list.push({ workout: checked.workout, origin: 'local' });
      }
      return list;
    },

    hiddenCount(bundled) {
      const data = read();
      return data ? bundled.filter((b) => data.hidden.includes(b.id)).length : 0;
    },

    /** Validates all first, then writes once: either every workout is saved or none is. */
    saveWorkouts(list) {
      const checked = list.map((w) => validateWorkout(w));
      const errors = checked.flatMap((c) => c.errors);
      if (errors.length) throw new Error(errors.join('\n'));
      const workouts = checked.map((c) => c.workout);
      mutate((d) => {
        for (const w of workouts) d.workouts[w.id] = w;
        d.hidden = d.hidden.filter((id) => !workouts.some((w) => w.id === id));
      });
      return workouts;
    },

    saveWorkout(workout) {
      return this.saveWorkouts([workout])[0];
    },

    deleteWorkout(id, isBundled) {
      mutate((d) => {
        delete d.workouts[id];
        if (isBundled && !d.hidden.includes(id)) d.hidden.push(id);
      });
    },

    /** Drop the local copy of a bundled workout so the bundled version shows again. */
    resetWorkout(id) {
      mutate((d) => {
        delete d.workouts[id];
      });
    },

    restoreHidden() {
      mutate((d) => {
        d.hidden = [];
      });
    },

    loadSettings() {
      let s = {};
      try {
        s = JSON.parse(storage.getItem(SETTINGS_KEY)) || {};
      } catch {
        s = {};
      }
      return normalizeSettings(s);
    },

    saveSettings(settings) {
      const s = normalizeSettings(settings);
      try {
        storage.setItem(SETTINGS_KEY, JSON.stringify(s));
      } catch {
        /* settings are a convenience; ignore storage failures */
      }
      return s;
    },
  };
}

export function normalizeSettings(s) {
  const d = DEFAULT_SETTINGS;
  const bool = (v, def) => (typeof v === 'boolean' ? v : def);
  const rate = Number(s.rate);
  const prep = Number(s.prepSeconds);
  return {
    voice: bool(s.voice, d.voice),
    rate: Number.isFinite(rate) ? Math.min(1.25, Math.max(0.75, rate)) : d.rate,
    prepSeconds: Number.isInteger(prep) ? Math.min(10, Math.max(0, prep)) : d.prepSeconds,
    warning: bool(s.warning, d.warning),
    countdown: bool(s.countdown, d.countdown),
    wakeLock: bool(s.wakeLock, d.wakeLock),
  };
}

export function exportJSON(workouts) {
  return JSON.stringify(
    { format: EXPORT_FORMAT, exportVersion: 1, exportedAt: new Date().toISOString(), workouts },
    null,
    2,
  );
}

/**
 * Parse an import file. Accepts an export envelope, an array of workouts, or one workout.
 * All-or-nothing: any invalid workout rejects the whole file.
 * @returns {{ ok: boolean, errors: string[], workouts: object[] }}
 */
export function parseImport(textValue) {
  if (typeof textValue !== 'string' || !textValue.trim()) return fail('The file is empty.');
  if (textValue.length > MAX_IMPORT_BYTES) return fail('The file is too large (limit 1 MB).');
  let data;
  try {
    data = JSON.parse(textValue);
  } catch {
    return fail('The file is not valid JSON.');
  }
  let list;
  if (Array.isArray(data)) list = data;
  else if (data && data.format === EXPORT_FORMAT) {
    if (data.exportVersion !== 1) return fail(`Unsupported export version ${JSON.stringify(data.exportVersion)}.`);
    list = data.workouts;
  } else if (data && typeof data === 'object') list = [data];
  if (!Array.isArray(list) || !list.length) return fail('No workouts found in the file.');

  const errors = [];
  const workouts = [];
  const ids = new Set();
  list.forEach((w, i) => {
    const r = validateWorkout(w);
    if (!r.ok) errors.push(...r.errors.map((e) => `Workout ${i + 1}: ${e}`));
    else if (ids.has(r.workout.id)) errors.push(`Workout ${i + 1}: id "${r.workout.id}" appears more than once.`);
    else {
      ids.add(r.workout.id);
      workouts.push(r.workout);
    }
  });
  return errors.length ? { ok: false, errors, workouts: [] } : { ok: true, errors, workouts };
}

const fail = (msg) => ({ ok: false, errors: [msg], workouts: [] });

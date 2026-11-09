// Workout schema: validation, normalization, flattening, durations. No DOM.

export const SCHEMA_VERSION = 1;
export const KNOWN_PHASE_TYPES = ['work', 'rest', 'transition'];
export const LIMITS = {
  title: 100,
  description: 500,
  notes: 1000,
  url: 2000,
  name: 100,
  instructions: 500,
  label: 100,
  speech: 500,
  exercises: 100,
  phases: 50,
  minSeconds: 1,
  maxSeconds: 3600,
};

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
// Phase types are open-ended slugs so new categories need no code change.
const TYPE_RE = /^[a-z][a-z0-9-]{0,29}$/;

export function isSafeUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

function text(errors, where, obj, key, max, required) {
  const v = obj[key];
  if (v === undefined || v === null || v === '') {
    if (required) errors.push(`${where}: ${key} is required.`);
    return '';
  }
  if (typeof v !== 'string') {
    errors.push(`${where}: ${key} must be text.`);
    return '';
  }
  const trimmed = v.trim();
  if (required && !trimmed) errors.push(`${where}: ${key} is required.`);
  if (trimmed.length > max) errors.push(`${where}: ${key} must be at most ${max} characters.`);
  return trimmed;
}

function id(errors, where, obj, seen) {
  const v = obj.id;
  if (typeof v !== 'string' || !ID_RE.test(v)) {
    errors.push(`${where}: id must be 1–64 letters, numbers, "-" or "_".`);
    return '';
  }
  if (seen.has(v)) errors.push(`${where}: id "${v}" is used more than once.`);
  seen.add(v);
  return v;
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Validates a workout and returns a normalized copy containing only known fields.
 * @returns {{ ok: boolean, errors: string[], workout: object|null }}
 */
export function validateWorkout(input) {
  const errors = [];
  if (!isObject(input)) return { ok: false, errors: ['Workout must be a JSON object.'], workout: null };

  if (input.schemaVersion !== SCHEMA_VERSION) {
    const v = JSON.stringify(input.schemaVersion) ?? 'missing';
    return {
      ok: false,
      errors: [`Unsupported schema version ${v}. This app understands version ${SCHEMA_VERSION}.`],
      workout: null,
    };
  }

  const title = typeof input.title === 'string' && input.title.trim() ? input.title.trim() : 'Workout';
  const w = `"${title.slice(0, 40)}"`;
  const out = {
    schemaVersion: SCHEMA_VERSION,
    id: id(errors, w, input, new Set()),
    title: text(errors, w, input, 'title', LIMITS.title, true),
    description: text(errors, w, input, 'description', LIMITS.description, false),
    sourceUrl: text(errors, w, input, 'sourceUrl', LIMITS.url, false),
    notes: text(errors, w, input, 'notes', LIMITS.notes, false),
    exercises: [],
  };
  if (out.sourceUrl && !isSafeUrl(out.sourceUrl)) {
    errors.push(`${w}: source URL must start with http:// or https://.`);
  }

  if (!Array.isArray(input.exercises) || input.exercises.length === 0) {
    errors.push(`${w}: add at least one exercise.`);
  } else if (input.exercises.length > LIMITS.exercises) {
    errors.push(`${w}: at most ${LIMITS.exercises} exercises are allowed.`);
  } else {
    const exIds = new Set();
    input.exercises.forEach((ex, i) => {
      const ew = `Exercise ${i + 1}`;
      if (!isObject(ex)) {
        errors.push(`${ew}: must be an object.`);
        return;
      }
      const exOut = {
        id: id(errors, ew, ex, exIds),
        name: text(errors, ew, ex, 'name', LIMITS.name, true),
        instructions: text(errors, ew, ex, 'instructions', LIMITS.instructions, false),
        phases: [],
      };
      if (!Array.isArray(ex.phases) || ex.phases.length === 0) {
        errors.push(`${ew}: add at least one phase.`);
      } else if (ex.phases.length > LIMITS.phases) {
        errors.push(`${ew}: at most ${LIMITS.phases} phases are allowed.`);
      } else {
        const phIds = new Set();
        ex.phases.forEach((ph, j) => {
          const pw = `${ew}, phase ${j + 1}`;
          if (!isObject(ph)) {
            errors.push(`${pw}: must be an object.`);
            return;
          }
          const d = ph.durationSeconds;
          if (!Number.isInteger(d) || d < LIMITS.minSeconds || d > LIMITS.maxSeconds) {
            errors.push(`${pw}: duration must be a whole number of seconds from ${LIMITS.minSeconds} to ${LIMITS.maxSeconds}.`);
          }
          if (typeof ph.type !== 'string' || !TYPE_RE.test(ph.type)) {
            errors.push(`${pw}: type must be a short lowercase word such as "work", "rest" or "transition".`);
          }
          exOut.phases.push({
            id: id(errors, pw, ph, phIds),
            type: ph.type,
            label: text(errors, pw, ph, 'label', LIMITS.label, true),
            durationSeconds: d,
            speech: text(errors, pw, ph, 'speech', LIMITS.speech, false),
          });
        });
      }
      out.exercises.push(exOut);
    });
  }

  return errors.length ? { ok: false, errors, workout: null } : { ok: true, errors, workout: out };
}

/** Total workout seconds, derived from phases. Preparation countdown is not included. */
export function totalSeconds(workout) {
  return workout.exercises.reduce(
    (sum, ex) => sum + ex.phases.reduce((s, p) => s + (Number(p.durationSeconds) || 0), 0),
    0,
  );
}

export function phaseCount(workout) {
  return workout.exercises.reduce((n, ex) => n + ex.phases.length, 0);
}

/** Immutable, flat list of phase records for the playback engine. */
export function flattenWorkout(workout) {
  const segments = [];
  workout.exercises.forEach((ex, exerciseIndex) => {
    ex.phases.forEach((ph, phaseIndex) => {
      segments.push(
        Object.freeze({
          index: segments.length,
          exerciseIndex,
          exerciseCount: workout.exercises.length,
          exerciseId: ex.id,
          exerciseName: ex.name,
          exerciseInstructions: ex.instructions,
          phaseIndex,
          phaseCount: ex.phases.length,
          phaseId: ph.id,
          type: ph.type,
          label: ph.label,
          speech: ph.speech,
          durationMs: ph.durationSeconds * 1000,
        }),
      );
    });
  });
  return Object.freeze(segments);
}

export function formatTime(totalSec) {
  const s = Math.max(0, Math.ceil(totalSec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function formatDuration(totalSec) {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (!m) return `${s} sec`;
  return s ? `${m} min ${s} sec` : `${m} min`;
}

export function typeLabel(type) {
  return type ? type.charAt(0).toUpperCase() + type.slice(1).replace(/-/g, ' ') : '';
}

export function makeId(base) {
  const slug = String(base || 'item')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'item';
  return `${slug}-${Math.random().toString(36).slice(2, 8)}`;
}

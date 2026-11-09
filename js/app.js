// Bootstrap, hash router, library and workout detail screens.

import { h, downloadText, focusHeading } from './dom.js';
import { validateWorkout, totalSeconds, formatDuration, formatTime, typeLabel, isSafeUrl, makeId } from './workout-model.js';
import { createStore, exportJSON, parseImport, MAX_IMPORT_BYTES } from './storage.js';
import { createSpeech } from './speech.js';
import { renderEditor } from './editor-ui.js';
import { mountPlayer } from './player-ui.js';

const APP_NAME = 'Step Ladders';
const app = document.getElementById('app');

let localStore = null;
try {
  localStore = window.localStorage;
} catch {
  /* storage blocked: createStore reports it */
}
const store = createStore(localStore);
const speech = createSpeech({ onError: (e) => player?.speechFailed(e) });

let bundled = [];
let loadError = '';
let settings = store.loadSettings();
let flash = null; // one-shot message shown on the next render
let player = null;
let currentHash = location.hash;
let suppressHashChange = false;

function updateSettings(patch) {
  settings = store.saveSettings({ ...settings, ...patch });
  speech.setEnabled(settings.voice);
  speech.setRate(settings.rate);
  return settings;
}

const library = () => store.getLibrary(bundled);
const findEntry = (id) => library().find((e) => e.workout.id === id);
const go = (hash) => {
  location.hash = hash;
};

// ---------- routing ----------

function route() {
  if (suppressHashChange) {
    suppressHashChange = false;
    return;
  }
  if (player?.active) {
    if (!confirm('End the workout in progress?')) {
      suppressHashChange = true;
      location.hash = currentHash;
      return;
    }
    player.end();
  }
  player?.destroy();
  player = null;
  currentHash = location.hash;
  window.scrollTo(0, 0);

  const [, name = '', rawId = ''] = location.hash.match(/^#\/([a-z]+)\/?(.*)$/) || [];
  const id = decodeURIComponent(rawId);
  if (name === 'w') return showDetail(id);
  if (name === 'edit') return showEditor(id);
  if (name === 'new') return showEditor(null);
  if (name === 'play') return showPlayer(id, false);
  return showLibrary();
}

function render(...nodes) {
  app.replaceChildren(...nodes);
  focusHeading(app);
}

function flashNode() {
  const f = flash;
  flash = null;
  return f && h('p', { class: `flash ${f.kind || ''}`, role: f.kind === 'error' ? 'alert' : 'status' }, f.text);
}

function warnings() {
  return [store.warning, loadError].filter(Boolean).map((w) => h('p', { class: 'flash error', role: 'alert' }, w));
}

function backLink(href, label) {
  return h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, h('a', { href }, `← ${label}`));
}

function originLabel(origin) {
  return { bundled: 'Bundled example', edited: 'Edited example', local: 'Your workout' }[origin];
}

function notFound() {
  render(
    backLink('#/', 'Library'),
    h('h1', null, 'Workout not found'),
    h('p', null, 'It may have been deleted. Go back to the library to pick another.'),
  );
}

// ---------- library ----------

function showLibrary() {
  const entries = library();
  const hidden = store.hiddenCount(bundled);
  const fileInput = h('input', {
    type: 'file',
    accept: 'application/json,.json',
    class: 'visually-hidden',
    tabindex: '-1',
    'aria-hidden': 'true',
    onchange: (e) => importFile(e.target.files[0]),
  });

  render(
    h(
      'header',
      { class: 'masthead' },
      h('h1', null, APP_NAME),
      h('p', { class: 'subtitle' }, 'A calm, voice-guided timer for short workouts.'),
    ),
    ...warnings(),
    flashNode(),
    h(
      'div',
      { class: 'toolbar' },
      h('a', { class: 'button primary', href: '#/new' }, 'Create workout'),
      h('button', { type: 'button', onclick: () => fileInput.click() }, 'Import JSON'),
      entries.length > 0 &&
        h(
          'button',
          {
            type: 'button',
            onclick: () =>
              downloadText(
                `workouts-backup-${new Date().toISOString().slice(0, 10)}.json`,
                exportJSON(entries.map((e) => e.workout)),
              ),
          },
          'Export all',
        ),
      fileInput,
    ),
    h('h2', { class: 'visually-hidden' }, 'Workouts'),
    entries.length
      ? h('ul', { class: 'cards' }, entries.map(card))
      : h('p', null, 'No workouts yet. Create one or import a JSON backup.'),
    hidden > 0 &&
      h(
        'p',
        null,
        h(
          'button',
          {
            type: 'button',
            class: 'link',
            onclick: () => {
              store.restoreHidden();
              showLibrary();
            },
          },
          `Restore ${hidden} deleted example${hidden > 1 ? 's' : ''}`,
        ),
      ),
  );
}

function card({ workout: w, origin }) {
  return h(
    'li',
    { class: 'card' },
    h('h3', null, h('a', { href: `#/w/${encodeURIComponent(w.id)}` }, w.title)),
    h(
      'p',
      { class: 'meta' },
      `${formatDuration(totalSeconds(w))} · ${w.exercises.length} exercise${w.exercises.length === 1 ? '' : 's'} · ${originLabel(origin)}`,
    ),
    w.description && h('p', null, w.description),
    w.sourceUrl && isSafeUrl(w.sourceUrl) && h('p', { class: 'meta' }, sourceLink(w.sourceUrl)),
  );
}

function sourceLink(url) {
  const host = new URL(url).hostname.replace(/^www\./, '');
  return h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, `Source video on ${host} ↗`);
}

async function importFile(file) {
  if (!file) return;
  if (file.size > MAX_IMPORT_BYTES) {
    flash = { kind: 'error', text: 'Import failed: the file is too large (limit 1 MB). Nothing was changed.' };
    return showLibrary();
  }
  const result = parseImport(await file.text());
  if (!result.ok) {
    const shown = result.errors.slice(0, 8).join(' ');
    const more = result.errors.length > 8 ? ` (+${result.errors.length - 8} more)` : '';
    flash = { kind: 'error', text: `Import failed. Nothing was changed. ${shown}${more}` };
    return showLibrary();
  }
  const existing = new Map(library().map((e) => [e.workout.id, e.workout.title]));
  const clashes = result.workouts.filter((w) => existing.has(w.id));
  if (clashes.length && !confirm(`Replace ${clashes.length} existing workout(s): ${clashes.map((w) => existing.get(w.id)).join(', ')}?`)) {
    flash = { text: 'Import cancelled. Nothing was changed.' };
    return showLibrary();
  }
  try {
    store.saveWorkouts(result.workouts);
    flash = { text: `Imported ${result.workouts.length} workout(s).` };
  } catch (err) {
    flash = { kind: 'error', text: `Import failed. ${err.message}` };
  }
  showLibrary();
}

// ---------- detail ----------

function showDetail(id) {
  const entry = findEntry(id);
  if (!entry) return notFound();
  const { workout: w, origin } = entry;
  const total = totalSeconds(w);
  const prepNote = h('span', { class: 'meta' });
  const syncPrep = () => {
    prepNote.textContent = settings.prepSeconds ? ` + ${settings.prepSeconds} s get-ready countdown` : '';
  };
  syncPrep();

  render(
    backLink('#/', 'Library'),
    h('h1', null, w.title),
    h('p', { class: 'meta' }, originLabel(origin)),
    ...warnings(),
    flashNode(),
    w.description && h('p', null, w.description),
    w.notes && h('aside', { class: 'note', 'aria-label': 'Notes' }, h('strong', null, 'Notes: '), w.notes),
    w.sourceUrl && isSafeUrl(w.sourceUrl) && h('p', null, sourceLink(w.sourceUrl)),
    h('p', { class: 'total' }, `Workout time ${formatTime(total)}`, prepNote),
    h('button', { type: 'button', class: 'primary big', onclick: () => startWorkout(w.id) }, 'Start workout'),
    settingsPanel(syncPrep),
    h('h2', null, 'Exercises'),
    exerciseList(w),
    h(
      'div',
      { class: 'toolbar' },
      h('a', { class: 'button', href: `#/edit/${encodeURIComponent(w.id)}` }, 'Edit'),
      h('button', { type: 'button', onclick: () => duplicate(w) }, 'Duplicate'),
      h('button', { type: 'button', onclick: () => downloadText(`${w.id}.json`, exportJSON([w])) }, 'Export'),
      origin === 'edited' &&
        h(
          'button',
          {
            type: 'button',
            onclick: () => {
              if (!confirm('Discard your changes and restore the bundled version of this workout?')) return;
              safely(() => store.resetWorkout(w.id), 'Restored the bundled version.');
              showDetail(id);
            },
          },
          'Reset to bundled version',
        ),
      h(
        'button',
        {
          type: 'button',
          class: 'danger',
          onclick: () => {
            const msg =
              origin === 'local'
                ? `Delete “${w.title}”? This cannot be undone; export it first if you want a backup.`
                : `Remove “${w.title}” from the library? You can restore bundled examples from the library page.`;
            if (!confirm(msg)) return;
            if (safely(() => store.deleteWorkout(w.id, origin !== 'local'), 'Workout deleted.')) go('#/');
            else showDetail(id);
          },
        },
        'Delete',
      ),
    ),
  );
}

function safely(fn, okText) {
  try {
    fn();
    flash = { text: okText };
    return true;
  } catch (err) {
    flash = { kind: 'error', text: err.message };
    return false;
  }
}

function duplicate(w) {
  const copy = structuredClone(w);
  copy.id = makeId(w.title);
  copy.title = `${w.title} (copy)`.slice(0, 100);
  if (safely(() => store.saveWorkout(copy), 'Duplicated. You are viewing the copy.')) go(`#/w/${encodeURIComponent(copy.id)}`);
  else showDetail(w.id);
}

function exerciseList(w) {
  return h(
    'ol',
    { class: 'exercises' },
    w.exercises.map((ex) =>
      h(
        'li',
        null,
        h('h3', null, ex.name, h('span', { class: 'meta' }, ` · ${formatTime(ex.phases.reduce((s, p) => s + p.durationSeconds, 0))}`)),
        ex.instructions && h('p', null, ex.instructions),
        h(
          'ol',
          { class: 'phases', 'aria-label': `${ex.name} phases` },
          ex.phases.map((p) =>
            h(
              'li',
              null,
              h('span', { class: 'badge', 'data-type': p.type }, typeLabel(p.type)),
              ' ',
              h('span', null, p.label),
              h('span', { class: 'meta' }, ` · ${formatTime(p.durationSeconds)}`),
              p.speech && h('p', { class: 'speech' }, `“${p.speech}”`),
            ),
          ),
        ),
      ),
    ),
  );
}

function settingsPanel(onChange) {
  const voiceDependents = [];
  const syncVoice = () => voiceDependents.forEach((el) => (el.disabled = !settings.voice));
  const set = (patch) => {
    updateSettings(patch);
    syncVoice();
    onChange();
  };
  const check = (key, label, hint) =>
    h(
      'label',
      { class: 'check' },
      h('input', { type: 'checkbox', checked: settings[key], onchange: (e) => set({ [key]: e.target.checked }) }),
      ' ',
      label,
      hint && h('span', { class: 'meta hint' }, hint),
    );
  const rateOut = h('output', { id: 'rate-out' }, `${settings.rate.toFixed(2)}×`);
  const rate = h('input', {
    type: 'range',
    min: '0.75',
    max: '1.25',
    step: '0.05',
    value: settings.rate,
    'aria-describedby': 'rate-out',
    oninput: (e) => {
      set({ rate: Number(e.target.value) });
      rateOut.textContent = `${settings.rate.toFixed(2)}×`;
    },
  });
  const test =
    speech.supported &&
    h('button', { type: 'button', onclick: () => speech.speak('This is how cues will sound.') }, 'Test voice');
  voiceDependents.push(rate, ...(test ? [test] : []));
  syncVoice();

  return h(
    'details',
    { class: 'settings' },
    h('summary', null, 'Session settings'),
    h(
      'div',
      { class: 'settings-body' },
      !speech.supported &&
        h('p', { class: 'note' }, 'Spoken cues are not available in this browser. Workouts still run with on-screen cues.'),
      check('voice', 'Voice cues'),
      h('label', { class: 'field' }, 'Speech rate ', rateOut, rate),
      check('warning', '“Next up” warning', ' 5 seconds before a change (phases of 10 s or more)'),
      check('countdown', '3-2-1 countdown', ' at the end of each phase'),
      h(
        'label',
        { class: 'field' },
        'Get-ready countdown ',
        h(
          'select',
          { onchange: (e) => set({ prepSeconds: Number(e.target.value) }) },
          [0, 3, 5, 10].map((n) => h('option', { value: n, selected: settings.prepSeconds === n }, n ? `${n} seconds` : 'None')),
        ),
      ),
      check(
        'wakeLock',
        'Keep screen awake while playing',
        'wakeLock' in navigator ? null : ' — not supported here; lengthen your screen auto-lock instead',
      ),
      test,
    ),
  );
}

// ---------- editor ----------

function showEditor(id) {
  let draft;
  if (id) {
    const entry = findEntry(id);
    if (!entry) return notFound();
    draft = structuredClone(entry.workout);
  } else {
    draft = {
      schemaVersion: 1,
      id: makeId('workout'),
      title: '',
      description: '',
      sourceUrl: '',
      notes: '',
      exercises: [
        {
          id: makeId('exercise'),
          name: '',
          instructions: '',
          phases: [{ id: makeId('phase'), type: 'work', label: '', durationSeconds: 30, speech: '' }],
        },
      ],
    };
  }
  const detailHash = id ? `#/w/${encodeURIComponent(id)}` : '#/';
  render(
    backLink(detailHash, id ? 'Workout' : 'Library'),
    ...warnings(),
    renderEditor({
      draft,
      isNew: !id,
      onSave(workout) {
        const saved = store.saveWorkout(workout); // throws with a readable message on failure
        flash = { text: 'Saved.' };
        go(`#/w/${encodeURIComponent(saved.id)}`);
      },
      onCancel() {
        go(detailHash);
      },
    }),
  );
}

// ---------- player ----------

function showPlayer(id, autoStart) {
  const entry = findEntry(id);
  if (!entry) return notFound();
  if (!validateWorkout(entry.workout).ok) return notFound();
  updateSettings({});
  app.replaceChildren();
  player = mountPlayer(app, {
    workout: entry.workout,
    settings,
    speech,
    autoStart,
    onVoiceToggle: (on) => updateSettings({ voice: on }),
    onExit: (where) => go(where === 'library' ? '#/' : `#/w/${encodeURIComponent(id)}`),
  });
}

// Called from the Start click so speech is initialised inside a user gesture.
function startWorkout(id) {
  history.pushState(null, '', `#/play/${encodeURIComponent(id)}`);
  currentHash = location.hash;
  showPlayer(id, true);
}

window.addEventListener('beforeunload', (e) => {
  if (player?.active) e.preventDefault();
});

async function init() {
  try {
    const res = await fetch('data/workouts.json');
    if (!res.ok) throw new Error(res.statusText);
    const data = await res.json();
    bundled = data.filter((w) => validateWorkout(w).ok);
    if (bundled.length !== data.length) loadError = 'Some bundled examples were invalid and were skipped.';
  } catch {
    loadError = 'Bundled example workouts could not be loaded. Your own workouts are still available.';
  }
  window.addEventListener('hashchange', route);
  route();
}

init();

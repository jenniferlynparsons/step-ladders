import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createStore, exportJSON, parseImport, LIBRARY_KEY, DEFAULT_SETTINGS } from '../js/storage.js';

const bundled = JSON.parse(readFileSync(new URL('../data/workouts.json', import.meta.url)));

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    map,
  };
}

const userWorkout = () => ({
  ...structuredClone(bundled[1]),
  id: 'mine',
  title: 'Mine',
});

test('edits persist across reload and override bundled until reset', () => {
  const mem = memoryStorage();
  const edited = structuredClone(bundled[0]);
  edited.title = 'Edited title';
  createStore(mem).saveWorkout(edited);
  createStore(mem).saveWorkout(userWorkout());

  const reloaded = createStore(mem); // simulate a page reload
  const lib = reloaded.getLibrary(bundled);
  assert.equal(lib[0].workout.title, 'Edited title');
  assert.equal(lib[0].origin, 'edited');
  assert.equal(lib.find((e) => e.workout.id === 'mine').origin, 'local');

  reloaded.resetWorkout(bundled[0].id);
  assert.equal(reloaded.getLibrary(bundled)[0].workout.title, bundled[0].title);
  assert.equal(reloaded.getLibrary(bundled)[0].origin, 'bundled');
});

test('a changed bundled file does not replace local edits', () => {
  const mem = memoryStorage();
  const edited = structuredClone(bundled[0]);
  edited.title = 'Mine now';
  createStore(mem).saveWorkout(edited);
  const newDeploy = structuredClone(bundled);
  newDeploy[0].title = 'Updated upstream';
  assert.equal(createStore(mem).getLibrary(newDeploy)[0].workout.title, 'Mine now');
});

test('deleting a bundled workout hides it until restored', () => {
  const store = createStore(memoryStorage());
  store.deleteWorkout(bundled[0].id, true);
  assert.equal(store.getLibrary(bundled).length, bundled.length - 1);
  assert.equal(store.hiddenCount(bundled), 1);
  store.restoreHidden();
  assert.equal(store.getLibrary(bundled).length, bundled.length);
});

test('saving an invalid workout throws and leaves storage unchanged', () => {
  const mem = memoryStorage();
  const store = createStore(mem);
  store.saveWorkout(userWorkout());
  const before = mem.getItem(LIBRARY_KEY);
  const bad = userWorkout();
  bad.exercises[0].phases[0].durationSeconds = -1;
  assert.throws(() => store.saveWorkout(bad), /duration/);
  assert.equal(mem.getItem(LIBRARY_KEY), before);
});

test('export round-trips through import', () => {
  const mem = memoryStorage();
  const store = createStore(mem);
  store.saveWorkout(userWorkout());
  const all = store.getLibrary(bundled).map((e) => e.workout);
  const parsed = parseImport(exportJSON(all));
  assert.ok(parsed.ok, parsed.errors.join('\n'));
  assert.deepEqual(parsed.workouts, all);

  const fresh = createStore(memoryStorage());
  parsed.workouts.forEach((w) => fresh.saveWorkout(w));
  assert.deepEqual(
    fresh.getLibrary(bundled).map((e) => e.workout),
    all,
  );
});

test('import accepts a bare workout or an array', () => {
  assert.ok(parseImport(JSON.stringify(bundled[0])).ok);
  assert.equal(parseImport(JSON.stringify(bundled)).workouts.length, bundled.length);
});

test('import rejects malformed input with friendly errors', () => {
  const cases = [
    ['', /empty/],
    ['{not json', /not valid JSON/],
    ['[]', /No workouts/],
    ['"text"', /No workouts/],
    [JSON.stringify({ format: 'workout-guide-export', exportVersion: 9, workouts: [] }), /Unsupported export version/],
    [JSON.stringify({ ...bundled[0], schemaVersion: 7 }), /Unsupported schema version 7/],
    [JSON.stringify([bundled[0], bundled[0]]), /appears more than once/],
    [JSON.stringify({ ...bundled[0], sourceUrl: 'javascript:alert(1)' }), /source URL/],
    ['x'.repeat(1_000_001), /too large/],
  ];
  for (const [input, re] of cases) {
    const r = parseImport(input);
    assert.equal(r.ok, false, input.slice(0, 40));
    assert.match(r.errors.join('\n'), re);
  }
});

test('one invalid workout rejects the whole import', () => {
  const bad = structuredClone(bundled[1]);
  bad.exercises[0].phases[0].durationSeconds = 0;
  const r = parseImport(JSON.stringify([bundled[0], bad]));
  assert.equal(r.ok, false);
  assert.equal(r.workouts.length, 0);
});

test('unknown stored format is left untouched and saving is refused', () => {
  const raw = JSON.stringify({ version: 99, workouts: { x: 1 } });
  const mem = memoryStorage({ [LIBRARY_KEY]: raw });
  const store = createStore(mem);
  assert.equal(store.getLibrary(bundled).length, bundled.length);
  assert.match(store.warning, /unknown format/);
  assert.throws(() => store.saveWorkout(userWorkout()));
  assert.equal(mem.getItem(LIBRARY_KEY), raw);
});

test('corrupt stored JSON is left untouched', () => {
  const mem = memoryStorage({ [LIBRARY_KEY]: '{oops' });
  const store = createStore(mem);
  store.getLibrary(bundled);
  assert.match(store.warning, /could not be read/);
  assert.throws(() => store.deleteWorkout('x'));
  assert.equal(mem.getItem(LIBRARY_KEY), '{oops');
});

test('storage write failures surface as errors', () => {
  const mem = memoryStorage();
  mem.setItem = () => {
    throw new Error('QuotaExceededError');
  };
  assert.throws(() => createStore(mem).saveWorkout(userWorkout()), /Could not save/);
});

test('settings persist, with defaults and clamping', () => {
  const mem = memoryStorage();
  const store = createStore(mem);
  assert.deepEqual(store.loadSettings(), DEFAULT_SETTINGS);
  store.saveSettings({ ...DEFAULT_SETTINGS, voice: false, rate: 5, prepSeconds: 99 });
  assert.deepEqual(createStore(mem).loadSettings(), { ...DEFAULT_SETTINGS, voice: false, rate: 1.25, prepSeconds: 10 });
  mem.setItem('workoutGuide.settings', 'garbage');
  assert.deepEqual(createStore(mem).loadSettings(), DEFAULT_SETTINGS);
});

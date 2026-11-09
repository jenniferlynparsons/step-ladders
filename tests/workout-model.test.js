import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateWorkout, totalSeconds, formatTime, isSafeUrl, flattenWorkout } from '../js/workout-model.js';

const bundled = JSON.parse(readFileSync(new URL('../data/workouts.json', import.meta.url)));
const valid = () => structuredClone(bundled[0]);
const errorsOf = (w) => validateWorkout(w).errors.join('\n');

test('bundled workouts are valid and unique', () => {
  const ids = new Set();
  for (const w of bundled) {
    const r = validateWorkout(w);
    assert.ok(r.ok, r.errors.join('\n'));
    assert.ok(!ids.has(w.id));
    ids.add(w.id);
    assert.match(w.title, /Example/, 'bundled samples must be labeled as examples');
  }
});

test('example has multiple exercises and a multi-phase exercise', () => {
  const w = bundled[0];
  assert.ok(w.exercises.length > 1);
  assert.ok(w.exercises.some((e) => e.phases.length > 1));
});

test('rejects unsupported schema version', () => {
  const w = valid();
  w.schemaVersion = 2;
  assert.match(errorsOf(w), /Unsupported schema version 2/);
  delete w.schemaVersion;
  assert.match(errorsOf(w), /Unsupported schema version missing/);
});

test('rejects duplicate ids within scope, allows reuse across scopes', () => {
  const w = valid();
  w.exercises[1].id = w.exercises[0].id;
  assert.match(errorsOf(w), /used more than once/);

  const w2 = valid();
  w2.exercises[1].phases[1].id = w2.exercises[1].phases[0].id;
  assert.match(errorsOf(w2), /used more than once/);

  const w3 = valid();
  w3.exercises[1].phases[2].id = 'rest';
  w3.exercises[2].phases[3].id = 'rest';
  assert.ok(validateWorkout(w3).ok);
});

test('rejects bad durations', () => {
  for (const d of [-5, 0, 1.5, 3601, '30', NaN, Infinity, null]) {
    const w = valid();
    w.exercises[0].phases[0].durationSeconds = d;
    assert.match(errorsOf(w), /duration must be a whole number/, String(d));
  }
});

test('rejects empty structures and missing text', () => {
  const w = valid();
  w.exercises = [];
  assert.match(errorsOf(w), /at least one exercise/);
  const w2 = valid();
  w2.exercises[0].phases = [];
  assert.match(errorsOf(w2), /at least one phase/);
  const w3 = valid();
  w3.title = '   ';
  assert.match(errorsOf(w3), /title is required/);
  const w4 = valid();
  w4.exercises[0].phases[0].label = '';
  assert.match(errorsOf(w4), /label is required/);
  assert.match(errorsOf(null), /JSON object/);
  assert.match(errorsOf([]), /JSON object/);
});

test('rejects unsafe URLs and long text', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,hi', 'ftp://x', 'not a url']) {
    const w = valid();
    w.sourceUrl = url;
    assert.match(errorsOf(w), /source URL/, url);
  }
  assert.ok(isSafeUrl('https://example.com/a?b=c'));
  const w = valid();
  w.description = 'x'.repeat(501);
  assert.match(errorsOf(w), /at most 500/);
});

test('rejects malformed phase types but accepts new categories', () => {
  const w = valid();
  w.exercises[0].phases[0].type = '<b>work</b>';
  assert.match(errorsOf(w), /type must be/);
  const w2 = valid();
  w2.exercises[0].phases[0].type = 'cool-down';
  assert.ok(validateWorkout(w2).ok);
});

test('normalizes: trims text and strips unknown fields', () => {
  const w = valid();
  w.title = '  Hi  ';
  w.extra = '<script>';
  w.exercises[0].phases[0].junk = 1;
  const r = validateWorkout(w);
  assert.equal(r.workout.title, 'Hi');
  assert.equal('extra' in r.workout, false);
  assert.equal('junk' in r.workout.exercises[0].phases[0], false);
});

test('duration helpers', () => {
  assert.equal(totalSeconds(bundled[1]), 40);
  assert.equal(flattenWorkout(bundled[1]).length, 5);
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(9.2), '0:10');
  assert.equal(formatTime(75), '1:15');
  assert.equal(formatTime(3600), '60:00');
});

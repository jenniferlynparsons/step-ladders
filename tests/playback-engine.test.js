import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPlayback } from '../js/playback-engine.js';
import { flattenWorkout, totalSeconds } from '../js/workout-model.js';

const bundled = JSON.parse(readFileSync(new URL('../data/workouts.json', import.meta.url)));

// Two exercises; the second has three phases. Total 20 + 10 + 10 + 15 = 55 s.
const workout = {
  schemaVersion: 1,
  id: 'w',
  title: 'T',
  exercises: [
    { id: 'a', name: 'A', phases: [{ id: 'a1', type: 'work', label: 'A1', durationSeconds: 20, speech: 'a one' }] },
    {
      id: 'b',
      name: 'B',
      phases: [
        { id: 'b1', type: 'work', label: 'B1', durationSeconds: 10, speech: 'b one' },
        { id: 'b2', type: 'work', label: 'B2', durationSeconds: 10, speech: 'b two' },
        { id: 'b3', type: 'rest', label: 'Rest', durationSeconds: 15, speech: 'rest' },
      ],
    },
  ],
};

function setup(prepMs = 3000, w = workout) {
  const clock = { t: 1000 };
  const events = [];
  const p = createPlayback({ segments: flattenWorkout(w), prepMs, now: () => clock.t, onEvent: (e) => events.push(e) });
  const advance = (ms) => {
    clock.t += ms;
    return p.tick();
  };
  const types = (type) => events.filter((e) => e.type === type);
  return { p, clock, events, advance, types };
}

test('total equals sum of phases; prep is separate', () => {
  assert.equal(totalSeconds(workout), 55);
  const { p, advance } = setup(3000);
  p.start();
  assert.equal(p.getState().status, 'preparing');
  assert.equal(advance(2999).status, 'preparing');
  const s = advance(1);
  assert.equal(s.status, 'running');
  assert.equal(s.index, 0);
  assert.equal(s.remainingMs, 20000);
  // Workout completes exactly 55 s after the first phase starts.
  assert.equal(advance(54999).status, 'running');
  assert.equal(advance(1).status, 'completed');
});

test('zero prep starts the first phase immediately', () => {
  const { p, types } = setup(0);
  p.start();
  assert.equal(p.getState().status, 'running');
  assert.equal(types('prepare').length, 0);
  assert.equal(types('phase').length, 1);
});

test('pause preserves remaining ms; paused time does not count', () => {
  const { p, advance, clock } = setup(0);
  p.start();
  advance(4321);
  p.pause();
  assert.equal(p.getState().remainingMs, 15679);
  clock.t += 60000;
  assert.equal(p.tick().remainingMs, 15679);
  assert.equal(p.getState().status, 'paused');
  p.resume();
  assert.equal(p.getState().remainingMs, 15679);
});

test('repeated pause/resume introduces no drift', () => {
  const { p, advance, clock } = setup(0);
  p.start();
  for (let i = 0; i < 50; i++) {
    advance(333);
    p.pause();
    clock.t += 777;
    p.resume();
  }
  // 50 * 333 = 16650 ms of running time has elapsed.
  assert.equal(p.getState().remainingMs, 20000 - 16650);
  assert.equal(advance(55000 - 16650 - 1).status, 'running');
  assert.equal(advance(1).status, 'completed');
});

test('late tick skips expired phases and lands deterministically', () => {
  const { p, advance, types } = setup(0);
  p.start();
  // 20 + 10 + 10 = 40 s; 41.5 s in is 1.5 s into the rest phase.
  const s = advance(41500);
  assert.equal(s.index, 3);
  assert.equal(s.remainingMs, 13500);
  const phases = types('phase');
  assert.equal(phases.length, 2, 'initial phase + only the landing phase');
  assert.equal(phases[1].index, 3);
  assert.equal(phases[1].caughtUp, true);
  assert.equal(phases[1].skipped, 2);
  // No backlog of warnings/countdowns from skipped phases.
  assert.equal(types('warning').length, 0);
  assert.equal(types('count').length, 0);
});

test('a late tick past the end completes once', () => {
  const { p, advance, types } = setup(3000);
  p.start();
  advance(999999);
  advance(1000);
  assert.equal(p.getState().status, 'completed');
  assert.equal(types('complete').length, 1);
  assert.equal(types('phase').length, 0, 'no phases replayed');
});

test('transition events fire once regardless of tick frequency', () => {
  const { p, advance, types } = setup(0);
  p.start();
  for (let i = 0; i < 55000 / 16; i++) advance(16);
  for (let i = 0; i < 20; i++) p.tick();
  assert.deepEqual(
    types('phase').map((e) => e.index),
    [0, 1, 2, 3],
  );
  assert.equal(types('complete').length, 1);
  // Warning only for phases >= 10 s that have a next phase.
  assert.deepEqual(
    types('warning').map((e) => e.index),
    [0, 1, 2],
  );
  assert.equal(types('warning')[0].next.label, 'B1');
  // 3-2-1 for every phase longer than 3 s.
  assert.deepEqual(
    types('count').map((e) => e.n),
    [3, 2, 1, 3, 2, 1, 3, 2, 1, 3, 2, 1],
  );
});

test('countdown after a late tick only says the current number', () => {
  const { p, advance, types } = setup(0);
  p.start();
  advance(17500); // 2.5 s left: neither 3 nor the warning fired yet
  assert.deepEqual(
    types('count').map((e) => e.n),
    [3],
  );
  advance(1500); // 1 s left, skipping the "2" window
  assert.deepEqual(
    types('count').map((e) => e.n),
    [3, 1],
  );
});

test('next at first, middle, last phases', () => {
  const { p, types } = setup(3000);
  p.start();
  p.next(); // from prep
  assert.equal(p.getState().index, 0);
  p.next();
  p.next();
  assert.equal(p.getState().index, 2);
  assert.equal(p.getState().remainingMs, 10000);
  p.next();
  assert.equal(p.getState().index, 3);
  p.next();
  assert.equal(p.getState().status, 'completed');
  assert.equal(types('complete').length, 1);
  p.next();
  assert.equal(types('complete').length, 1);
});

test('back restarts after 3 s, otherwise goes to previous; first phase restarts', () => {
  const { p, advance } = setup(0);
  p.start();
  advance(1000);
  p.back(); // first phase: restart
  assert.equal(p.getState().index, 0);
  assert.equal(p.getState().remainingMs, 20000);
  p.next();
  p.next(); // index 2
  advance(3500);
  p.back(); // > 3 s elapsed: restart current
  assert.equal(p.getState().index, 2);
  assert.equal(p.getState().remainingMs, 10000);
  advance(1000);
  p.back(); // < 3 s: previous
  assert.equal(p.getState().index, 1);
  p.next();
  p.next();
  p.back(); // last phase, 0 s elapsed: previous
  assert.equal(p.getState().index, 2);
});

test('skipping while paused stays paused and marks the event as paused', () => {
  const { p, advance, events, clock } = setup(0);
  p.start();
  advance(5000);
  p.pause();
  p.next();
  const last = events.at(-1);
  assert.equal(last.type, 'phase');
  assert.equal(last.paused, true);
  assert.equal(p.getState().status, 'paused');
  assert.equal(p.getState().index, 1);
  clock.t += 9999;
  assert.equal(p.getState().remainingMs, 10000);
  p.resume();
  assert.equal(p.getState().status, 'running');
  assert.equal(advance(10000).index, 2);
});

test('completion stops the countdown and ignores further control calls', () => {
  const { p, advance, types } = setup(0);
  p.start();
  advance(55000);
  assert.equal(p.getState().status, 'completed');
  assert.equal(p.getState().remainingMs, 0);
  const before = types('phase').length;
  p.pause();
  p.resume();
  p.back();
  advance(10000);
  assert.equal(p.getState().status, 'completed');
  assert.equal(types('phase').length, before);
  assert.equal(types('complete').length, 1);
});

test('end returns to idle once and stops ticking', () => {
  const { p, advance, types } = setup(0);
  p.start();
  p.end();
  p.end();
  assert.equal(types('end').length, 1);
  assert.equal(advance(60000).status, 'idle');
  assert.equal(types('complete').length, 0);
});

test('pausing during prep and resuming continues the countdown', () => {
  const { p, advance, clock } = setup(3000);
  p.start();
  advance(1000);
  p.pause();
  clock.t += 5000;
  p.resume();
  assert.equal(p.getState().status, 'preparing');
  assert.equal(advance(2000).status, 'running');
});

test('session uses a snapshot: editing the workout does not affect playback', () => {
  const w = structuredClone(workout);
  const segments = flattenWorkout(w);
  w.exercises[0].phases[0].durationSeconds = 999;
  w.exercises.pop();
  assert.equal(segments.length, 4);
  assert.equal(segments[0].durationMs, 20000);
  assert.throws(() => {
    'use strict';
    segments[0].durationMs = 1;
  });
});

test('rejects empty segment lists', () => {
  assert.throws(() => createPlayback({ segments: [], now: () => 0 }));
});

test('multi-phase exercise announces each phase change with exercise context', () => {
  const { p, advance, types } = setup(0);
  p.start();
  for (let i = 0; i < 55000 / 250; i++) advance(250);
  const b = types('phase').filter((e) => e.segment.exerciseId === 'b');
  assert.deepEqual(
    b.map((e) => [e.segment.phaseIndex, e.segment.phaseCount, e.segment.label]),
    [
      [0, 3, 'B1'],
      [1, 3, 'B2'],
      [2, 3, 'Rest'],
    ],
  );
});

test('bundled example workout plays start to finish without intervention', () => {
  const w = bundled[0];
  const { p, advance, types } = setup(3000, w);
  p.start();
  let guard = 0;
  while (p.getState().status !== 'completed' && guard++ < 10000) advance(250);
  assert.equal(types('phase').length, flattenWorkout(w).length);
  assert.equal(types('complete').length, 1);
});

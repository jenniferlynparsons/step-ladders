import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSpeech, PRIORITY } from '../js/speech.js';

function mockSynth() {
  const synth = {
    spoken: [],
    cancels: 0,
    speaking: false,
    current: null,
    speak(u) {
      this.spoken.push(u.text);
      this.speaking = true;
      this.current = u;
    },
    cancel() {
      this.cancels += 1;
      if (this.current) {
        const u = this.current;
        this.current = null;
        this.speaking = false;
        u.onerror?.({ error: 'interrupted' });
      }
    },
    finish() {
      const u = this.current;
      this.current = null;
      this.speaking = false;
      u?.onend?.();
    },
  };
  class Utterance {
    constructor(text) {
      this.text = text;
    }
  }
  return { synth, Utterance };
}

test('unsupported browser: speak is a harmless no-op', () => {
  const s = createSpeech({ synth: undefined, Utterance: undefined });
  assert.equal(s.supported, false);
  assert.equal(s.speak('hi'), false);
  s.cancel();
  s.setEnabled(false);
});

test('disabled voice does not speak; muting cancels current speech', () => {
  const { synth, Utterance } = mockSynth();
  const s = createSpeech({ synth, Utterance });
  s.speak('long instruction');
  assert.equal(synth.speaking, true);
  s.setEnabled(false);
  assert.equal(synth.speaking, false);
  assert.equal(s.speak('nope'), false);
  assert.deepEqual(synth.spoken, ['long instruction']);
});

test('lower priority cue is dropped while a higher priority one is speaking', () => {
  const { synth, Utterance } = mockSynth();
  const s = createSpeech({ synth, Utterance });
  s.speak('Next up: B', PRIORITY.warning);
  assert.equal(s.speak('3', PRIORITY.countdown), false);
  assert.deepEqual(synth.spoken, ['Next up: B']);
  synth.finish();
  assert.equal(s.speak('2', PRIORITY.countdown), true);
});

test('equal or higher priority interrupts: voices never stack', () => {
  const { synth, Utterance } = mockSynth();
  const s = createSpeech({ synth, Utterance });
  s.speak('3', PRIORITY.countdown);
  s.speak('2', PRIORITY.countdown);
  s.speak('New phase', PRIORITY.intro);
  assert.deepEqual(synth.spoken, ['3', '2', 'New phase']);
  assert.ok(synth.cancels >= 3);
  assert.equal(synth.current.text, 'New phase');
});

test('stale state after a missed onend does not block new cues', () => {
  const { synth, Utterance } = mockSynth();
  const s = createSpeech({ synth, Utterance });
  s.speak('intro', PRIORITY.intro);
  synth.speaking = false; // browser finished but never fired onend
  assert.equal(s.speak('2', PRIORITY.countdown), true);
});

test('errors are reported but interruptions are not; speak exceptions are contained', () => {
  const { synth, Utterance } = mockSynth();
  const errors = [];
  const s = createSpeech({ synth, Utterance, onError: (e) => errors.push(e) });
  s.speak('a');
  s.speak('b'); // interrupts a
  synth.current.onerror({ error: 'synthesis-failed' });
  assert.deepEqual(errors, ['synthesis-failed']);
  synth.speak = () => {
    throw new Error('boom');
  };
  assert.equal(s.speak('c'), false);
  assert.deepEqual(errors, ['synthesis-failed', 'boom']);
});

test('rate is applied and clamped', () => {
  const { synth, Utterance } = mockSynth();
  const s = createSpeech({ synth, Utterance });
  s.setRate(3);
  s.speak('x');
  assert.equal(synth.current.rate, 1.25);
  s.setRate(0.8);
  s.speak('y');
  assert.equal(synth.current.rate, 0.8);
});

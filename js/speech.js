// Best-effort speech adapter. Never blocks the timer.
// Priorities: 3 = phase introduction / repeat, 2 = next-up warning, 1 = countdown.
// A new utterance interrupts the current one unless the current one has higher priority.

export const PRIORITY = { intro: 3, warning: 2, countdown: 1 };

export function createSpeech({
  synth = globalThis.speechSynthesis,
  Utterance = globalThis.SpeechSynthesisUtterance,
  lang = 'en',
  onError = () => {},
} = {}) {
  const supported = Boolean(synth && typeof synth.speak === 'function' && Utterance);
  let enabled = true;
  let rate = 1;
  let current = null;

  function cancel() {
    current = null;
    if (!supported) return;
    try {
      synth.cancel();
    } catch {
      /* ignore: cancel is best effort */
    }
  }

  function speak(text, priority = PRIORITY.intro) {
    if (!supported || !enabled || !text) return false;
    // `speaking` guards against browsers that never fire onend.
    if (current && synth.speaking && current.priority > priority) return false;
    cancel();
    const entry = { priority };
    current = entry;
    try {
      const u = new Utterance(text);
      u.rate = rate;
      u.lang = lang;
      u.onend = () => {
        if (current === entry) current = null;
      };
      u.onerror = (e) => {
        if (current === entry) current = null;
        // cancel() routinely produces "interrupted"/"canceled"; those are not failures.
        if (e && e.error && e.error !== 'interrupted' && e.error !== 'canceled') onError(e.error);
      };
      synth.speak(u);
      return true;
    } catch (err) {
      current = null;
      onError(err?.message || 'speak failed');
      return false;
    }
  }

  return {
    supported,
    speak,
    cancel,
    setEnabled(on) {
      enabled = Boolean(on);
      if (!enabled) cancel();
    },
    setRate(r) {
      rate = Math.min(1.25, Math.max(0.75, Number(r) || 1));
    },
    get enabled() {
      return enabled;
    },
  };
}

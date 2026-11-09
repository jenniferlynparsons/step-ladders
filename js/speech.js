// Best-effort speech adapter. Never blocks the timer.
// Priorities: 3 = phase introduction / repeat, 2 = next-up warning, 1 = countdown.
// A new utterance interrupts the current one unless the current one has higher priority.

export const PRIORITY = { intro: 3, warning: 2, countdown: 1 };

// Apple's novelty voices: listed by Safari, useless for coaching.
const NOVELTY =
  /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox)\b/i;

// iOS/macOS put the quality tier in voiceURI, e.g. com.apple.voice.premium.en-US.Ava.
function quality(v) {
  const id = `${v.voiceURI} ${v.name}`;
  return /premium/i.test(id) ? 2 : /enhanced/i.test(id) ? 1 : 0;
}

/** English (or `lang`) voices, best first: Premium, Enhanced, on-device, then by name. */
export function listVoices(all, lang = 'en') {
  return all
    .filter((v) => v.lang?.toLowerCase().startsWith(lang) && !NOVELTY.test(v.name))
    .sort((a, b) => quality(b) - quality(a) || Number(b.localService) - Number(a.localService) || a.name.localeCompare(b.name))
    .map((v) => {
      const tier = ['', ' (Enhanced)', ' (Premium)'][quality(v)];
      const label = `${v.name}${/premium|enhanced/i.test(v.name) ? '' : tier} · ${v.lang}${v.localService === false ? ' · online' : ''}`;
      return { id: v.voiceURI, label };
    });
}

export function createSpeech({
  synth = globalThis.speechSynthesis,
  Utterance = globalThis.SpeechSynthesisUtterance,
  lang = 'en',
  onError = () => {},
} = {}) {
  const supported = Boolean(synth && typeof synth.speak === 'function' && Utterance);
  let enabled = true;
  let rate = 1;
  let voiceId = '';
  let current = null;
  let voicesChanged = null;
  // Chrome fills getVoices() asynchronously; Safari usually has it at once.
  if (supported) synth.addEventListener?.('voiceschanged', () => voicesChanged?.());

  const allVoices = () => {
    try {
      return synth.getVoices?.() || [];
    } catch {
      return [];
    }
  };

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
      // A saved voice that is no longer installed quietly falls back to the system default.
      const voice = voiceId && allVoices().find((v) => v.voiceURI === voiceId);
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      }
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
    setVoice(id) {
      voiceId = typeof id === 'string' ? id : '';
    },
    voices: () => (supported ? listVoices(allVoices(), lang) : []),
    /** Single slot: the settings panel currently on screen. */
    set onVoicesChanged(cb) {
      voicesChanged = cb;
    },
    get enabled() {
      return enabled;
    },
  };
}

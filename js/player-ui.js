// Player screen: wires the playback engine to the DOM, speech and wake lock.
// Background policy: when the page becomes hidden the session auto-pauses (see README).

import { h, announce, focusHeading } from './dom.js';
import { createPlayback } from './playback-engine.js';
import { flattenWorkout, totalSeconds, formatTime, typeLabel } from './workout-model.js';
import { PRIORITY } from './speech.js';

const TICK_MS = 200; // UI refresh only; the engine's clock is the source of truth

export function mountPlayer(container, { workout, settings, speech, autoStart, onVoiceToggle, onExit }) {
  // Snapshot: later library edits cannot affect this session.
  const snapshot = structuredClone(workout);
  const segments = flattenWorkout(snapshot);
  let engine = null;
  let timer = null;
  let announcedIndex = null;
  let sessionStart = 0;
  let notice = '';
  let wakeLock = null;

  const el = {
    pos: h('span'),
    badge: h('p', { class: 'badge big-badge' }),
    title: h('h1', { class: 'player-title' }),
    sub: h('p', { class: 'player-sub' }),
    time: h('p', { class: 'time', role: 'timer', 'aria-label': 'Time remaining' }),
    bar: h('div', { class: 'bar-fill' }),
    instruction: h('p', { class: 'instruction' }),
    next: h('p', { class: 'next' }),
    notice: h('p', { class: 'notice', role: 'status' }),
    back: h('button', { type: 'button', class: 'control', onclick: () => engine?.back(), 'aria-label': 'Previous phase' }, '⏮ Back'),
    primary: h('button', { type: 'button', class: 'control primary', onclick: togglePrimary }),
    nextBtn: h('button', { type: 'button', class: 'control', onclick: () => engine?.next(), 'aria-label': 'Next phase' }, 'Next ⏭'),
    repeat: h('button', { type: 'button', onclick: repeatInstruction }, 'Repeat instruction'),
    voice: h('button', { type: 'button', onclick: toggleVoice }),
    end: h('button', { type: 'button', class: 'quiet', onclick: confirmEnd }, 'End workout'),
  };
  const bar = h('div', { class: 'bar', 'aria-hidden': 'true' }, el.bar);

  const playerView = h(
    'section',
    { class: 'player', 'aria-label': 'Workout player' },
    // Two groups so landscape can sit them side by side; portrait reorders them into one column via CSS.
    h('div', { class: 'player-info' }, h('p', { class: 'player-workout' }, snapshot.title, ' · ', el.pos), el.badge, el.title, el.sub, el.instruction, el.next),
    h(
      'div',
      { class: 'player-clock' },
      el.time,
      bar,
      el.notice,
      h('div', { class: 'controls', role: 'group', 'aria-label': 'Playback' }, el.back, el.primary, el.nextBtn),
      h('div', { class: 'controls-secondary' }, el.repeat, el.voice, el.end),
      h('p', { class: 'meta keys' }, 'Keys: Space pause/resume · ← → previous/next · R repeat · M voice'),
    ),
  );

  // ---------- speech ----------

  const introText = (seg) => {
    const what = seg.speech || seg.label;
    return seg.phaseIndex === 0 ? `${seg.exerciseName}. ${what}` : what;
  };

  function announcePhase(seg) {
    announcedIndex = seg.index;
    speech.speak(introText(seg), PRIORITY.intro);
    announce(`${typeLabel(seg.type)}: ${seg.exerciseName}, ${seg.label}. ${formatTime(seg.durationMs / 1000)}.`);
  }

  function onEvent(e) {
    switch (e.type) {
      case 'prepare':
        if (!e.paused) {
          speech.speak(`Get ready. First up: ${segments[0].exerciseName}.`, PRIORITY.intro);
          announce(`Get ready. First up: ${segments[0].exerciseName}.`);
        }
        break;
      case 'phase':
        if (e.paused) break; // announced on resume instead
        notice = e.caughtUp ? `Skipped ahead ${e.skipped} phase(s) to stay on schedule.` : '';
        announcePhase(e.segment);
        break;
      case 'warning':
        if (settings.warning && e.next) {
          const n = e.next;
          speech.speak(`Next up: ${n.phaseIndex === 0 ? n.exerciseName : n.label}.`, PRIORITY.warning);
        }
        break;
      case 'count':
        if (settings.countdown) speech.speak(String(e.n), PRIORITY.countdown);
        break;
      case 'pause':
        speech.cancel();
        releaseWakeLock(); // the status line already says "Paused."
        break;
      case 'resume':
        notice = '';
        if (e.index >= 0 && announcedIndex !== e.index) announcePhase(e.segment);
        else speech.speak('Resuming.', PRIORITY.intro);
        requestWakeLock();
        break;
      case 'complete':
        speech.cancel();
        speech.speak('Workout complete.', PRIORITY.intro);
        stopLoop();
        releaseWakeLock();
        showComplete();
        return;
      case 'end':
        speech.cancel();
        stopLoop();
        releaseWakeLock();
        return;
    }
    update();
  }

  // ---------- controls ----------

  function startSession() {
    speech.setEnabled(settings.voice);
    speech.setRate(settings.rate);
    engine = createPlayback({
      segments,
      prepMs: settings.prepSeconds * 1000,
      now: () => performance.now(),
      onEvent,
    });
    announcedIndex = null;
    notice = '';
    container.replaceChildren(playerView);
    sessionStart = performance.now();
    engine.start(); // runs inside the user's click, which unlocks speech on mobile browsers
    requestWakeLock();
    startLoop();
    update();
    el.primary.focus();
  }

  function togglePrimary() {
    const s = engine?.getState().status;
    if (!engine || s === 'idle') startSession();
    else if (s === 'paused') engine.resume();
    else engine.pause();
  }

  function repeatInstruction() {
    const seg = engine?.getState().segment;
    if (seg) {
      speech.cancel();
      announcePhase(seg);
    }
  }

  function toggleVoice() {
    settings.voice = !settings.voice;
    speech.setEnabled(settings.voice); // cancels immediately when muting
    onVoiceToggle(settings.voice);
    update();
  }

  function confirmEnd() {
    if (!confirm('End this workout? Your progress in this session will be lost.')) return;
    engine.end();
    onExit('detail');
  }

  function onKey(e) {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target.closest('input, textarea, select')) return;
    const s = engine?.getState().status;
    if (!s || s === 'completed') return;
    const key = e.key.toLowerCase();
    if (key === ' ' && e.target.tagName !== 'BUTTON') togglePrimary();
    else if (s === 'idle') return;
    else if (key === 'arrowright') engine.next();
    else if (key === 'arrowleft') engine.back();
    else if (key === 'r') repeatInstruction();
    else if (key === 'm') toggleVoice();
    else return;
    e.preventDefault();
  }

  function onVisibility() {
    if (document.hidden) {
      const s = engine?.getState().status;
      if (s === 'running' || s === 'preparing') {
        engine.pause();
        notice = 'Paused because the app went into the background. Press Resume when you are ready.';
        update();
      }
    } else if (engine?.getState().status === 'paused') {
      update();
    }
  }

  // ---------- wake lock (optional enhancement) ----------

  async function requestWakeLock() {
    if (!settings.wakeLock || !('wakeLock' in navigator) || wakeLock || document.hidden) return;
    try {
      const lock = await navigator.wakeLock.request('screen');
      const s = engine?.getState().status;
      if (s === 'running' || s === 'preparing') {
        wakeLock = lock;
        lock.addEventListener('release', () => {
          if (wakeLock === lock) wakeLock = null;
        });
      } else lock.release().catch(() => {});
    } catch {
      /* not allowed right now; the timer does not depend on it */
    }
  }

  function releaseWakeLock() {
    wakeLock?.release().catch(() => {});
    wakeLock = null;
  }

  // ---------- rendering ----------

  function startLoop() {
    stopLoop();
    timer = setInterval(() => {
      engine.tick(); // emits events, which call update()
      update();
    }, TICK_MS);
  }

  function stopLoop() {
    clearInterval(timer);
    timer = null;
  }

  function update() {
    if (!engine) return renderIdle();
    const st = engine.getState();
    if (st.status === 'completed' || st.status === 'idle') return;
    const preparing = st.index < 0;
    const seg = st.segment;
    const first = segments[0];

    el.pos.textContent = preparing ? `${segments.length} phases` : `Phase ${st.index + 1} of ${segments.length}`;
    el.badge.textContent = preparing ? 'Get ready' : typeLabel(seg.type);
    el.badge.dataset.type = preparing ? 'prepare' : seg.type;
    el.title.textContent = preparing ? 'Get ready' : seg.exerciseName;
    el.sub.textContent = preparing
      ? `First up: ${first.exerciseName}`
      : seg.phaseCount > 1
        ? `${seg.label} · part ${seg.phaseIndex + 1} of ${seg.phaseCount}`
        : seg.label;
    el.time.textContent = formatTime(st.remainingMs / 1000);
    el.bar.style.width = `${st.durationMs ? (100 * (st.durationMs - st.remainingMs)) / st.durationMs : 0}%`;
    el.instruction.textContent = preparing ? first.speech || first.exerciseInstructions : seg.exerciseInstructions || seg.speech;
    const n = st.next ?? (preparing ? first : null);
    el.next.textContent = preparing
      ? ''
      : n
        ? `Next: ${n.exerciseName}${n.phaseCount > 1 ? ` — ${n.label}` : ''} (${formatTime(n.durationMs / 1000)})`
        : 'Next: finish';

    const paused = st.status === 'paused';
    playerView.classList.toggle('is-paused', paused);
    el.primary.textContent = paused ? '▶ Resume' : '⏸ Pause';
    el.back.disabled = el.nextBtn.disabled = false;
    el.repeat.disabled = preparing;
    el.voice.setAttribute('aria-pressed', String(settings.voice));
    el.voice.disabled = !speech.supported;
    el.voice.textContent = speech.supported ? `Voice: ${settings.voice ? 'on' : 'off'}` : 'Voice unavailable';
    el.notice.textContent =
      notice ||
      (paused ? 'Paused.' : '') ||
      (!speech.supported ? 'Spoken cues are not supported in this browser; follow the on-screen cues.' : '');
  }

  function renderIdle() {
    // Reached by reloading or opening a player link directly: speech needs a fresh tap.
    container.replaceChildren(
      h(
        'section',
        { class: 'player idle' },
        h('p', { class: 'player-workout' }, `${segments.length} phases · ${formatTime(totalSeconds(snapshot))}`),
        h('h1', null, snapshot.title),
        h('p', null, 'Press Start when you are ready. Keep this page in the foreground for voice cues.'),
        h('div', { class: 'controls' }, h('button', { type: 'button', class: 'control primary', onclick: startSession }, '▶ Start workout')),
        h('p', null, h('button', { type: 'button', class: 'link', onclick: () => onExit('detail') }, 'Back to workout details')),
      ),
    );
    focusHeading(container);
  }

  function showComplete() {
    const elapsed = (performance.now() - sessionStart) / 1000;
    container.replaceChildren(
      h(
        'section',
        { class: 'player complete' },
        h('h1', null, 'Workout complete'),
        h('p', { class: 'player-workout' }, snapshot.title),
        h(
          'p',
          null,
          `Planned workout time ${formatTime(totalSeconds(snapshot))}. Session time, including get-ready, pauses and skips: ${formatTime(elapsed)}.`,
        ),
        h(
          'div',
          { class: 'controls' },
          h('button', { type: 'button', class: 'control primary', onclick: startSession }, '↻ Repeat'),
          h('button', { type: 'button', class: 'control', onclick: () => onExit('library') }, 'Back to library'),
        ),
      ),
    );
    focusHeading(container);
    announce('Workout complete.');
  }

  document.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', onVisibility);
  if (autoStart) startSession();
  else update();

  return {
    get active() {
      const s = engine?.getState().status;
      return s === 'preparing' || s === 'running' || s === 'paused';
    },
    end() {
      engine?.end();
    },
    speechFailed() {
      notice = 'Speech failed in this browser. The timer keeps running; follow the on-screen cues.';
      update();
    },
    destroy() {
      stopLoop();
      speech.cancel();
      releaseWakeLock();
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}

// Pure playback state machine. Time comes from an injected monotonic clock;
// UI ticks only sample it, so late or throttled ticks never stretch the workout.
//
// States: idle -> preparing -> running <-> paused -> completed (end() returns to idle).
// Events (via onEvent): prepare, phase, warning, count, pause, resume, complete, end.

export const BACK_THRESHOLD_MS = 3000;
export const WARNING_MS = 5000;
export const MIN_WARNING_PHASE_MS = 10000; // shorter phases: the intro and countdown already fill the time
export const COUNTDOWN_FROM = 3;

export function createPlayback({ segments, prepMs = 3000, now, onEvent = () => {} }) {
  if (!segments || !segments.length) throw new Error('Workout has no phases.');
  if (typeof now !== 'function') throw new Error('A clock function is required.');

  const last = segments.length - 1;
  let status = 'idle';
  let index = -1; // -1 = preparation countdown
  let deadline = 0; // clock time the current segment ends (preparing/running)
  let remaining = 0; // ms left while paused
  let pausedFrom = null;
  let fired = new Set(); // cues already emitted for the current segment

  const durationOf = (i) => (i < 0 ? prepMs : segments[i].durationMs);
  const isLive = () => status === 'preparing' || status === 'running';
  const remainingAt = (t) => (status === 'paused' ? remaining : Math.max(0, deadline - t));

  function emit(type, extra = {}) {
    onEvent({ type, index, segment: segments[index] ?? null, ...extra });
  }

  function enter(i, t, extra) {
    index = i;
    fired = new Set();
    if (status === 'paused') {
      pausedFrom = i < 0 ? 'preparing' : 'running';
      remaining = durationOf(i);
    } else {
      status = i < 0 ? 'preparing' : 'running';
      deadline = t + durationOf(i);
    }
    emit(i < 0 ? 'prepare' : 'phase', { paused: status === 'paused', ...extra });
  }

  function complete() {
    status = 'completed';
    remaining = 0;
    emit('complete');
  }

  function tick() {
    if (!isLive()) return getState();
    const t = now();
    let advanced = 0;
    while (t >= deadline) {
      if (index === last) {
        complete();
        return getState();
      }
      // Next boundary is derived from the previous deadline, not from "now": no drift.
      index += 1;
      deadline += durationOf(index);
      advanced += 1;
    }
    if (advanced) {
      status = 'running';
      fired = new Set();
      // Only the landing phase is announced; skipped phases produce no cues.
      emit('phase', { caughtUp: advanced > 1, skipped: advanced - 1 });
    }
    if (status === 'running') cues(deadline - t);
    return getState();
  }

  // A cue fires only inside its own one-second window, so a late tick never replays a backlog.
  function cues(rem) {
    const seg = segments[index];
    if (
      index < last &&
      seg.durationMs >= MIN_WARNING_PHASE_MS &&
      rem <= WARNING_MS &&
      rem > WARNING_MS - 1000 &&
      !fired.has('warning')
    ) {
      fired.add('warning');
      emit('warning', { next: segments[index + 1] });
    }
    const n = Math.ceil(rem / 1000);
    if (n >= 1 && n <= COUNTDOWN_FROM && n * 1000 < seg.durationMs && !fired.has(`count${n}`)) {
      fired.add(`count${n}`);
      emit('count', { n });
    }
  }

  function start() {
    if (status !== 'idle') return getState();
    const t = now();
    if (prepMs > 0) enter(-1, t);
    else enter(0, t);
    return getState();
  }

  function pause() {
    tick();
    if (!isLive()) return getState();
    remaining = Math.max(0, deadline - now());
    pausedFrom = status;
    status = 'paused';
    emit('pause');
    return getState();
  }

  function resume() {
    if (status !== 'paused') return getState();
    status = pausedFrom;
    deadline = now() + remaining;
    emit('resume');
    return getState();
  }

  function next() {
    tick();
    if (!isLive() && status !== 'paused') return getState();
    if (index === last) complete();
    else enter(index + 1, now(), { manual: true });
    return getState();
  }

  function back() {
    tick();
    if (!isLive() && status !== 'paused') return getState();
    const t = now();
    const elapsed = durationOf(index) - remainingAt(t);
    const target = index <= 0 || elapsed > BACK_THRESHOLD_MS ? index : index - 1;
    enter(target, t, { manual: true, restarted: target === index });
    return getState();
  }

  function end() {
    if (status === 'idle' || status === 'completed') return getState();
    status = 'idle';
    emit('end');
    return getState();
  }

  function getState() {
    const t = now();
    const durationMs = index >= 0 || status !== 'idle' ? durationOf(index) : 0;
    return {
      status,
      index,
      segment: segments[index] ?? null,
      next: segments[index + 1] ?? null,
      remainingMs: status === 'completed' || status === 'idle' ? 0 : remainingAt(t),
      durationMs,
      count: segments.length,
    };
  }

  return { start, pause, resume, next, back, end, tick, getState };
}

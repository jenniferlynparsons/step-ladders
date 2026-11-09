# Workout Guide — Claude Code Implementation Brief

**Status:** Ready for implementation  
**Product:** Personal mobile-first, voice-guided exercise timer  
**Reference app:** https://github.com/jenniferlynparsons/rinkside  
**Reference workout:** https://www.instagram.com/p/DfUsKrSRIWT/ (user has also provided a video file in ChatGPT; Claude Code may need the actual file copied into its workspace)  
**Deployment:** GitHub Pages

## 1. Assignment to Claude Code

Build a complete, polished, maintainable personal web app for running short workouts derived from Instagram exercise demonstrations. The app should guide the user through timed exercises and sub-phases with audible instructions and automatic transitions. Prioritize a genuinely usable mobile experience over a large feature set.

**Working style:** Inspect the repository before changing code. Implement the entire agreed MVP, not just a scaffold or mockup. Make reasonable implementation decisions without repeatedly seeking permission. Keep scope tightly aligned to this brief. Explain trade-offs and assumptions in the README. Run automated tests and report results. Do not claim mobile browser behaviors that have not been tested on a device.

### Design principles

1. **Press Start and move.** Almost everything after Start should be hands-free.
2. **Calm, readable, accessible.** Large timer, clear instructions, high contrast, comfortable tap targets, no gamification.
3. **Offline-friendly where practical.** The app does not need a server during playback.
4. **Simple to own.** Vanilla JS, CSS, HTML, JSON; no React, hosted API, database, account system, or unnecessary build tooling.
5. **Correct timekeeping.** Timing must not drift as intervals lag or the tab is backgrounded.
6. **Honest failure handling.** If the browser cannot speak or is suspended, explain it and remain usable visually.

## 2. User journeys

### A. Start an existing workout

1. Open the home screen and see the workout library: title, total estimated duration, number of exercises, short description, and optional original video link.
2. Select a workout and view its ordered steps, duration, and any notes/equipment requirements.
3. Adjust optional session settings (voice enabled, speech rate, pre-start countdown, transition warning, rest durations if provided).
4. Press **Start workout**. This click must also serve as the user gesture for initializing speech/audio wherever possible.
5. The app provides a 3-second preparation countdown, then announces the first movement and starts its timer.
6. It moves through the sequence automatically, reading instructions and announcing changes, with a large visual countdown and simple controls.
7. On completion, stop cues and show a quiet completion screen offering **Repeat**, **Back to library**. No badges, streaks, or social prompts.

### B. Control a workout in progress

- Pause: freezes remaining time and stops/cancels in-progress speech; do not accidentally queue announcements while paused.
- Resume: resumes remaining time with an optional short spoken cue; do not replay the full instruction unless user presses Repeat instruction.
- Next: jump to the next phase; if at the final phase, go to completion.
- Back: restart current phase if more than a small threshold (e.g. 3 seconds) has elapsed; otherwise move to previous phase, consistent with common playback controls. Clearly document this behavior.
- Repeat instruction: speak the current instruction again without resetting the timer.
- End: confirm before discarding a session; never accidentally end from a single mis-tap.
- Voice toggle: immediately cancel speech when muted; timer keeps running.

### C. Add or edit a workout

Create and edit workout definitions in an in-app form. Include title, description, source URL, ordered exercises, ordered phases, durations in seconds, and short spoken instruction text. Allow reordering, editing, deleting, and duplicating exercises/phases. Preview the computed total duration. Validate invalid/empty fields. Save user-created and edited workouts locally. Provide JSON export and import as a simple, explicit backup mechanism.

**Important data ownership:** Ship a bundled starter library as static JSON. Keep user edits and created workouts in localStorage under a versioned key. Never silently replace local edits during deploys. Provide Reset to bundled version with confirmation. A simple localStorage approach is fine for MVP; no cross-device sync is promised. JSON import/export is the user’s backup and transfer mechanism.

## 3. Scope

### MVP — must deliver

- Mobile-first home/library, workout detail, workout editor, player, completion state.
- One or more **clearly labeled example** workouts; do not invent an exact transcript or timings for the uploaded Instagram video. Include a draft walking-and-coordination routine based on visible themes, and flag all unverified durations/content in fixture notes. Make sample movements explicitly illustrative until checked against the source.
- Nested workout > exercise > phase data model.
- Phase types: `work`, `rest`, `transition` (allow other categories later without hardwired assumptions).
- Countdown timer with progress display, automatic transitions, pause/resume, skip/back, end/restart.
- Spoken phase instructions, next-up/transition warning, optional 3-2-1 countdown, repeat instruction.
- Adjustable voice on/off and speech rate; preserve settings locally. Voice selection only if straightforward and supported reliably.
- Clear fallback when speech synthesis is unavailable.
- Robust validation, invalid import handling, and safe text rendering.
- Keyboard operation for desktop; accessible controls and announcements for screen-reader users.
- GitHub Pages support, including correct relative URL handling under a repository subpath.
- Automated unit tests for pure timer/state model, validation, and persistence logic.
- README with setup, data schema, limitations, and deployment steps.

### Explicitly out of scope

- Fetching or scraping saved Instagram videos; extracting/transcribing video via AI; copying/rehosting video content.
- Account login, cloud sync, server or database, calendar, notifications, analytics.
- Gamification, calorie or heart rate estimates, streaks, social features.
- Automated workout recommendations or medical claims.
- Guaranteed playback or audio while a phone is locked or a browser is backgrounded.
- Installing a service worker/PWA unless simple and clearly justified after MVP (Add to Home Screen works for a normal site too, but offline installation is a separate capability).

## 4. Information architecture and UI

### Home/library

- App name and a short descriptive subtitle.
- Cards/list for available workouts with title, duration, number of exercises, and source label.
- A visible **Create workout** control and **Import JSON**.
- Do not automatically load, embed, or autoplay Instagram media.

### Workout details

- Workout title, notes, total duration, exercise list and expanded phases.
- Clear distinction between exercise and phase so complex routines remain understandable.
- **Start workout**, **Edit**, **Duplicate**, **Export**, and source video link.
- Avoid showing unverified exercise guidance as verified source material.

### Player (highest-priority screen)

- Single-column mobile layout (narrow widths around 320–430 px); usable in landscape and on desktop.
- Large exercise name, phase description and **very large remaining time** (`m:ss`), high-contrast progress bar, segment number and total, next-up preview.
- Primary Pause/Resume button, adjacent Previous/Next, Repeat instruction, voice toggle; End less prominent but discoverable.
- Minimal scrolling during playback; respect safe area insets.
- Support reduced motion and avoid flashy transitions.
- Never rely on color alone to communicate phase type.
- Keep the display awake only if Wake Lock API is supported and only after explicit user action; release on pause/end/visibility loss and reacquire cautiously on resume. Offer plain-language fallback. Wake Lock must never be necessary for playback.

### Completion

- Simple acknowledgement and elapsed/estimated session duration; no exercise performance claims.
- Repeat and return actions.

### Accessibility

- Semantic landmarks and headings; accessible button names; visible focus indicators.
- Touch targets around 44×44 CSS px minimum where feasible.
- Correct labels for toggles and disabled controls.
- Screen-reader announcements should not constantly repeat every countdown second; use judicious `aria-live` on phase transitions rather than a second-by-second live region.
- Test keyboard-only flows and screen-reader-friendly copy.

## 5. Data model

Store a bundled `data/workouts.json` array and versioned user content separately. Prefer explicit IDs, integer seconds, and spoken text distinct from display text. Example **fictional** seed data:

```json
[
  {
    "schemaVersion": 1,
    "id": "gentle-walking-demo",
    "title": "Gentle Walking & Coordination (Example)",
    "description": "Illustrative movements to test player behavior; verify against source video before using as a faithful transcription.",
    "sourceUrl": "https://www.instagram.com/p/DfUsKrSRIWT/",
    "notes": "Example timings and order are not verified against the source.",
    "exercises": [
      {
        "id": "marching",
        "name": "March in Place",
        "instructions": "Stand comfortably and march in place.",
        "phases": [
          {
            "id": "marching-work",
            "type": "work",
            "label": "March",
            "durationSeconds": 30,
            "speech": "Start marching in place at a comfortable pace."
          }
        ]
      },
      {
        "id": "step-pattern",
        "name": "Step Pattern",
        "instructions": "Practice a coordinated stepping pattern.",
        "phases": [
          {
            "id": "step-first",
            "type": "work",
            "label": "First pattern",
            "durationSeconds": 20,
            "speech": "Begin the first stepping pattern."
          },
          {
            "id": "step-second",
            "type": "work",
            "label": "Second pattern",
            "durationSeconds": 20,
            "speech": "Change to the second stepping pattern."
          },
          {
            "id": "rest",
            "type": "rest",
            "label": "Rest",
            "durationSeconds": 15,
            "speech": "Rest and get ready for the next movement."
          }
        ]
      }
    ]
  }
]
```

### Invariants and validation

- `schemaVersion` is a known integer. Reject unknown versions with a friendly error instead of trying to interpret them silently.
- Workout, exercise, and phase IDs are unique within their relevant scopes.
- Every workout has at least one exercise; every exercise has at least one phase.
- Each duration is a finite positive integer in a sensible range (e.g. 1–3600 seconds).
- Text has reasonable length limits; URLs must be HTTP(S), optional, and displayed safely.
- Compute total duration from phases, not a duplicated manually maintained property. Preparation countdown is separately counted and clearly indicated.
- Render all user-entered fields as text content, never raw HTML. Validate imports and reject malformed or oversized input.
- If editor changes schema, create a migration instead of overwriting prior locally stored workouts.

## 6. Playback engine — correctness requirements

Implement the logic as a standalone testable module, separate from the DOM and speech subsystem. Suggested model:

**States:** `idle`, `preparing`, `running`, `paused`, `completed`. A session is associated with a workout snapshot and a flattened, immutable array of phase records (exercise metadata + phase metadata + indices). Editing the underlying library must not mutate an active session.

**Time source:** Use `performance.now()` (monotonic) and a deadline/remaining-duration approach. `setInterval` or `requestAnimationFrame` is only for updating the UI, not the truth of the timer. On pause, persist the precise remaining milliseconds; on resume, compute a new deadline. Use an injectable clock in tests.

**Transitions:** Derive phase boundaries deterministically. Handle delayed ticks by advancing across all fully elapsed phases; do not extend the workout because a browser timer fired late. Avoid replaying a backlog of speech cues if multiple phases expired while the page was suspended. Never fire the same cue twice because of repeated renders/ticks. At the end, stop and enter completed state exactly once.

**Background behavior:** Document a clear policy: when the page is hidden, the timer may continue according to elapsed wall/monotonic time, but audio and wake lock are not guaranteed. On visibility return, re-evaluate position based on elapsed time and synchronize UI; do **not** speak every missed announcement. Provide a user setting or explicit behavior for auto-pause-on-hidden if device testing shows continuing is confusing; pick and document one consistent MVP default. The timer must not silently pretend an interrupted background session has been continuously coached.

**Speech vs timer:** TTS is best effort and never blocks the timer. For long instructions, do not let overlapping voices stack up. Provide an audio cue policy with priorities: current phase introduction > next-up warning > final countdown. Keep countdown optional, and if announcements conflict, omit or cancel lower-priority ones. A phase must begin at its scheduled time, not when speech finishes.

**Pre-start:** A user-configurable short countdown (default 3 seconds) before first phase. Do not count it as workout phase time.

**Phase cue policy defaults:**

- At start of phase: say phase/exercise instruction if voice enabled.
- With 5 seconds remaining: optional short warning or “Next up: ...” if it can be spoken without colliding with the final countdown.
- At last 3 seconds: optional countdown; implement an explicit precedence policy so countdown is not constantly interrupted.
- On manual repeat: cancel current speech and read the full current instruction.
- On pause, skip, end, toggle off voice, or completion: cancel pending/current utterances as appropriate.

## 7. Speech subsystem

Use `window.speechSynthesis` and `SpeechSynthesisUtterance`. Detect support and voice availability. Query `getVoices()` and handle the asynchronous `voiceschanged` event; use the system default when no enumerated voice is available. Speech rate should be adjustable (e.g. 0.75–1.25, default 0.9 or 1.0). Remember preference without relying on device-specific voice IDs existing forever.

**Mobile considerations:** Speech typically needs to be initiated from a user gesture, and behavior varies by OS/browser. Do not claim reliable speech with the screen locked, with silent mode enabled, or in a background tab. Test real-device behavior and give concise instructions if necessary (e.g. keep app foregrounded). Handle `speechSynthesis.speak()` errors or utterance `onerror` by leaving visual playback usable. Avoid using `speechSynthesis.pause()`/`resume()` as a substitute for the timer's own independent state machine.

Expose a small interface such as `speak(text, priority)`, `cancel()`, `setEnabled()`, `setRate()`, with mocked unit tests.

## 8. Suggested code layout

The exact module names may vary after inspecting the repo; prefer clarity over rigid compliance.

```text
/
  index.html
  style.css
  js/
    main.js               # bootstrap and wiring
    router.js             # lightweight screen/state navigation
    workout-model.js      # schema validation, flattening, duration
    playback-engine.js    # pure timekeeping/state transitions
    speech.js             # speech synthesis adapter
    storage.js            # localStorage versioning and import/export
    library-ui.js         # list/detail/editor
    player-ui.js          # active workout UI
  data/
    workouts.json         # bundled example library
  tests/
    playback-engine.test.js
    workout-model.test.js
    storage.test.js
  README.md
```

No framework required. A small dev-only test runner dependency is acceptable if it materially improves coverage; prefer Node's built-in test runner and minimal `package.json` scripts if practical. Avoid bundlers unless a concrete browser compatibility issue requires one. Use ES modules and a local server for development (module imports do not work reliably from `file://`). GitHub Pages must load assets correctly from a `/<repo>/` path.

## 9. Implementation phases and checkpoints

### Phase 0 — Recon and setup

- Inspect existing repo if working within one. Use Rinkside for architectural inspiration, not copy its unrelated hockey fetcher.
- Establish basic page, styles, modules, static JSON loading, local development instructions, and deployment compatibility.
- Write a short decision record in README: why vanilla JS, localStorage, speech synthesis, static hosting.

**Checkpoint:** app loads locally and on a subpath without errors; test command runs.

### Phase 1 — Model and engine (do before polishing UI)

- Build schema validator, flattening, duration computation.
- Implement state machine with injectable monotonic clock and transition events.
- Unit test pause/resume, skip, phase boundaries, delayed ticks, completion, and zero/invalid inputs.

**Checkpoint:** all timing semantics pass deterministic tests without a browser UI.

### Phase 2 — Usable player and speech

- Build large mobile player; wire engine to controls.
- Integrate TTS on the Start gesture, settings, cancellation, and transition cues.
- Handle unsupported speech gracefully; ensure app functions when muted.
- Test on desktop browser before device QA.

**Checkpoint:** complete a multi-phase example workout from start to finish without manual intervention.

### Phase 3 — Library and editor

- Load and display bundled workouts.
- Build create/edit/duplicate/delete and phase reorder controls; validate inputs.
- Implement versioned persistence, import/export, reset, and errors.

**Checkpoint:** create a new multi-phase workout, reload, edit, export, reset, import, and replay without losing information.

### Phase 4 — Polish, accessibility, device QA and deploy

- Keyboard/focus checks, responsive layout, reduced motion, voice settings, errors, README.
- Test iOS Safari and/or Android Chrome on the user's actual phone; write device-specific limitations observed.
- Deploy via GitHub Pages and verify correct relative paths.

**Checkpoint:** a documented working MVP, not just a prototype.

## 10. Test plan

### Automated tests: required

1. Total time equals sum of all phase durations; preparation time remains separate.
2. Pause preserves milliseconds; elapsed time while paused does not decrease remaining time.
3. Resume after pause does not introduce drift.
4. Late tick skips expired phases deterministically and lands on the correct current phase.
5. Transition events are emitted once, not once per UI render.
6. Skip and back work at first, middle, and final phases.
7. Completion occurs exactly once and no further countdown continues.
8. Voice disabled and unsupported do not break playback.
9. Muting and skipping cancel queued speech.
10. Invalid JSON, duplicate IDs, negative duration, unsupported schema version and unsafe URLs are handled gracefully.
11. Local overrides persist across reload and exports round-trip through import.
12. A workout with several phases inside one exercise announces phase changes correctly.

### Manual test matrix: required

| Scenario | Expected result |
| --- | --- |
| iPhone Safari / Android Chrome foreground | timer progresses, speech triggers after Start, controls respond |
| Mute before starting | full visual workout remains usable |
| Mute mid-instruction | speech stops; timer continues |
| Pause and resume | time frozen while paused; no duplicate speech |
| Skip rapidly through multiple phases | correct phase, no piled-up announcements |
| Lock screen / switch apps | document actual device behavior; UI reconciles on return |
| Rotate phone / narrow viewport | buttons remain reachable, timer remains prominent |
| Import invalid JSON | informative error; saved data unchanged |
| Reload during editing | previously saved content remains intact |
| Keyboard only | controls reachable with visible focus |
| Long instruction | readable without clipping; no uncontrolled speech overlap |
| GitHub Pages subpath | all JS/CSS/JSON assets load |

Do not treat emulated mobile Chrome as evidence of real iOS audio behavior.

## 11. Definition of done

- Working library, detail, editor, and player screens deployed to GitHub Pages.
- At least one **clearly labeled example** routine using multiple exercises and a multi-phase exercise.
- Starting a workout requires one explicit gesture; after that, transitions occur without taps while the app is foregrounded.
- Timers, pause, resume, next/back, completion and countdown cues pass automated tests.
- Audio instructions work in at least one tested real browser, with graceful fallback elsewhere; any mobile limitations are documented.
- No console errors during the primary flows; no network requests required to run a previously loaded workout.
- Content persists locally and can be exported/imported.
- CSS works at common mobile widths and with reduced motion.
- README explains local development, tests, JSON schema, workflow for adding Instagram-derived workouts manually, deployment, browser caveats, and data backup.
- Claude Code ends with a short delivery report: files changed, how to run, automated test results, device tests actually performed, known issues, and follow-up improvements.

## 12. Future enhancements (only after MVP)

- PWA manifest and service worker for dependable offline launch; cache invalidation strategy.
- Optional haptic or nonverbal audio cues where supported.
- More configurable workouts: loops, repetitions, sides, variable-duration rests.
- Better on-device voice picker.
- Media preview links and user-supplied demonstration clips, without scraping Instagram.
- Optional transcription/import workflow for videos explicitly provided by the user; review extracted instructions before publishing them to the library.
- Cross-device sync only if the lack of it becomes a real problem.

## 13. Paste this into Claude Code

> Build the complete MVP described in `workout-guide-claude-code-plan.md`. Treat that file as the product specification and acceptance criteria. Inspect the repository first. Follow Rinkside's lightweight, static-site approach but do not copy its unrelated data-fetching infrastructure. Prioritize a functioning, accurate workout timer, spoken instructions, and mobile usability. Keep timer logic separately testable, implement an accessible workout library/editor, and avoid scope creep. Add automated tests and run them. Use clearly labeled sample content rather than claiming to have transcribed the Instagram video exactly. When done, tell me what you built, how to run and deploy it, which tests passed, and what remains to verify on a physical phone. Do not stop after scaffolding or just produce a plan.

## 14. Authoritative references

- Rinkside source and architecture: https://github.com/jenniferlynparsons/rinkside
- Speech synthesis API: https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis
- Speech synthesis usage: https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API/Using_the_Web_Speech_API
- GitHub Pages deployment: https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site

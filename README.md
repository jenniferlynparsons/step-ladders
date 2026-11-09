# Step Ladders

A calm, mobile-first, voice-guided workout timer. Pick a workout, press **Start workout**, and the app counts down each phase, reads its instruction aloud, and moves on by itself. It is a static site with no build step, server, account or tracking.

> The bundled workouts are **examples**. "Gentle Walking & Coordination (Example)" is a draft based only on the general theme of the linked Instagram video. Its movements, order, cues and every duration are unverified. Check them against the video and edit them before you rely on them.

## Run locally

ES modules do not load from `file://`, so serve the folder:

```sh
npm start            # python3 -m http.server 8000
# open http://localhost:8000/
```

Any static server works. No `npm install` is needed: there are no dependencies.

## Tests

```sh
npm test             # node --test (Node 20+)
```

Unit tests cover the pure modules: the playback engine (with an injected clock), schema validation, persistence and import/export, and the speech adapter (with a mocked `speechSynthesis`).

## Decisions

| Decision | Why |
| --- | --- |
| Vanilla JS, ES modules, no build | Small enough to own. GitHub Pages serves the repo as it is. |
| `localStorage` + JSON export/import | Personal app on one device. Export is the backup and transfer method. There is no sync. |
| `speechSynthesis` | Built into the browser, works offline after the voice is installed, no API keys. Best effort only. |
| Static hosting (GitHub Pages) | Nothing to run or pay for. All paths are relative, so it works under `/<repo>/`. |
| No service worker | Out of MVP scope. After the page loads, playback makes no network requests. Offline *launch* is not supported. |

## How it works

```
index.html, style.css
js/app.js             bootstrap, hash router (#/, #/w/:id, #/edit/:id, #/new, #/play/:id), library + detail screens
js/editor-ui.js       workout editor (draft in memory, validated on save)
js/player-ui.js       player screen: engine ↔ DOM, speech, wake lock, keyboard
js/playback-engine.js pure state machine, injectable monotonic clock
js/workout-model.js   schema validation, normalisation, flattening, durations
js/speech.js          speechSynthesis adapter with cue priorities
js/storage.js         versioned localStorage, settings, import/export parsing
js/dom.js             h() element helper (text nodes only, never innerHTML)
data/workouts.json    bundled example library
tests/*.test.js       node:test unit tests
```

### Timing

- The engine stores a **deadline** from `performance.now()`. The 200 ms UI interval only reads the clock. It is never the source of the time, so slow or throttled ticks do not make the workout longer.
- Each next phase boundary is the previous deadline plus the phase duration. It is not "now" plus the duration, so pause/resume and late ticks cause no drift.
- If one tick spans several phase boundaries (for example, after the tab was throttled), the engine jumps to the correct phase. It announces only the phase it lands on, and the screen says it skipped ahead.
- Pause stores the exact remaining milliseconds. Resume sets a new deadline from them.
- Completion fires exactly once.
- The get-ready countdown (0/3/5/10 s, default 3) is not part of the workout total.
- Each session uses a frozen snapshot of the workout. Editing the library during a session does not affect it.

### Controls

| Control | Behaviour | Key |
| --- | --- | --- |
| Pause / Resume | Freezes time and stops speech. Resume says "Resuming". It reads the full instruction only if you changed phase while paused. | Space |
| Next | Goes to the next phase. On the last phase it completes the workout. | → |
| Back | If **more than 3 s** of the phase have passed, restarts the phase. Otherwise goes to the previous phase. The first phase always restarts. During get-ready, restarts the countdown. | ← |
| Repeat instruction | Stops current speech and reads the full instruction again. The timer is not reset. | R |
| Voice | Mutes or unmutes at once. The timer keeps running. Saved as a setting. | M |
| End workout | Asks for confirmation first. Leaving the player (browser Back, a link) also asks while a session is active. | — |

### Spoken cue policy

Priorities: **phase introduction / repeat (3) > "Next up" warning (2) > 3-2-1 countdown (1)**.

- A new cue interrupts the current one, unless the current one has a higher priority. In that case the new cue is dropped. Voices never queue or stack.
- **Phase start:** says the instruction. On the first phase of an exercise, it says the exercise name first.
- **"Next up: …"** comes 5 s before the end, only for phases of 10 s or more that have a following phase. For shorter phases, the introduction and the countdown already fill the time.
- **3-2-1** comes at the end of every phase longer than the number being spoken.
- Each cue fires only inside its own one-second window. A late tick never plays a backlog of cues.
- A phase starts on schedule. It never waits for speech to finish.
- Pause, skip, mute, end and completion cancel speech.
- Speech starts inside the **Start workout** tap, which mobile browsers require. If you open a `#/play/…` link directly or reload the player, it shows a Start button for the same reason.

### Background policy (MVP default)

**The session auto-pauses when the page is hidden** (tab switch, app switch, and on most phones, screen lock). When you come back, it says why it paused and waits for **Resume**. The app never claims that you were coached while it was hidden.

### Choosing a voice

**Session settings → Voice** lists the device's English voices. Premium voices come first, then Enhanced, then on-device ones. Voices that need the internet are marked "online". Apple's novelty voices (Bubbles, Zarvox and so on) are hidden. **Test voice** uses the voice you picked.

For a natural-sounding voice on iPhone:

1. Open Settings → Accessibility → Spoken Content → Voices → English.
2. Download a **Premium** voice, or **Enhanced** if there is no Premium one. These are large downloads, so use Wi-Fi.
3. Reload the app and pick that voice.

Every iPhone browser uses the same engine as Safari, so it gets the same voices.

### Screen wake lock

If the Wake Lock API is available and the setting is on, the app requests a screen lock when the session starts or resumes. It releases the lock on pause, end, completion or when the page is hidden. Playback does not depend on the wake lock. If the browser does not support it, the settings say so, and you can lengthen your screen auto-lock instead.

### Accessibility

- Semantic headings and landmarks. Focus moves to the new screen's heading.
- Visible focus rings. Touch targets are at least 44 px.
- Phase type is shown as text (Work/Rest/Transition) as well as by colour and border style.
- `role="timer"` does not announce every second. A polite live region announces phase changes and completion only.
- `prefers-reduced-motion` and dark mode are supported.

## Data

### Storage and ownership

- `data/workouts.json` holds the bundled examples. The app never writes to it.
- `localStorage["workoutGuide.library"]` holds `{ version: 1, workouts: { [id]: workout }, hidden: [ids] }`.
  - Editing a bundled workout saves a local copy with the same id. The local copy **overrides** the bundled one, so a new deploy never replaces your edits. To go back, use **Reset to bundled version** on the detail page (it asks first).
  - Deleting a bundled workout hides it. **Restore deleted examples** on the library page brings it back.
  - Unknown or corrupt stored data is **left untouched** and saving is disabled, with a warning. To change the stored shape later, add a migration in `MIGRATIONS` in `js/storage.js`. Do not overwrite old data.
- `localStorage["workoutGuide.settings"]` holds voice on/off, chosen voice (`voiceURI`, empty for the system default), rate, get-ready seconds, warning, countdown and wake lock settings.

**Backup:** **Export all** (library) or **Export** (detail) downloads JSON. **Import JSON** checks the whole file and rejects it if any part is invalid, so a bad file never changes saved data. It asks before replacing workouts with the same id. Your data lives only in this browser on this device. Clearing site data deletes it.

### Workout schema (version 1)

```jsonc
{
  "schemaVersion": 1,                 // must be 1
  "id": "gentle-walking-demo",        // 1–64 chars: letters, digits, - _
  "title": "…",                       // required, ≤100
  "description": "…",                 // optional, ≤500
  "sourceUrl": "https://…",           // optional, http(s) only
  "notes": "…",                       // optional, ≤1000 (equipment, what is unverified)
  "exercises": [                      // 1–100
    {
      "id": "marching",               // unique within the workout
      "name": "March in Place",       // required, ≤100
      "instructions": "…",            // optional, ≤500, shown on screen
      "phases": [                     // 1–50
        {
          "id": "marching-work",      // unique within the exercise
          "type": "work",             // lowercase slug; UI offers work/rest/transition, others are accepted
          "label": "March",           // required, ≤100, shown on screen
          "durationSeconds": 30,      // integer 1–3600
          "speech": "…"               // optional, ≤500, spoken (falls back to label)
        }
      ]
    }
  ]
}
```

The total duration is always calculated from the phases. It is never stored. Unknown fields are removed when a workout is saved or imported. All text is shown as text, never as HTML.

Import accepts an export file (`{ "format": "workout-guide-export", "exportVersion": 1, "workouts": [...] }`), a list of workouts, or one workout. The limit is 1 MB.

### Adding a workout from an Instagram video

The app does not fetch, embed or transcribe videos. To add one by hand:

1. Watch the video and write down each movement and how long it lasts.
2. In the app, select **Create workout**. Paste the post URL into **Source video URL**.
3. Add an exercise for each movement. Add phases inside an exercise when it changes partway through (for example, left side, then right side, then rest).
4. Write a short **Spoken instruction** for each phase. Put anything you could not verify in **Notes**.
5. Save, do a test run, then **Export** a backup.

## Deploy to GitHub Pages

1. Push `main` to GitHub.
2. In the repo, open **Settings → Pages → Build and deployment**. Choose **Deploy from a branch**, branch `main`, folder `/ (root)`.
3. Open `https://<user>.github.io/<repo>/`.

All asset URLs are relative (`style.css`, `js/app.js`, `data/workouts.json`) and routing uses the URL hash, so the repository subpath needs no configuration. `.nojekyll` turns off Jekyll processing.

## Testing status

**Automated:** `npm test`. The 47 original unit tests passed. Two voice-picker tests were added afterwards and have not been run yet.

**Headless desktop Chrome 156 smoke test** (served under `/step-ladders/` to imitate Pages, with mobile viewport emulation). This test is not in the repo. All of these passed with no console errors:

- The library loads under the subpath, and every request stays under it.
- A full workout plays from start to finish with no input. Pause freezes the time. Resume says "Resuming". Next and Back work, including the 3 s rule. The Arrow keys work.
- Mute stops cues. The cue order matches the policy, with no duplicates.
- The "Next up" warning and the 3-2-1 countdown play. Hiding the page auto-pauses the session. End asks for confirmation.
- The editor shows validation errors, focuses the error summary, rejects `javascript:` URLs, reorders phases, saves, and keeps data after a reload. HTML in titles is shown as text.
- Bundled edit and reset, invalid JSON import (data unchanged), export round-trip through the import UI, and delete/restore of examples all work.
- At 320×568 and 740×360 (landscape), every player control is on screen with no horizontal scroll.

Speech in this test was checked by recording calls to `speechSynthesis.speak`. Audio output was not checked.

**Not yet tested on a physical phone.** Emulated mobile Chrome is not evidence of real iOS or Android audio behaviour. Please run the manual matrix in the brief (section 10) on your phone, especially:

- iPhone Safari and Android Chrome: is speech audible after Start, and with the silent switch on?
- Lock the screen or switch apps: the session should auto-pause. Does it reconcile on return?
- Wake lock: does the screen stay on?
- Long instructions with rate changes: no overlapping speech.
- VoiceOver or TalkBack: are phase-change announcements useful and not noisy?

## Known limitations

- **No device QA yet.** See above.
- The voice picker lists only voices that are installed on the device, and only English ones. If the saved voice is missing (another device, or the voice was deleted), the app uses the system default. Siri voices are usually not offered to web pages on iPhone. The picker has not been tried on a device yet.
- Settings are global, not per workout. There is no per-session override of rest durations; to change one, edit the workout.
- The session auto-pauses when the page is hidden. There is no option to keep timing in the background.
- `confirm()` dialogs are used for destructive actions. They are plain but reliable and accessible.
- Unsaved editor changes are lost on reload. Cancel asks first, but browser navigation away from the editor does not.
- No offline launch (no service worker). There is no cross-device sync.
- When imported workouts conflict with existing ones, you can replace them or cancel. There is no "import as copy".

## Future ideas (post-MVP)

PWA/offline launch, haptic or tone cues, repeats/sides/loops, per-session rest overrides.

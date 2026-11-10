# Maintaining Yogurt

This document is the operational companion to the [README](README.md). The
README explains **what the app is and why it was built this way**; this one
covers **what breaks if you touch it the wrong way**, where the tuning knobs
are, and how to verify a change before believing in it.

Read the invariants section before your first commit. Several of them are
counterintuitive, and every one of them cost a real bug.

---

## 1. Before you start: three environment traps

These three get in your way before you even reach the code, and none of them
produces an error message that points to the cause.

### `npm install` fails with `SELF_SIGNED_CERT_IN_CHAIN`

On a corporate network with a proxy that intercepts TLS, Node validates
certificates against the bundle compiled into it and ignores the Windows store.

```powershell
$env:NODE_OPTIONS = '--use-system-ca'   # Node 22.15+ / 24+
npm install
$env:NODE_OPTIONS = ''                  # clear it!
```

⚠️ **Don't leave `NODE_OPTIONS` set permanently.** Electron rejects
`--use-system-ca` and exits with code 9 — `npm run dev` stops working. Use it
only for the install command.

Never use `strict-ssl=false` or `NODE_TLS_REJECT_UNAUTHORIZED=0`: they fix the
symptom by turning off certificate verification on a machine that downloads and
runs code from the internet.

### The app doesn't open and `require('electron')` returns a string

Terminals opened by VSCode inherit `ELECTRON_RUN_AS_NODE=1` from the extension
host. With it set, the Electron binary runs as plain Node. The symptom is
`TypeError: Cannot read properties of undefined (reading 'whenReady')`, which
sends you investigating imports or the bundler when the problem is a variable.

```powershell
Remove-Item env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
```

Use `Remove-Item`, **not** `[Environment]::SetEnvironmentVariable(..., $null)` —
the latter doesn't really remove it, and the app silently crashes as Node.

### `npm run dist` fails with an error about `.dylib` files

Two possible causes, neither related to what the message says:

1. **App running.** Any instance locks `release\win-unpacked\Yogurt.exe`.
   Quit it first: `Get-Process electron,Yogurt | Stop-Process -Force`.
2. **`winCodeSign` and macOS symlinks.** Already solved with
   `signAndEditExecutable: false` in `electron-builder.yml` — read the comment
   there before removing that line.

### Commands

```powershell
npm run dev         # dev with HMR
npm run typecheck   # types only
npm run build       # typecheck + bundles
npm run dist        # installer in release/
npm audit           # must be 0 vulnerabilities before a release
```

### Running a second copy next to the installed Yogurt

The app takes a single-instance lock. If Yogurt is installed and running (even
hidden in the tray), a dev or test copy quits immediately with no message.
**Don't kill the user's instance** — give the test copy its own profile:

```powershell
node_modules\electron\dist\electron.exe . --user-data-dir=$env:TEMP\yogurt-test --remote-debugging-port=9333
```

The separate `--user-data-dir` gets its own lock and its own `settings.json` and
`meetings\`, so tests never touch real meetings. The debugging port lets a
script drive the window over the Chrome DevTools Protocol (that's how the
screenshots and the language checks were done — see section 4).

---

## 2. Invariants: touch these and something far away breaks

### `backgroundThrottling: false` on the window

`src/main/index.ts`. Chromium throttles timers of background windows, down to
~1 firing per minute. Segment rotation is a `setTimeout` of several minutes, so
**hiding the window in the tray would delay closing segments and misalign the
timestamps.** Removing this line makes the tray break the recording instead of
protecting it.

### Level measurement uses `setInterval`, never `requestAnimationFrame`

`src/renderer/src/audio/AudioEngine.ts`. rAF depends on compositing and **stops
firing while the window is hidden**. Since the peak RMS decides whether the
segment is sent to the API, measuring with rAF would make every segment look
silent while the app is minimized — and the whole meeting would go
untranscribed. A cost optimisation would turn into total data loss.

### No `window.confirm` / `alert` in the renderer

Use the `useConfirm` hook (`src/renderer/src/components/useConfirm.tsx`).
Electron's native dialog **steals focus and doesn't give it back**: the window
keeps rendering and responds to clicks, but no text field receives keyboard
input. The symptom — "I can't type in anything" — has no apparent connection to
the button that opened the dialog.

### `coalesceTurns` must not be used to cut voice clips

`src/shared/transcript.ts`. The `[start, end]` span of a grouped turn **crosses
the other participant's speech**. Using it to isolate one person's speech would
return clips with the wrong voice mixed in. `SpeakerPanel` uses the **raw
lines** on purpose.

### The `segmentMinutes` clamp runs on read *and* on write

`src/main/settings.ts`. Only on write isn't enough: a setting saved before the
cap existed, or a hand-edited `settings.json`, would slip through and the
recording would use the old value. `clampSegmentMinutes` is called in
`getPublicSettings` and in `updateSettings`.

### The `micWatcher` exclusion covers only our own executable

`src/main/micWatcher.ts`. Excluding `electron.exe` as a precaution would make
the app ignore any Electron-based meeting app. Use `basename(process.execPath)`
and nothing else.

Accepted side effect: in **development** we are `electron.exe`, so another
Electron app can't be told apart from us. Test detection with the **packaged**
build (`Yogurt.exe`).

### Silence detection measures structure, not peak

`renderer/src/audio/AudioEngine.ts`. An absolute threshold on the peak **doesn't
work** — it already failed in production. With the microphone muted and
`autoGainControl` on, the noise floor ended up above the threshold (passed the
gate) and below what Whisper recognises as speech (it hallucinated). Speech has
bursts above the segment's own floor; noise is flat. That's why we compare
against the segment's median, and why `autoGainControl` is **off** on the
microphone — it was what inflated the floor.

The count of active frames is **absolute**, not proportional: a short sentence
in a 3-minute segment has to survive.

### Cross-channel dedupe is asymmetric, and has to be

`shared/dedupe.ts`. When in doubt, it discards the **microphone** line. The
system channel is clean by construction (loopback of the output device), so it's
the source of truth about what the others said. Reversing this would delete
legitimate remote speech and keep echo labelled as "Me".

It runs in `assembleTranscript`, not when the segment arrives, because it needs
both channels. Since reassembly is done from scratch, it's idempotent.

### The hallucination filter is scoped per request

`main/hallucination.ts`. Repetition within a segment is a sign of
hallucination; the same phrase reappearing over the course of an hour-long
meeting may be legitimate. Running the filter over the whole transcript would
delete real conversation.

Repetition only counts as suspicious in **long** text (≥25 chars): real speech
repeats "Uh-huh." and "Yeah." all the time.

### Never pass `language` to transcription

The parameter **doesn't filter the audio** — it tells the model the language of
the *output*. Whisper was trained on both transcription and translation, so
specifying a language different from the one spoken pushes it to translate.
Observed in production: a meeting in Portuguese retranscribed with
`language: 'en'` came back **partially translated**
(*"O Dime que mandou mensagem, ele trabalha aqui junto comigo"* →
*"Dimi, who sent the message, works here with me"*), 40 lines in English and
154 in Portuguese in the same transcript. A half-translated record is useless,
and it looks legitimate enough to go unnoticed.

Automatic detection was already getting it right on its own, and it's per
request — which makes bilingual meetings work naturally. The selector was
removed from Settings; if detection ever gets it wrong persistently, the remedy
is per meeting, never a global setting that `Retranscribe` would apply
retroactively to old recordings.

`meta.language` is a **record of what was detected**, not an input. Nothing
should overwrite it with a preference.

### A silent segment goes to disk, not just to the bin

`src/main/meetings.ts`. The early `return` skips the API call, but the file is
written before that. That's what keeps `Retranscribe` as a way out.

### The discard confirmation exists in two places, and has to

`src/main/index.ts`. With `closeToTray` on, the X only hides the window and
nothing is lost — `before-quit` does the confirming. With it off, the X quits,
and the confirmation has to come from the `close` handler, **before** the
window is destroyed. Leaving it only in `before-quit` would be too late: the
renderer doing the recording would already be dead, and cancelling would leave
the app alive with no window at all.

### The limit that breaks long meetings is the account's TPM, not the model's context

`src/main/tokenBudget.ts`. A real 98-minute meeting failed with
`429 Request too large for gpt-4o ... tokens per min (TPM): Limit 30000,
Requested 31406`.

The app had a safety valve for long transcripts — `MAX_TRANSCRIPT_CHARS`, 240k
chars — but it was calibrated against gpt-4o's **context window** (128k
tokens). The 240k chars are ~63k tokens, more than **twice** the account's 30k
ceiling. The valve could never fire before the 429.

Two non-obvious consequences:

1. **Shrinking the request isn't enough.** Condensation splits the text into
   parts and used to send them with `Promise.all`. Two 15k-token parts each fit
   on their own under a 30k ceiling and blow it together — the safety valve
   became just another way to fail. That's why `TpmGate` exists, spacing the
   calls over a 60s sliding window. **Don't swap the sequential loop in
   `condenseTranscript` for `Promise.all`.**
2. **Not every 429 is worth retrying.** "Request too large" will never pass on
   a new attempt, and the SDK's `maxRetries: 3` only delayed the error.
   `isRequestTooLarge` separates the two cases.

`CHARS_PER_TOKEN_PTBR = 3.8` is **measured**, not estimated: the API reported
31,406 tokens for a 121,462-char prompt in Brazilian Portuguese. Using the
English figure (~4.0) would underestimate the prompt by ~3% — exactly the
margin that overflowed.

### Condensation cuts with overlap, and that isn't slack

`CHUNK_OVERLAP_CHARS = 2_000` in `main/openai.ts`. The previous version cut at
line boundaries with no overlap at all, and a commitment stated across the cut
got lost: one part saw *"I'll close this out with legal"* without the deadline,
the other saw *"by Friday"* without the subject. Neither recorded the item.

The symptom is **silently incomplete** minutes, and only in long meetings —
which is when condensation kicks in and nobody is in a position to check.
Idea borrowed from Meetily, which uses a 100-token overlap.

Consequences when changing it:

- The overlap is capped at `size / 4`. If it reached `size`, the advance would
  be zero and the loop would never end.
- A line longer than the chunk is emitted whole, overshooting the target on
  purpose — cutting it in the middle would destroy the turn.
- The repeated stretch appears in two condensations. `CHUNK_SYSTEM` warns the
  model about this; **don't remove that paragraph** thinking it's redundant.

### The minutes' time anchors depend on two places

Rule 9 of `SUMMARY_SYSTEM` says to anchor each action item to the `[mm:ss]` at
which it was taken on, copied from the transcript — never computed. That's what
makes the minutes auditable, and it's the practical defence of rule 7 (don't
fabricate commitments).

This only works because `transcriptToText` and `interleaveNotesAndTranscript`
prefix **every** line with `[mm:ss]`. If someone ever removes the prefix to
save tokens, rule 9 dies silently.

The second place is `CHUNK_SYSTEM`: it tells the model to preserve the
timestamps when condensing. Without that, anchoring would work in short
meetings and vanish in long ones — the worst kind of failure, because it
vanishes exactly where it's hardest to notice.

Verified on a real 45-minute meeting: 5 action items, 5 anchors, all matching
an existing moment in the transcript.

### `chromiumFetch` is mandatory, not an optimisation

`src/main/chromiumFetch.ts`. Without it, no call to OpenAI works behind a proxy
with TLS inspection. The two internal workarounds (buffering the body, removing
`content-length`) were verified against the real API — changing them requires
re-verifying. See section 4.

### Speaker labels are stored in Portuguese, on purpose

`SELF_SPEAKER = 'Eu'` and `OTHERS_SPEAKER = 'Outros'` (`shared/types.ts`) are
**data values** written to `transcript.json`, not display text. They are
translated only at display time (`channelLabel()` in `shared/transcript.ts`,
via `msgs().system.speakers`). Changing them to `'Me'`/`'Others'` would orphan
every existing meeting: the renamed-speaker map, the voice profiles and the
"is this me?" checks all compare against the stored value. `channelLabel()`
also accepts `'Others'` for safety.

### Every string lives in both catalogs

`src/shared/i18n/` has four namespaces (`ui`, `settingsUi`, `main`, `system`).
The `en` object defines the shape and `pt` is typed `typeof en`, so a key missing
in one language is a type error — keep it that way, don't loosen it with
`Partial`. Strings are read through `msgs()` **at call time**, never captured in
a module-level constant, or they freeze in whatever language was active at
import.

The main process resolves the language (`resolveLang(pref, app.getLocale())`)
inside `getPublicSettings()`, which is the **first** call in `whenReady` —
before the tray menu and dialogs build their strings. Moving it later gives a
Portuguese tray in an English app.

### The prompts are two full sets, not a translation layer

`PROMPTS.en` and `PROMPTS.pt` in `src/main/prompts.ts`, read via
`summarySystem()`, `titleSystem()`, `chunkSystem()`. The `pt` set is
byte-identical to the prompts that were tuned against real meetings; the minutes
come out in the app's language. Tune each language on its own — a word-for-word
change copied across usually makes one of them worse.

### The `language` settings key was reused

It used to be the (removed) transcription language; now it's the UI preference
`auto`/`en`/`pt`. `dropObsoleteLanguage()` in `settings.ts` only drops values
that aren't valid preferences. Putting `language` back into `OBSOLETE_KEYS`
erases the user's choice on every startup — that bug shipped once.

### The API key is never stored in plain text

`settings.ts` encrypts with `safeStorage` (Windows DPAPI). If encryption is
unavailable, saving **throws** instead of falling back to plain text, and a
legacy `apiKeyPlain` is migrated to the encrypted form on read. The renderer
never receives the key. Don't add a "fallback" for convenience — it's the
first thing a security review of a public repo looks for.

### Meeting IDs are validated before they become a path

Everything that turns an ID from the renderer into a folder goes through
`dirOf()` in `store.ts`, which rejects anything not matching `isMeetingId`
(`/^[0-9A-Za-z-]{1,80}$/`). Segment indexes and sources go through
`assertSegment()`. Any new IPC handler that touches disk must use them — a raw
`join(meetingsDir(), id)` reopens path traversal (`..\..\`).

### The window is sandboxed and can't navigate

`sandbox: true`, `contextIsolation: true`, no `nodeIntegration`; `will-navigate`
is blocked except for the dev server; `setWindowOpenHandler` only hands
`http(s)` URLs to `shell.openExternal` (a `file:` URL there would run local
programs). The preload may only use `contextBridge` and `ipcRenderer`.

### Electron fuses are locked in the executable

`electronFuses` in `electron-builder.yml`: no `ELECTRON_RUN_AS_NODE`, no
`NODE_OPTIONS`, no `--inspect`, cookie encryption on, app loaded only from an
`app.asar` whose integrity is checked. Consequences for maintenance:

- The **packaged** `Yogurt.exe` can't be used as a Node runtime for scripts —
  `ELECTRON_RUN_AS_NODE=1` just opens the app. Use the dev `electron.exe`.
- Editing files inside `resources\app.asar` after the build breaks the
  integrity check and the app won't start. Rebuild instead.

### The icon is embedded by our own hook

Because `signAndEditExecutable: false` (section 1), electron-builder doesn't
touch the `.exe` resources. `build/afterPack.cjs` runs `rcedit` to embed
`build/icon.ico` and the version metadata. Without it, the `.exe` and the
desktop shortcut show Electron's default icon. The window and tray icons come
from `resources/icon.png` at runtime, separately.

### Long errors must not push the tabs off-screen

Error alerts in the meeting view use `.alert-compact` (two lines with
`-webkit-line-clamp`) plus **View details**, which writes the full text to
`errors.txt` in the meeting folder and opens it (`meeting:openErrorReport`).
A full error in the alert pushed the tabs and the `…` menu below the fold,
making *Regenerate summary* unreachable. API errors are translated first by
`friendlyError()` in `main/apiErrors.ts` (no credits, bad key, rate limit,
outage, connection).

---

## 3. Tuning knobs

If behaviour X is wrong, the constant is here.

| Symptom | Constant | File | Value |
| --- | --- | --- | --- |
| Skips quiet speech, or transcribes silence | **now user-adjustable** in Settings → Audio (microphone sensitivity) | — | default `-40` dBFS |
| Range/default of the microphone cut-off | `MIC_THRESHOLD_MIN_DB`, `MAX`, `DEFAULT_MIC_THRESHOLD_DB` | `shared/types.ts` | `-60`, `-12`, `-40` |
| Dynamic criterion and minimum speech duration | `FLOOR_MARGIN`, `MIN_ACTIVE_FRAMES`, `ABS_SILENCE_RMS` | `renderer/src/audio/AudioEngine.ts` | `3`, `12`, `0.01` |
| Microphone echo survives, or real speech is discarded | `WINDOW_SEC`, `SIMILARITY` | `shared/dedupe.ts` | `8`, `0.6` |
| Hallucination gets through, or real speech is filtered | `MIN_REPEAT_*`, `BLOCK_UNIFORMITY` | `main/hallucination.ts` | `25`/`3`, `0.7` |
| Transcript truncated at the end of the block | `MAX_SEGMENT_MINUTES_DIARIZED` | `shared/types.ts` | `3` |
| Minutes fail with 429 in a long meeting | **adjustable** in Settings → Meeting → TPM | `shared/types.ts` | default `30_000` |
| Minutes condense earlier than necessary | `BUDGET_FRACTION` | `main/tokenBudget.ts` | `0.7` |
| Token estimate is off for Brazilian Portuguese | `CHARS_PER_TOKEN_PTBR` | `main/tokenBudget.ts` | `3.8` (measured) |
| Retranscribing a long meeting gets 429s | `TRANSCRIBE_CONCURRENCY` | `main/pool.ts` | `4` |
| Maximum segment without diarization | `MAX_SEGMENT_MINUTES` | `shared/types.ts` | `10` |
| Suggests stopping during the meeting | `RELEASE_DEBOUNCE_MS` | `main/micWatcher.ts` | `25_000` |
| Meeting detection too slow | `POLL_MS` | `main/micWatcher.ts` | `5_000` |
| Transcript choppy or in walls of text | `DEFAULTS` (coalesce) | `shared/transcript.ts` | gap 1s, 40s, 120 words |
| Note aligned to the wrong stretch | `maxTurnSec` in `interleave` | `main/prompts.ts` | `15` |
| Commitment lost at the boundary between two parts | `CHUNK_OVERLAP_CHARS` | `main/openai.ts` | `2_000` |
| Voice clip too short/long | `IDEAL_CLIP_SEC`, `MIN_CLIP_SEC` | `renderer/src/views/SpeakerPanel.tsx` | `5`, `2` |
| Unrealistic cost estimate | `DIARIZE_MULTIPLIER` | `main/costs.ts` | `2` |
| Note timestamp lags behind | `NOTES_SAVE_DEBOUNCE_MS` | `renderer/src/hooks/useRecorder.ts` | `800` |

**The tone and format of the minutes** live in `src/main/prompts.ts`
(`PROMPTS.en` / `PROMPTS.pt`). For company vocabulary without editing code, use
*Instructions for the summary* in Settings.

---

## 4. How to verify a change

The pattern that worked in this project: **for anything involving the API, the
operating system or audio, verify empirically before believing it.** Estimates
and code reading got it wrong several times here.

### Transport to OpenAI (after touching `chromiumFetch` or upgrading the SDK)

Write a probe that runs in the main process, with a fake key. **401 is
success** — it means the request arrived and was rejected only because of the
key. A network error is a regression.

Test all four paths: whisper `verbose_json`, diarize `diarized_json`, diarize
with `known_speaker_*`, and chat completions. The first two `chromiumFetch`
workarounds only showed up in that test.

⚠️ Check which version `require` resolves. An `npm install openai@X` with
`package.json` declaring a different range leaves the old one at the top level
and nests the new one — the probe tests the wrong one and passes. Check
`(Get-Content node_modules/openai/package.json | ConvertFrom-Json).version`.

### Pure logic (coalesce, note alignment)

Compile the real module and test it with real data, without reimplementing it:

```powershell
npx tsc src/shared/notes.ts --outDir <tmp> --module commonjs --target ES2022 --skipLibCheck
node <tmp>/teste.cjs
```

Note alignment has 10 cases worth keeping: progressive typing, later
correction, insertion in the middle, removal, reordering, duplicates.

A pattern that worked for the newer modules: copy the `.ts` to the project
root, append the test at the end of the file, bundle with
`npx esbuild <file>.ts --bundle --platform=node --alias:@shared=./src/shared`
and delete the copy. The alias is needed because the scratchpad is outside the
project and resolves neither `node_modules` nor the tsconfig paths.

Coverage that exists today: `pool.ts` (8 cases), `tokenBudget.ts` (13), model
catalogue + migration (18).

### Waiting and the TPM budget (`tokenBudget.ts`)

**Inject the clock *and* the wait.** A fake `sleep` with a real clock turns the
wait into a busy-wait loop: time never advances enough for the window to free
up. That's how a test reported "slept 14,291,846,803,253 ms" — the loop had
spun ~240 million times. The defect was real (a loop with no cap), and it only
surfaced because the absurd number caught someone's eye.

Cases that matter: a single request above the ceiling **goes through**
(otherwise it would hang forever waiting for a window that never frees up); two
parts that fit on their own and overflow together **wait for a window**; a
short meeting **never** waits.

### Bounded concurrency (`pool.ts`)

Check the **peak** number of simultaneous executions, not the average, and that
a slow item doesn't block the fast ones — that's what distinguishes the pool
from splitting into fixed batches, where a batch only moves on when its slowest
item finishes.

### Microphone detection

A second Electron process holds `getUserMedia`, and the **packaged** Yogurt
watches. Use `loadFile` with real HTML — a `data:` URL isn't a secure context
and `navigator.mediaDevices` doesn't even exist there (that false negative has
already cost time).

`micWatcher` logs `[micWatcher] microphone in use by: …` and
`[micWatcher] microphone free; …`.

### Window and tray behaviour

```powershell
$w = Get-Process electron | Where-Object { $_.MainWindowTitle } | Select-Object -First 1
$w.CloseMainWindow()
# closeToTray=true  -> processes > 0, visible windows = 0
# closeToTray=false -> processes = 0
```

### Colour contrast

Pastel pink fools the eye: it looks legible and isn't. Compute the WCAG ratio of
the foreground/background pairs, measuring against `--bg-active` (`#f6dde7`),
the darkest background in the interface. The first palette failed 4 pairs,
including the link pink.

Targets: **4.5:1** for text, **3:1** for fills carrying white text.

### Both languages (after adding or changing any string)

Run a second copy with `--remote-debugging-port` (section 1), switch
Settings → Meeting → App language, and read `document.body.innerText` of each
screen over CDP. Look for leftovers of the other language — the types catch a
missing key, not a hard-coded string in a component.

### Screenshots and demo GIF (`docs/images/`)

Generated from a throwaway profile (`--user-data-dir`) filled with a
**fictional** meeting, window at 1280×800, captured over CDP
(`Page.captureScreenshot`). Never use a real meeting or a real key for public
images. The GIF uses a 256-colour palette **per frame**; a shared palette washes
out the pinks. LinkedIn doesn't animate GIFs — use a screen recording there.

---

## 5. Diagnostics

### Where the data is

`%APPDATA%\Yogurt\` — readable files, on purpose. Inspect them directly.

```
settings.json                    preferences + encrypted key (DPAPI)
meetings/<id>/meta.json          status, duration, offsets, speaker names,
                                 blockIssues (truncated or failed blocks)
meetings/<id>/notes.md           note text
meetings/<id>/notes.timeline.json  note timestamps
meetings/<id>/transcript.json    lines with timestamps, channel and speaker
meetings/<id>/summary.md         the minutes
meetings/<id>/audio/seg-NNNN-{mic,system}.webm
```

Meetings from before channel separation have `seg-NNNN.webm` with no suffix.
The parsing in `retranscribe` recognises both formats.

### Where the logs are

Renderer errors (including `unhandledrejection`) are forwarded to the main
process console. Running via `npm run dev`, they show up in the terminal. In the
packaged app, redirect the output:

```powershell
Start-Process "release\win-unpacked\Yogurt.exe" -RedirectStandardOutput "$env:TEMP\yg.log" -RedirectStandardError "$env:TEMP\yg-err.log"
```

Useful lines: `[openai] diarization block N: … output tokens`,
`[micWatcher] …`, `[meetings] segment N:channel is silent…`,
`[openai] long transcript (N chars): condensing into N part(s)`,
`[openai] account reported a TPM of N`, `[tpm] wait exceeded the cap`,
`[settings] minutes model migrated from gpt-4o to gpt-5.6-luna`.

The condensation line is the most useful signal in a long meeting: if it
appears, the prompt didn't fit under the TPM ceiling and the notes **lost**
their fine-grained alignment.

A render error shows the error screen with a stack trace instead of a black
screen (`ErrorBoundary`).

### Careful when inspecting with PowerShell

Two gotchas that produced false diagnoses:

- **`-join ','` with a pt-BR locale** splits floats at the decimal comma:
  `240003.19999992847` became `240003,199999928`, which I read as a corrupted
  value. For numeric data, read the raw JSON.
- **`/c/...` paths** work in bash but not in Python/Node called from it. Use
  native Windows paths.

---

## 6. Cost model

All transcription rates are **identical** — `whisper-1`,
`gpt-4o-transcribe` and `gpt-4o-transcribe-diarize` cost $0.006/min at list
price. The chosen model doesn't change the bill; **the number of channels
does.**

With speaker identification on, the "Transcription" setting governs only the
microphone channel; the system channel uses the diarization model regardless.

| | without identification | with identification |
| --- | --- | --- |
| microphone | whisper-1 | whisper-1 |
| system | whisper-1 | diarize |
| transcription | $0.012/min | $0.012/min (list) |

**Measured in real use: ~$1.15/hour**, against ~$0.78 predicted by the list
rate. Reconciliation points to the diarized channel running at ~2× the
published rate — the $0.006/min assumes normal cadence, and `diarized_json`
spends output on `speaker`/`start`/`end` for every line. That's why
`DIARIZE_MULTIPLIER = 2` exists in `main/costs.ts`.

Transcription is ~92% of the bill. Switching the minutes to `gpt-4o-mini` saves
~$0.05/hour — the money is in the audio minutes.

**The minutes model matters more for its TPM than for its price.** Since
`gpt-5.6-luna` was adopted, the choice of model carries two effects, and the
second is the one that matters:

| | gpt-4o | gpt-5.6-luna |
| --- | --- | --- |
| TPM (first tier) | 30,000 | 200,000 |
| Meeting that fits without condensing | ~94 min | ~10 h |
| Price per 1M tokens | $2.50 / $10.00 | **not filled in** |

Condensing isn't neutral: it preserves the content but **undoes the
fine-grained alignment of the notes** — `interleaveNotesAndTranscript` no longer
applies and the prompt stops announcing the notes as interleaved. In other
words, a low TPM ceiling degrades precisely the app's core feature. See
`shared/models.ts`.

**Expensive actions:** `Retranscribe` resends all the audio (for a 1-hour
meeting it costs the same as recording it again). `Regenerate summary` costs
~$0.055 per hour of meeting. Both show the estimated cost in the menu and ask
for confirmation.

---

## 7. Open items and unverified paths

An honest list of what exists but has never been exercised in real use.

**Never tested with real data:**

- **A full English meeting end to end** (recording → transcription → English
  minutes). The English UI and prompts were checked, the pipeline wasn't —
  this is why v0.5.0 shipped as a *pre-release*.
- The tray menu under Electron 45 (mic, system loopback, `MediaRecorder` and the
  proxy transport were re-verified after the upgrade; the tray wasn't).

- The start/stop suggestion banner in the interface. The main process emits the
  event (verified via logs); that the banner appears and the buttons work, not.
- The confirmation dialogs with cost, and the dropdown opening and being
  positioned correctly.
- The NSIS flow: installing **over** a previous version. The configuration was
  reviewed (`perMachine: false`, data in `%APPDATA%\Yogurt` outside the program
  directory, therefore preserved), but the installer has never been run over an
  existing installation.

**Verified with real data (wasn't before):**

- **Long meeting.** A tester recorded **98 min** (33 segments, 66
  transcriptions, 2,118 lines).
- **Voice profile cycle across blocks.** The saved reference matched in **27 of
  33 blocks (82%)** in that meeting. It's the first measurement of the
  mechanism, and it's the data that supports the idea of chaining references.
- **Diarized block truncation: doesn't occur at 3 min.** All 33 blocks of the
  system channel covered **100% of the 180s**. The detection still has never
  fired — and now we know that's because the problem doesn't exist in this
  configuration, not because the detection is broken.

**Calibrated by reasoning, not by measurement:**

- The silence thresholds (`ABS_SILENCE_RMS`, `FLOOR_MARGIN`,
  `MIN_ACTIVE_FRAMES`) were tuned **against a real failure case**, but not
  swept. `meta.json` now stores `audioLevels` with each segment's peak, floor
  and active time — that's the data for calibrating by measurement instead of
  opinion.
- **Non-repeated hallucination gets through.** A single invented line, with no
  known artefact, is indistinguishable from real speech for the filter. In the
  reference recording one was left over (`"Legionials, que estão
  trabalhando…"`). The primary defence is not sending audio with no speech.
- `MAX_SEGMENT_MINUTES_DIARIZED = 3`. Chosen conservatively based on a token
  estimate that did **not** hold up — twice. In the 98-minute meeting, the 33
  blocks of the system channel covered 100% of the audio. **The evidence today
  points to increasing it**, not decreasing: 4 or 5 min are probably safe, and
  each increase proportionally reduces label fragmentation (105 labels across
  33 blocks). What's missing is measuring the real `usage.output_tokens` of a
  dense block before changing it.

**Improvements mapped out but not done:**

- **Cutting silence *within* a segment.** Today we only skip segments that are
  entirely silent. Since billing is by duration, removing the pauses would
  shorten the bill in the same proportion — in a meeting where you talk 20% of
  the time, the microphone channel has ~80% silence in short pauses that the
  current check doesn't catch. It requires an original→compressed time map,
  because notes and channel interleaving depend on the timestamps.
- **Chaining voice references within the same meeting.** Anonymous labels are
  scoped per request, so the `A` in block 1 may not be the one in block 2.
  Extracting clips from the first block and passing them as
  `known_speaker_references` to the following ones would stabilise the labels
  already in the first meeting. Limit of 4 speakers.

  **Now it has an empirical basis:** in the 98-minute meeting the saved
  reference matched in 27 of 33 blocks (82%). It's the highest return-on-effort
  path left for the speaker problem — and it costs not a single byte of
  installer. Compare with the home-grown local clustering, which stayed at
  60–70% *per pair* (branch `falantes-mfcc`, do not merge).
- **Real cost accounting per meeting.** Partially done: `blockIssues` in
  `meta.json` already stores `outputTokens` and coverage for problem blocks.
  What's missing is storing input and output for **every** call, including the
  successful ones — that's what would make cost visible per meeting and make it
  obvious when a `Retranscribe` doubled the spend.
- **Price of `gpt-5.6-luna` (and of `sol`/`terra`).** `usdPerMillion: null` in
  `shared/models.ts`. It falls back to a conservative ceiling (gpt-4o's price,
  the most expensive) and the interface says "up to US$ X" instead of
  pretending to estimate. Just fill in the real rate per 1M tokens.
- **Diarization of people sharing the same microphone.** Two people in a room on
  the same device both count as "Me".
- **Code signing.** The installer isn't signed; SmartScreen warns. With a
  certificate, `win.certificateFile` in `electron-builder.yml` — and then
  `signAndEditExecutable: false` and `build/afterPack.cjs` can go (turn on
  Developer Mode to warm the `winCodeSign` cache).
- **Other AI providers.** Discussed and deliberately **not done** for now. The
  cheap path, if testers ask: a *base URL* setting next to the key, since the
  code uses the OpenAI SDK and Azure OpenAI, Groq (Whisper), OpenRouter and
  Ollama (minutes only, locally) accept the same API. Cost: small. Limitation:
  speaker identification (`gpt-4o-transcribe-diarize`) is OpenAI-only, so other
  providers fall back to "Me / Others". The expensive path — per-provider
  adapters for Deepgram/AssemblyAI (which do diarize) — means a different
  speaker format, per-provider error translation (`apiErrors.ts` only knows
  OpenAI's) and per-provider pricing. Do that only for one provider, on demand.
- **macOS** was evaluated and dropped: no system-audio loopback without a
  virtual device, and no Mac to build or test on.

---

## 8. Traps already paid for

Symptom → real cause. All of them cost time in this project.

| Symptom | Cause |
| --- | --- |
| I can't type in any field | `window.confirm` stole focus and didn't give it back |
| `TypeError: … reading 'whenReady'` | `ELECTRON_RUN_AS_NODE=1` inherited from VSCode |
| Build talks about `libcrypto.dylib` | macOS symlinks in `winCodeSign`, without the privilege |
| Build fails after it used to work | Running app locks the file |
| `diarized_json` rejected by the type | Old SDK at the top level, new one nested |
| `getUserMedia` doesn't exist | A `data:` URL isn't a secure context |
| Mic detection doesn't see the other app | In dev, both are `electron.exe` |
| "Corrupted" offsets in meta | PowerShell's `-join` splitting floats under the pt-BR locale |
| Diarization "flickering" every 0.2s | Real overlapping speech, captured correctly |
| Settings button out of theme | `replace_all` with a pattern that required `}` on the next line |
| Colours look legible but fail | Pastel pink on cream doesn't get past ~3:1 |
| Transcript in Welsh, or a phrase repeated 14× | Whisper hallucinates on silence; the silence gate let it through |
| Other people's speech labelled as "Me" | Speakers: the microphone picks up the echo, `echoCancellation` isn't enough |
| Conversation appears twice in the transcript | Same cause; 62% of the microphone channel was echo |
| Minutes fail with 429 in a long meeting | The **account's** TPM ceiling (30k on gpt-4o), not the model's window |
| The safety valve never fires | It was calibrated against the context (128k), and the TPM (30k) bites first |
| I fixed the size and the 429 came back | Parts that fit on their own overflow together in the same 1-min window |
| Retranscribing a long meeting fails en masse | `Promise.allSettled` over 120 files blows the RPM |
| Incomplete-block warning disappears | It only existed as an event, and the only listener was the recording screen |
| New model billed as gpt-4o | `if (model.includes('mini'))` classified everything else as gpt-4o |
| Adding a field broke two files | `CostEstimate` was declared three times |
| Minutes condense unnecessarily | TPM is **per model**; it was a global setting |
| Two artefacts with the same version | I repackaged `win-unpacked` without bumping the version of the already-built `setup.exe` |
| `.exe` and shortcut with Electron's icon | `signAndEditExecutable: false` skips resource editing → `afterPack.cjs` |
| "Credits ran out" shown as a raw JSON error | The OpenAI error went straight to the UI → `friendlyError()` |
| Can't reach the `…` menu after an error | A long error in the alert pushed the tabs down → compact alert + `errors.txt` |
| Language choice lost on every restart | `language` was still in `OBSOLETE_KEYS` from the old audio setting |
| "Maximum call stack size exceeded" on every meeting | A replace-all turned `dirOf`'s body into `return dirOf(id)` |
| `npm install` exits 1 after upgrading Electron | The Electron binary download (postinstall) also needs `NODE_OPTIONS=--use-system-ca` |
| Test copy closes instantly | Single-instance lock held by the installed Yogurt → `--user-data-dir` |
| `ELECTRON_RUN_AS_NODE` script opens the app | The fuse works as intended; use the dev `electron.exe` |

Two general lessons that kept repeating:

**Verify before asserting.** I was about to answer "OpenAI doesn't do
diarization" from memory — it exists, and does exactly what was needed. And I
gave a "transport re-validated" that tested the wrong SDK version.

**Not every strange behaviour is a bug.** The "flickering" diarization and the
"corrupted" offsets were correct; the defect was in the presentation and in my
inspection tool. "Fixing" the first would have destroyed good information.

---

## 9. Releasing

1. Bump `version` in `package.json`.
2. `npm audit` (0 vulnerabilities), `npm run typecheck`, `npm run dist`.
3. Smoke-test `release\win-unpacked\Yogurt.exe` with an isolated profile:
   icon, both languages, a short recording, minutes.
4. `Get-FileHash release\Yogurt-<version>-setup.exe` and put the SHA-256 in
   the release notes.
5. GitHub → Releases → *Draft a new release*, tag `v<version>`, attach the
   installer. Mark it **pre-release** while something in section 7 is untested.

The public repository started from a fresh history (v0.5.0): no test keys, no
internal names, no screenshots of real meetings. Keep it that way — check
`git diff --cached` for keys, `%APPDATA%` paths and real names before pushing.

### Version history

- **0.5.0** — first public release. English and Portuguese (UI, dialogs, tray
  and minutes; follows the Windows language), Electron 33 → 45, sandboxed
  window, locked fuses, validated IPC, key always encrypted, friendly API
  errors, compact error alerts with *View details*, custom `.exe` icon, MIT
  license, README with demo GIF and screenshots, issue templates.
- **0.4** — custom icon, friendly "credits ran out" message, compact error
  alerts.

import type { AudioSource } from '@shared/types'
import { msgs } from '@shared/i18n'

/**
 * Captures the microphone and system audio (loopback) and records each into
 * **separate files**, in independent segments.
 *
 * Why separate rather than mixed: the microphone channel is, by construction,
 * always the person using the app. Keeping the channels apart gives that
 * attribution for free — without relying on diarization, without spending one
 * of the API's 4 voice references, and with no chance of getting it wrong. The
 * system channel ends up containing only the remote participants, which also
 * makes it easier to tell them apart.
 *
 * Why segments: the Whisper API has a 25 MB limit per file, and transcribing as
 * the meeting happens leaves the transcript nearly done when you click stop.
 * Each segment is a complete WebM file, decodable on its own — which is why we
 * rotate the whole MediaRecorder instead of slicing the stream with
 * `timeslice` (the subsequent chunks would lack the EBML header and Whisper
 * would reject them).
 *
 * Both recorders rotate together, on the same tick, and share the time
 * bookkeeping — that is what keeps the two channels' timestamps aligned when
 * the transcripts are interleaved.
 */

export interface AudioEngineConfig {
  segmentMs: number
  captureMic: boolean
  captureSystem: boolean
  micGain: number
  systemGain: number
  /**
   * Microphone sensitivity cut-off, in linear RMS, calibrated by the user.
   * Applied only to the microphone channel: that is where the room's noise
   * floor varies from machine to machine. The system channel is a loopback of
   * the output device, and the dynamic criterion handles it.
   */
  micThresholdRms: number
}

export interface SegmentInfo {
  index: number
  startMs: number
  durationMs: number
  source: AudioSource
  /**
   * Analysis of the segment's audio. Decides whether a transcription call is
   * worth spending — a silent channel costs the same as one full of speech —
   * and is persisted in `meta.json` so the decision can be audited later.
   */
  stats: SegmentAudioStats
}

export interface AudioEngineHandlers {
  /** A segment from one of the channels has closed and is ready to upload. */
  onSegment: (blob: Blob, info: SegmentInfo) => void
  /** Levels 0..1 for the meters, ~30x per second. */
  onLevels: (mic: number, system: number) => void
  /** System capture could not be started; carries on with the microphone only. */
  onSystemUnavailable: (reason: string) => void
  /** The user stopped the sharing through the OS itself. */
  onSystemEnded: () => void
}

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']

function pickMimeType(): string {
  for (const mime of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(mime)) return mime
  }
  return ''
}

/**
 * Speech detection by **structure**, not by peak.
 *
 * The first version compared the RMS peak against a fixed threshold of 0.005
 * (~-46 dBFS) and failed in a specific way in a real recording: with the
 * microphone muted, the noise floor sat *above* 0.005 — passing the gate — and
 * *below* what Whisper recognizes as speech. Result: 12 minutes of silence sent
 * to the API, which Whisper returned as hallucination (Welsh repeated 14
 * times, "You" five times).
 *
 * An absolute threshold cannot tell loud noise from quiet speech. Speech has
 * structure: bursts well above the excerpt's own floor. Noise is flat. So we
 * measure the floor (median of the samples) and count how many frames sit
 * above it by a margin — as an absolute count, not a proportion, so that a
 * single short sentence in a long segment is not discarded.
 */

/** Below this nothing is speech, whatever the structure. ~-40 dBFS. */
const ABS_SILENCE_RMS = 0.01

/** How much a frame must exceed the excerpt's floor to count as speech. */
const FLOOR_MARGIN = 3

/** Minimum active frames for the segment to be worth sending (~0.5 s of speech). */
const MIN_ACTIVE_FRAMES = 12

/**
 * Meter sampling interval. Deliberately `setInterval` and not
 * `requestAnimationFrame`: rAF depends on compositing, and stops firing when
 * the window is hidden in the tray. Since the silence measurement decides
 * whether the segment is sent, measuring with rAF would make every segment look
 * silent with the app minimized — and the whole meeting would go untranscribed.
 */
const LEVEL_INTERVAL_MS = 40

/** A capture channel, with its own audio chain and recorder. */
interface Track {
  source: AudioSource
  /** Original capture stream, kept for teardown. */
  stream: MediaStream
  gain: GainNode
  analyser: AnalyserNode
  destination: MediaStreamAudioDestinationNode
  recorder: MediaRecorder | null
  chunks: Blob[]
  /**
   * RMS samples for the current segment, reset on every rotation. Keeping them
   * all is cheap (~4,500 numbers in a 3-min segment) and makes the silence
   * decision independent of the order in which the samples arrived.
   */
  rmsSamples: number[]
}

/** Result of analysing a segment, for deciding and for diagnosing. */
export interface SegmentAudioStats {
  peak: number
  /** Estimated noise floor (median of the samples). */
  floor: number
  /** Time, in ms, with energy above the floor by a margin. */
  activeMs: number
  silent: boolean
}

/**
 * @param absFloor absolute cut-off — the user-calibrated one, for the microphone.
 */
function analyseSegment(
  samples: number[],
  frameMs: number,
  absFloor: number
): SegmentAudioStats {
  if (samples.length === 0) {
    return { peak: 0, floor: 0, activeMs: 0, silent: true }
  }

  const sorted = [...samples].sort((a, b) => a - b)
  const floor = sorted[Math.floor(sorted.length / 2)]
  const peak = sorted[sorted.length - 1]
  // The dynamic criterion still applies alongside the absolute one: in a noisy
  // room, the floor can sit above the chosen cut-off, and then it is the margin
  // over the floor that separates speech from noise.
  const threshold = Math.max(absFloor, floor * FLOOR_MARGIN)
  const activeFrames = samples.reduce((n, rms) => (rms > threshold ? n + 1 : n), 0)

  return {
    peak,
    floor,
    activeMs: activeFrames * frameMs,
    silent: activeFrames < MIN_ACTIVE_FRAMES
  }
}

export class AudioEngine {
  private config: AudioEngineConfig
  private handlers: AudioEngineHandlers

  private ctx: AudioContext | null = null
  private tracks: Track[] = []
  private mimeType = ''

  private segmentIndex = 0
  /** Offset of the current segment on the meeting's timeline, in ms. */
  private segmentStartMs = 0
  private rotateTimer: number | null = null
  private levelTimer: number | null = null

  private paused = false
  private running = false
  /** Signals the `stop` handlers that they should open a new segment. */
  private rotating = false
  /** Recorders that have not yet confirmed stopping in the current cycle. */
  private pendingStops = 0

  // Time bookkeeping that ignores paused periods, shared by both channels so
  // they do not diverge.
  private segAccumMs = 0
  private segResumeAt = 0

  private levelBuffer = new Uint8Array(1024)

  constructor(config: AudioEngineConfig, handlers: AudioEngineHandlers) {
    this.config = config
    this.handlers = handlers
  }

  get isRunning(): boolean {
    return this.running
  }

  get isPaused(): boolean {
    return this.paused
  }

  /** Duration actually recorded so far, in ms. */
  elapsedMs(): number {
    return this.segmentStartMs + this.currentSegmentMs()
  }

  private currentSegmentMs(): number {
    if (!this.running) return 0
    const live = this.paused ? 0 : performance.now() - this.segResumeAt
    return this.segAccumMs + live
  }

  async start(): Promise<void> {
    if (this.running) return

    this.mimeType = pickMimeType()
    if (!this.mimeType) {
      throw new Error(msgs().ui.audio.unsupported)
    }

    const ctx = new AudioContext()
    this.ctx = ctx
    this.tracks = []

    if (this.config.captureMic) {
      try {
        // echoCancellation on purpose: when you listen to the meeting through
        // the speakers, it removes the remote voices from the microphone channel
        // — they already arrive clean through the loopback. Without it, the "Me"
        // channel would be contaminated with other people's speech, and the
        // attribution would lose its meaning.
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            // Off on purpose. Automatic gain control raises the noise floor when
            // there is no signal — it is what let the muted microphone through
            // the silence gate. Stable gain also makes the floor-vs-speech
            // comparison reliable, and Whisper copes well with volume variation.
            autoGainControl: false
          }
        })
        this.tracks.push(this.buildTrack(ctx, 'mic', stream, this.config.micGain))
      } catch (err) {
        await this.teardown()
        throw new Error(
          msgs().ui.audio.micAccess(err instanceof Error ? err.message : String(err))
        )
      }
    }

    if (this.config.captureSystem) {
      try {
        // The main process answers with `audio: 'loopback'`; the video comes only
        // because the API requires a source, and is discarded on the next line.
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true
        })
        for (const track of stream.getVideoTracks()) {
          track.stop()
          stream.removeTrack(track)
        }

        const audioTracks = stream.getAudioTracks()
        if (audioTracks.length === 0) {
          throw new Error(msgs().ui.audio.noSystemTrack)
        }
        audioTracks[0].addEventListener('ended', () => {
          if (this.running) this.handlers.onSystemEnded()
        })

        this.tracks.push(this.buildTrack(ctx, 'system', stream, this.config.systemGain))
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        if (this.tracks.length === 0) {
          await this.teardown()
          throw new Error(msgs().ui.audio.systemCapture(reason))
        }
        this.handlers.onSystemUnavailable(reason)
      }
    }

    if (this.tracks.length === 0) {
      await this.teardown()
      throw new Error(msgs().ui.audio.noSource)
    }

    this.running = true
    this.paused = false
    this.segmentIndex = 0
    this.segmentStartMs = 0
    this.openSegment()
    this.startLevelLoop()
  }

  private buildTrack(
    ctx: AudioContext,
    source: AudioSource,
    stream: MediaStream,
    gainValue: number
  ): Track {
    // Mono destination: half the file size and better for Whisper, which
    // resamples to 16 kHz mono anyway. The stream's channel count is fixed at
    // construction — hence the constructor form, and not
    // `createMediaStreamDestination()`, whose stream always comes out stereo.
    let destination: MediaStreamAudioDestinationNode
    try {
      destination = new MediaStreamAudioDestinationNode(ctx, {
        channelCount: 1,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers'
      })
    } catch {
      destination = ctx.createMediaStreamDestination()
    }

    const gain = ctx.createGain()
    gain.gain.value = gainValue
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048

    ctx.createMediaStreamSource(stream).connect(gain)
    gain.connect(analyser)
    gain.connect(destination)

    return {
      source,
      stream,
      gain,
      analyser,
      destination,
      recorder: null,
      chunks: [],
      rmsSamples: []
    }
  }

  /** Opens a new MediaRecorder per channel, all at the same instant. */
  private openSegment(): void {
    this.segAccumMs = 0
    this.segResumeAt = performance.now()

    for (const track of this.tracks) {
      const recorder = new MediaRecorder(track.destination.stream, {
        mimeType: this.mimeType,
        audioBitsPerSecond: 48_000
      })
      track.recorder = recorder
      track.chunks = []
      track.rmsSamples = []

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) track.chunks.push(event.data)
      }
      recorder.onstop = () => this.handleStop(track)
      recorder.start()
    }

    this.scheduleRotate()
  }

  /**
   * Emits the channel's segment and, when the last recorder confirms it has
   * stopped, advances the shared bookkeeping. Advancing only on the last one is
   * what guarantees both channels get the same `index` and the same `startMs`.
   */
  private handleStop(track: Track): void {
    const blob = new Blob(track.chunks, { type: this.mimeType })
    const stats = analyseSegment(
      track.rmsSamples,
      LEVEL_INTERVAL_MS,
      track.source === 'mic' ? this.config.micThresholdRms : ABS_SILENCE_RMS
    )
    track.chunks = []
    track.rmsSamples = []
    track.recorder = null

    if (blob.size > 0) {
      this.handlers.onSegment(blob, {
        index: this.segmentIndex,
        startMs: this.segmentStartMs,
        durationMs: this.segAccumMs,
        source: track.source,
        stats
      })
    }

    this.pendingStops = Math.max(0, this.pendingStops - 1)
    if (this.pendingStops > 0) return

    this.segmentIndex += 1
    this.segmentStartMs += this.segAccumMs

    if (this.rotating) {
      this.rotating = false
      // openSegment() already reschedules the rotation.
      this.openSegment()
    }
  }

  /**
   * Schedules the rotation for the remaining *recording* time, not wall-clock
   * time — if the meeting was paused mid-segment, what was already recorded counts.
   */
  private scheduleRotate(): void {
    this.clearRotateTimer()
    const remaining = Math.max(1_000, this.config.segmentMs - this.segAccumMs)
    this.rotateTimer = window.setTimeout(() => this.rotate(), remaining)
  }

  private clearRotateTimer(): void {
    if (this.rotateTimer !== null) {
      clearTimeout(this.rotateTimer)
      this.rotateTimer = null
    }
  }

  private activeRecorders(): MediaRecorder[] {
    return this.tracks
      .map((t) => t.recorder)
      .filter((r): r is MediaRecorder => r !== null && r.state !== 'inactive')
  }

  /** Closes the current segment on all channels and opens the next one. */
  private rotate(): void {
    if (!this.running) return
    const recorders = this.activeRecorders()
    if (recorders.length === 0) return

    this.clearRotateTimer()
    this.freezeSegmentClock()
    this.rotating = true
    this.pendingStops = recorders.length
    for (const recorder of recorders) recorder.stop()
  }

  /**
   * Moves the elapsed time into the accumulator. Resets `segResumeAt` so that a
   * read of `elapsedMs()` between the freeze and the next transition does not
   * count the same interval twice.
   */
  private freezeSegmentClock(): void {
    if (!this.paused) {
      const now = performance.now()
      this.segAccumMs += now - this.segResumeAt
      this.segResumeAt = now
    }
  }

  pause(): void {
    if (!this.running || this.paused) return
    for (const recorder of this.activeRecorders()) {
      if (recorder.state === 'recording') recorder.pause()
    }
    this.freezeSegmentClock()
    this.paused = true
    this.clearRotateTimer()
  }

  resume(): void {
    if (!this.running || !this.paused) return
    for (const recorder of this.activeRecorders()) {
      if (recorder.state === 'paused') recorder.resume()
    }
    this.paused = false
    this.segResumeAt = performance.now()
    this.scheduleRotate()
  }

  /** Stops recording and returns the total recorded duration. */
  async stop(): Promise<number> {
    if (!this.running) return 0

    this.clearRotateTimer()
    this.stopLevelLoop()
    this.freezeSegmentClock()
    this.rotating = false

    const total = this.segmentStartMs + this.segAccumMs
    const recorders = this.activeRecorders()
    this.pendingStops = recorders.length

    if (recorders.length > 0) {
      await new Promise<void>((resolve) => {
        let remaining = recorders.length
        for (const recorder of recorders) {
          // Keeps the original handler (which emits the segment) and resolves
          // when the last of the channels finishes.
          const originalOnStop = recorder.onstop
          recorder.onstop = (event) => {
            originalOnStop?.call(recorder, event)
            remaining -= 1
            if (remaining === 0) resolve()
          }
          // `stop()` works from the paused state and flushes the buffer;
          // resuming first would only add audio already outside the duration count.
          recorder.stop()
        }
      })
    }

    this.running = false
    this.paused = false
    await this.teardown()
    return total
  }

  private startLevelLoop(): void {
    this.stopLevelLoop()
    this.levelTimer = window.setInterval(() => {
      let mic = 0
      let sys = 0
      for (const track of this.tracks) {
        const rms = this.readRms(track)
        // While paused nothing is recorded, so sampling would skew the analysis:
        // the pause's silence would end up in the segment's floor.
        if (!this.paused) track.rmsSamples.push(rms)
        const display = Math.min(1, Math.pow(rms * 3.2, 0.7))
        if (track.source === 'mic') mic = display
        else sys = display
      }
      this.handlers.onLevels(this.paused ? 0 : mic, this.paused ? 0 : sys)
    }, LEVEL_INTERVAL_MS)
  }

  private stopLevelLoop(): void {
    if (this.levelTimer !== null) {
      clearInterval(this.levelTimer)
      this.levelTimer = null
    }
  }

  /** Raw linear RMS of the analyser's current window. */
  private readRms(track: Track): number {
    const analyser = track.analyser
    if (this.levelBuffer.length !== analyser.fftSize) {
      this.levelBuffer = new Uint8Array(analyser.fftSize)
    }
    analyser.getByteTimeDomainData(this.levelBuffer)
    let sum = 0
    for (let i = 0; i < this.levelBuffer.length; i++) {
      const v = (this.levelBuffer[i] - 128) / 128
      sum += v * v
    }
    return Math.sqrt(sum / this.levelBuffer.length)
  }

  private async teardown(): Promise<void> {
    this.stopLevelLoop()
    this.clearRotateTimer()

    for (const track of this.tracks) {
      track.recorder = null
      track.stream.getTracks().forEach((t) => t.stop())
    }
    this.tracks = []

    if (this.ctx && this.ctx.state !== 'closed') {
      try {
        await this.ctx.close()
      } catch {
        /* context already closed */
      }
    }
    this.ctx = null
  }

  setGain(source: AudioSource, value: number): void {
    if (source === 'mic') this.config.micGain = value
    else this.config.systemGain = value
    const track = this.tracks.find((t) => t.source === source)
    if (track) track.gain.gain.value = value
  }
}

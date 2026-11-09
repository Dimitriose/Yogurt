import { useCallback, useEffect, useRef, useState } from 'react'
import {
  MIC_METER_FLOOR_DB,
  MIC_THRESHOLD_MIN_DB,
  MIC_THRESHOLD_MAX_DB,
  DEFAULT_MIC_THRESHOLD_DB,
  rmsToDb
} from '@shared/types'
import { msgs } from '@shared/i18n'

/**
 * Microphone sensitivity calibration, Discord-style.
 *
 * It exists because the silence threshold cannot be guessed: it depends on the
 * microphone, the room and how the person speaks. The first version of Yogurt
 * used a fixed value chosen by reasoning, and in a real recording it landed in
 * exactly the worst range — above the noise floor (so it did not cut) and below
 * what Whisper recognizes (so it produced hallucinations).
 *
 * Here the person speaks, watches the meter, and positions the cut-off.
 * Whatever falls below the line does not count as speech, and a segment with
 * no speech is not sent to the API.
 */

/** Same interval as AudioEngine: calibration has to measure the way it measures. */
const SAMPLE_MS = 40

/** Samples kept to estimate the noise floor (~4 s). */
const FLOOR_WINDOW = 100

/** Duration of each calibration phase, in seconds. */
const QUIET_SECONDS = 3
const SPEECH_SECONDS = 4

/**
 * Margin above the noise floor. 8 dB ≈ 2.5× in amplitude — enough to get out
 * of the noise without getting close to speech.
 */
const FLOOR_MARGIN_DB = 8

/** Minimum headroom below the measured speech. The cut-off never gets close to your voice. */
const SPEECH_HEADROOM_DB = 10

/**
 * Minimum separation between noise and speech for the measurement to count.
 * Below that there is nothing to calibrate — muted microphone, too far away, or
 * a noisy room — and suggesting a number would be worse than admitting it
 * did not work.
 */
const MIN_SEPARATION_DB = 12

interface Props {
  thresholdDb: number
  onChange: (db: number) => void
}

function toPercent(db: number): number {
  const clamped = Math.max(MIC_METER_FLOOR_DB, Math.min(0, db))
  return ((clamped - MIC_METER_FLOOR_DB) / -MIC_METER_FLOOR_DB) * 100
}

export default function MicCalibration({ thresholdDb, onChange }: Props): JSX.Element {
  const [active, setActive] = useState(false)
  const [levelDb, setLevelDb] = useState(MIC_METER_FLOOR_DB)
  const [peakDb, setPeakDb] = useState(MIC_METER_FLOOR_DB)
  const [floorDb, setFloorDb] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  /** `null` outside calibration; otherwise, the current phase. */
  const [phase, setPhase] = useState<null | 'quiet' | 'speech'>(null)
  const [countdown, setCountdown] = useState(0)
  const [result, setResult] = useState<null | {
    noise: number
    speech: number
    suggested: number
    ok: boolean
  }>(null)

  const ctxRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const timerRef = useRef<number | null>(null)
  const bufferRef = useRef<Uint8Array<ArrayBuffer>>(new Uint8Array(2048))
  const windowRef = useRef<number[]>([])
  const peakDecayRef = useRef(MIC_METER_FLOOR_DB)
  const quietRef = useRef<number[]>([])
  const speechRef = useRef<number[]>([])
  const phaseRef = useRef<null | 'quiet' | 'speech'>(null)
  const calTimerRef = useRef<number | null>(null)

  const stop = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    // Aborts the calibration in progress: without this it would finish with the
    // microphone already closed and conclude from incomplete samples.
    if (calTimerRef.current !== null) {
      clearInterval(calTimerRef.current)
      calTimerRef.current = null
    }
    phaseRef.current = null
    setPhase(null)
    setCountdown(0)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    analyserRef.current = null
    if (ctxRef.current && ctxRef.current.state !== 'closed') void ctxRef.current.close()
    ctxRef.current = null
    windowRef.current = []
    quietRef.current = []
    speechRef.current = []
    peakDecayRef.current = MIC_METER_FLOOR_DB
    setActive(false)
    setLevelDb(MIC_METER_FLOOR_DB)
    setPeakDb(MIC_METER_FLOOR_DB)
  }, [])

  // Releases the microphone when leaving the screen: leaving it open lights up
  // the Windows privacy indicator for no reason, and would confuse meeting detection.
  useEffect(() => stop, [stop])

  const start = useCallback(async () => {
    setError(null)
    try {
      // The constraints must be identical to the recording's. With AGC on here
      // and off there, the measured floor would not be the real floor, and the
      // calibration would point to the wrong number.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false }
      })
      const ctx = new AudioContext()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 2048
      ctx.createMediaStreamSource(stream).connect(analyser)

      streamRef.current = stream
      ctxRef.current = ctx
      analyserRef.current = analyser
      bufferRef.current = new Uint8Array(analyser.fftSize)
      setActive(true)

      timerRef.current = window.setInterval(() => {
        const node = analyserRef.current
        if (!node) return
        node.getByteTimeDomainData(bufferRef.current)

        let sum = 0
        for (let i = 0; i < bufferRef.current.length; i++) {
          const v = (bufferRef.current[i] - 128) / 128
          sum += v * v
        }
        const rms = Math.sqrt(sum / bufferRef.current.length)
        const db = rmsToDb(rms)
        setLevelDb(db)

        // Peak with decay: without it the meter flickers too much to be read.
        peakDecayRef.current = Math.max(db, peakDecayRef.current - 0.6)
        setPeakDb(peakDecayRef.current)

        const win = windowRef.current
        win.push(db)
        if (win.length > FLOOR_WINDOW) win.shift()
        if (win.length >= 20) {
          const sorted = [...win].sort((a, b) => a - b)
          setFloorDb(sorted[Math.floor(sorted.length / 2)])
        }

        // Driven by the ref, not by state: state reaches the interval callback
        // late and samples would land in the wrong phase.
        if (phaseRef.current === 'quiet') quietRef.current.push(db)
        else if (phaseRef.current === 'speech') speechRef.current.push(db)
      }, SAMPLE_MS)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  /**
   * Two-phase calibration: silence, then speech.
   *
   * Measuring only silence is not enough — without knowing where your voice is,
   * there is no ceiling for the cut-off. The first version did that and used
   * the 90th percentile of the quiet window as the floor, which is wrong twice
   * over: P90 captures transients instead of the floor, and if there is any
   * speech in the window it picks up the voice level. With the margin added on
   * top, the cut-off ended up **above** the speech, and nothing was recorded.
   *
   * Now the floor comes from the median of the silence (robust to transients)
   * and the speech from the 85th percentile of the spoken phase. The cut-off
   * sits between the two, with headroom on both sides.
   */
  const finishCalibration = useCallback(() => {
    const quiet = quietRef.current
    const speech = speechRef.current
    phaseRef.current = null
    setPhase(null)
    setCountdown(0)

    if (quiet.length < 10 || speech.length < 10) {
      setResult(null)
      setError(msgs().ui.mic.tooShort)
      return
    }

    const percentile = (arr: number[], p: number): number => {
      const sorted = [...arr].sort((a, b) => a - b)
      return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
    }

    // Median over the silence: represents the floor, not the peak of a keystroke.
    const noise = percentile(quiet, 0.5)
    // P85 over the speech: the spoken phase has pauses, so the median would underestimate.
    const spoken = percentile(speech, 0.85)

    const separation = spoken - noise
    if (separation < MIN_SEPARATION_DB) {
      setResult({ noise, speech: spoken, suggested: thresholdDb, ok: false })
      return
    }

    // Above the noise with a margin, and never close to speech. The ceiling wins:
    // in a noisy room it is better to let noise through — AudioEngine's dynamic
    // criterion still filters it — than to risk cutting the voice.
    const suggested = Math.round(
      Math.max(
        MIC_THRESHOLD_MIN_DB,
        Math.min(
          MIC_THRESHOLD_MAX_DB,
          spoken - SPEECH_HEADROOM_DB,
          Math.max(noise + FLOOR_MARGIN_DB, MIC_THRESHOLD_MIN_DB)
        )
      )
    )

    setResult({ noise, speech: spoken, suggested, ok: true })
    onChange(suggested)
  }, [onChange, thresholdDb])

  const startCalibration = useCallback(() => {
    if (!active) return
    setError(null)
    setResult(null)
    quietRef.current = []
    speechRef.current = []
    phaseRef.current = 'quiet'
    setPhase('quiet')
    setCountdown(QUIET_SECONDS)

    if (calTimerRef.current !== null) clearInterval(calTimerRef.current)
    calTimerRef.current = window.setInterval(() => {
      setCountdown((left) => {
        if (left > 1) return left - 1
        if (phaseRef.current === 'quiet') {
          phaseRef.current = 'speech'
          setPhase('speech')
          return SPEECH_SECONDS
        }
        if (calTimerRef.current !== null) {
          clearInterval(calTimerRef.current)
          calTimerRef.current = null
        }
        finishCalibration()
        return 0
      })
    }, 1000)
  }, [active, finishCalibration])

  const above = active && levelDb > thresholdDb
  const m = msgs().ui.mic

  return (
    <div className="mic-cal">
      <div className="mic-cal-meter">
        <div className="meter-scale">
          {/* Fill up to the current level, coloured only when above the cut-off. */}
          <div
            className={`meter-level${above ? ' above' : ''}`}
            style={{ width: `${toPercent(levelDb)}%` }}
          />
          <div className="meter-peak" style={{ left: `${toPercent(peakDb)}%` }} />
          {floorDb !== null && active && (
            <div
              className="meter-floor"
              style={{ left: `${toPercent(floorDb)}%` }}
              title={m.floorTitle}
            />
          )}
          <div className="meter-cut" style={{ left: `${toPercent(thresholdDb)}%` }} />
        </div>
        <div className="meter-ticks">
          <span>-60</span>
          <span>-45</span>
          <span>-30</span>
          <span>-15</span>
          <span>0 dB</span>
        </div>
      </div>

      <input
        className="mic-cal-slider"
        type="range"
        min={MIC_THRESHOLD_MIN_DB}
        max={MIC_THRESHOLD_MAX_DB}
        step={1}
        value={thresholdDb}
        onChange={(e) => onChange(Number(e.target.value))}
      />

      <div className="mic-cal-row">
        <span className={active ? (above ? 'pill pill-ok' : 'pill pill-warn') : 'muted'}>
          {!active
            ? m.off
            : above
              ? m.above
              : m.below}
        </span>
        <span className="muted mic-cal-nums">
          {m.cut} <strong>{thresholdDb} dB</strong>
          {active && m.current(Math.round(levelDb))}
          {active && floorDb !== null && m.floor(Math.round(floorDb))}
        </span>
      </div>

      <div className="mic-cal-actions">
        {active ? (
          <button className="btn btn-ghost btn-sm" onClick={stop}>
            {m.stopTest}
          </button>
        ) : (
          <button className="btn btn-primary btn-sm" onClick={() => void start()}>
            {m.testMic}
          </button>
        )}
        <button
          className="btn btn-ghost btn-sm"
          disabled={!active || phase !== null}
          onClick={startCalibration}
          title={m.calibrateTitle}
        >
          {phase === null ? m.calibrate : m.calibrating}
        </button>
        <button
          className="btn btn-ghost btn-sm"
          disabled={thresholdDb === DEFAULT_MIC_THRESHOLD_DB}
          onClick={() => onChange(DEFAULT_MIC_THRESHOLD_DB)}
        >
          {m.default}
        </button>
      </div>

      {phase !== null && (
        <div className="alert alert-info alert-inline cal-step">
          <strong>{countdown}</strong>
          <span>
            {phase === 'quiet'
              ? m.phaseQuiet
              : m.phaseSpeech}
          </span>
        </div>
      )}

      {result && (
        <div className={result.ok ? 'alert alert-inline cal-ok' : 'alert alert-warn alert-inline'}>
          {result.ok ? (
            <span>
              {m.resultOk.noise}
              <strong>{Math.round(result.noise)} dB</strong>
              {m.resultOk.speech}
              <strong>{Math.round(result.speech)} dB</strong>
              {m.resultOk.cut}
              <strong>{result.suggested} dB</strong>
              {m.resultOk.end}
            </span>
          ) : (
            <span>
              {m.resultFail.start}
              <strong>{Math.round(result.noise)} dB</strong>
              {m.resultFail.noise}
              <strong>{Math.round(result.speech)} dB</strong>
              {m.resultFail.end}
            </span>
          )}
        </div>
      )}

      {error && <div className="alert alert-error">{error}</div>}

      <p className="muted">
        {m.help.start}
        <strong>{m.help.floor}</strong>
        {m.help.end}
      </p>
    </div>
  )
}

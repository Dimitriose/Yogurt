import { useCallback, useEffect, useRef, useState } from 'react'
import type { Meeting, Settings, TranscriptLine } from '@shared/types'
import { dbToRms } from '@shared/types'
import { msgs } from '@shared/i18n'
import { AudioEngine } from '../audio/AudioEngine'

const NOTES_SAVE_DEBOUNCE_MS = 800

export interface RecorderState {
  meeting: Meeting | null
  isRecording: boolean
  isPaused: boolean
  elapsedMs: number
  levels: { mic: number; system: number }
  notes: string
  transcript: TranscriptLine[]
  /** Segments sent vs. already transcribed, for the progress indicator. */
  progress: { sent: number; transcribed: number }
  /** Silent segments that were not sent to the API. */
  skippedSilent: number
  warnings: string[]
  error: string | null
  /** True while main finishes the transcription and the summary. */
  isFinishing: boolean
}

export interface Recorder extends RecorderState {
  start: (title: string) => Promise<void>
  stop: () => Promise<string | null>
  togglePause: () => void
  /** Adjusts a channel's gain while recording is in progress. */
  setGain: (source: 'mic' | 'system', value: number) => void
  setNotes: (notes: string) => void
  dismissWarning: (index: number) => void
  clearError: () => void
}

export function useRecorder(settings: Settings | null): Recorder {
  const engineRef = useRef<AudioEngine | null>(null)
  const meetingIdRef = useRef<string | null>(null)
  const notesTimerRef = useRef<number | null>(null)
  const notesRef = useRef('')

  const [meeting, setMeeting] = useState<Meeting | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [levels, setLevels] = useState({ mic: 0, system: 0 })
  const [notes, setNotesState] = useState('')
  const [transcript, setTranscript] = useState<TranscriptLine[]>([])
  const [progress, setProgress] = useState({ sent: 0, transcribed: 0 })
  const [skippedSilent, setSkippedSilent] = useState(0)
  const [warnings, setWarnings] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isFinishing, setIsFinishing] = useState(false)

  // Clock and meters: a single interval, so we don't hang one rAF per piece of state.
  useEffect(() => {
    if (!isRecording) return
    const id = window.setInterval(() => {
      const engine = engineRef.current
      if (engine) setElapsedMs(engine.elapsedMs())
    }, 250)
    return () => clearInterval(id)
  }, [isRecording])

  // Partial transcript and segment errors arrive as events from main.
  useEffect(() => {
    const offTranscript = window.yogurt.events.onTranscript((id, lines) => {
      if (id === meetingIdRef.current) setTranscript(lines)
    })
    const offUpdated = window.yogurt.events.onMeetingUpdated((updated) => {
      if (updated.id === meetingIdRef.current) {
        setMeeting(updated)
        setProgress((prev) => ({ ...prev, transcribed: updated.transcribedCount }))
      }
    })
    // The message comes ready-made from main, which is what knows whether it was a failure or a truncation.
    const offSegmentError = window.yogurt.events.onSegmentError((id, _index, message) => {
      if (id !== meetingIdRef.current) return
      setWarnings((prev) => (prev.includes(message) ? prev : [...prev, message]))
    })
    return () => {
      offTranscript()
      offUpdated()
      offSegmentError()
    }
  }, [])

  /** Recording instant to assign to new lines. */
  const noteClock = useCallback((): number | null => {
    return engineRef.current?.isRunning ? engineRef.current.elapsedMs() : null
  }, [])

  const flushNotes = useCallback(() => {
    if (notesTimerRef.current !== null) {
      clearTimeout(notesTimerRef.current)
      notesTimerRef.current = null
    }
    const id = meetingIdRef.current
    if (id) void window.yogurt.meetings.saveNotes(id, notesRef.current, noteClock())
  }, [noteClock])

  const setNotes = useCallback(
    (value: string) => {
      notesRef.current = value
      setNotesState(value)
      // The timestamp is read now, not when the timer fires: with the debounce,
      // waiting would assign the line the instant the save happened.
      const at = noteClock()
      if (notesTimerRef.current !== null) clearTimeout(notesTimerRef.current)
      notesTimerRef.current = window.setTimeout(() => {
        const id = meetingIdRef.current
        if (id) void window.yogurt.meetings.saveNotes(id, notesRef.current, at)
        notesTimerRef.current = null
      }, NOTES_SAVE_DEBOUNCE_MS)
    },
    [noteClock]
  )

  const start = useCallback(
    async (title: string) => {
      if (!settings) return
      if (engineRef.current?.isRunning) return

      setError(null)
      setWarnings([])
      setTranscript([])
      setProgress({ sent: 0, transcribed: 0 })
      setSkippedSilent(0)
      setElapsedMs(0)
      notesRef.current = ''
      setNotesState('')

      const created = await window.yogurt.meetings.start(title)
      meetingIdRef.current = created.id
      setMeeting(created)

      const engine = new AudioEngine(
        {
          segmentMs: Math.max(1, settings.segmentMinutes) * 60_000,
          captureMic: settings.captureMicrophone,
          captureSystem: settings.captureSystemAudio,
          micGain: settings.micGain,
          systemGain: settings.systemGain,
          micThresholdRms: dbToRms(settings.micThresholdDb)
        },
        {
          onSegment: (blob, info) => {
            // Silent counts as sent to disk, not as transcribed — the on-screen
            // progress reflects what was sent to the API.
            if (info.stats.silent) {
              setSkippedSilent((prev) => prev + 1)
            } else {
              setProgress((prev) => ({ ...prev, sent: prev.sent + 1 }))
            }
            void blob.arrayBuffer().then((data) =>
              window.yogurt.meetings.addSegment({
                meetingId: created.id,
                index: info.index,
                startMs: info.startMs,
                durationMs: info.durationMs,
                data,
                source: info.source,
                skipTranscription: info.stats.silent,
                stats: info.stats
              })
            )
          },
          onLevels: (mic, system) => setLevels({ mic, system }),
          onSystemUnavailable: (reason) =>
            setWarnings((prev) => [
              ...prev,
              msgs().ui.recorder.systemUnavailable(reason)
            ]),
          onSystemEnded: () =>
            setWarnings((prev) => [
              ...prev,
              msgs().ui.recorder.systemEnded
            ])
        }
      )

      try {
        await engine.start()
        engineRef.current = engine
        setIsRecording(true)
        setIsPaused(false)
      } catch (err) {
        // The meeting was already created; record the error and leave the entry for the user to delete.
        meetingIdRef.current = null
        setMeeting(null)
        setError(err instanceof Error ? err.message : String(err))
        await window.yogurt.meetings.remove(created.id)
      }
    },
    [settings]
  )

  const stop = useCallback(async (): Promise<string | null> => {
    const engine = engineRef.current
    const id = meetingIdRef.current
    if (!engine || !id) return null

    flushNotes()
    setIsFinishing(true)

    try {
      const durationMs = await engine.stop()
      engineRef.current = null
      setIsRecording(false)
      setIsPaused(false)
      setLevels({ mic: 0, system: 0 })

      // The last segment is emitted inside stop(); give it a tick so the
      // matching addSegment reaches main before asking for finish.
      await new Promise((resolve) => setTimeout(resolve, 150))

      await window.yogurt.meetings.finish(id, durationMs)
      meetingIdRef.current = null
      return id
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return id
    } finally {
      setIsFinishing(false)
    }
  }, [flushNotes])

  const setGain = useCallback((source: 'mic' | 'system', value: number) => {
    engineRef.current?.setGain(source, value)
  }, [])

  const togglePause = useCallback(() => {
    const engine = engineRef.current
    if (!engine?.isRunning) return
    if (engine.isPaused) {
      engine.resume()
      setIsPaused(false)
    } else {
      engine.pause()
      setIsPaused(true)
      setLevels({ mic: 0, system: 0 })
    }
  }, [])

  const dismissWarning = useCallback((index: number) => {
    setWarnings((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const clearError = useCallback(() => setError(null), [])

  // Mirrors the state into main, which drives the tray icon, the sleep blocker
  // and the quit confirmation. The interval keeps the tooltip's timer alive
  // without dumping the 4 updates per second the screen uses.
  useEffect(() => {
    const push = (): void => {
      void window.yogurt.app.setRecordingState({
        recording: isRecording,
        paused: isPaused,
        elapsedMs: engineRef.current?.elapsedMs() ?? 0
      })
    }
    push()
    if (!isRecording) return
    const id = window.setInterval(push, 5000)
    return () => clearInterval(id)
  }, [isRecording, isPaused])

  return {
    meeting,
    isRecording,
    isPaused,
    elapsedMs,
    levels,
    notes,
    transcript,
    progress,
    skippedSilent,
    warnings,
    error,
    isFinishing,
    start,
    stop,
    togglePause,
    setGain,
    setNotes,
    dismissWarning,
    clearError
  }
}

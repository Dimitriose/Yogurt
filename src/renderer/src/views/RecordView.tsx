import { useEffect, useRef, useState } from 'react'
import type { Settings } from '@shared/types'
import { msgs } from '@shared/i18n'
import { coalesceTurns, resolveSpeaker } from '@shared/transcript'
import type { Recorder } from '../hooks/useRecorder'
import { formatClock, formatTimestamp } from '../lib/format'

interface Props {
  recorder: Recorder
  settings: Settings | null
  onStop: () => void
  onOpenSettings: () => void
}

function LevelMeter({ label, value, active }: { label: string; value: number; active: boolean }): JSX.Element {
  return (
    <div className={`meter${active ? '' : ' meter-off'}`}>
      <span className="meter-label">{label}</span>
      <div className="meter-track">
        <div className="meter-fill" style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
    </div>
  )
}

export default function RecordView({
  recorder,
  settings,
  onStop,
  onOpenSettings
}: Props): JSX.Element {
  const [title, setTitle] = useState('')
  const notesRef = useRef<HTMLTextAreaElement>(null)
  const transcriptRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  // Focuses the notes as soon as recording starts — the idea is to type without thinking.
  useEffect(() => {
    if (recorder.isRecording) notesRef.current?.focus()
  }, [recorder.isRecording])

  // Follows the transcript, but yields control if the user scrolls up.
  useEffect(() => {
    const el = transcriptRef.current
    if (el && autoScroll) el.scrollTop = el.scrollHeight
  }, [recorder.transcript, autoScroll])

  const handleTranscriptScroll = (): void => {
    const el = transcriptRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48
    setAutoScroll(atBottom)
  }

  const m = msgs().ui
  const r = m.record

  if (!settings) {
    return <div className="view view-center muted">{m.common.loading}</div>
  }

  if (!settings.hasApiKey) {
    return (
      <div className="view view-center">
        <div className="setup-card">
          <h1>{r.missingKey.title}</h1>
          <p>{r.missingKey.body}</p>
          <button className="btn btn-primary" onClick={onOpenSettings}>
            {r.missingKey.openSettings}
          </button>
        </div>
      </div>
    )
  }

  if (!recorder.isRecording && !recorder.isFinishing) {
    return (
      <div className="view view-center">
        <div className="setup-card">
          <h1>{r.start.title}</h1>
          <p>{r.start.body}</p>

          <input
            className="input input-title"
            placeholder={r.start.titlePlaceholder}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void recorder.start(title.trim())
            }}
          />

          <div className="source-summary">
            <span className={settings.captureSystemAudio ? 'on' : 'off'}>
              {settings.captureSystemAudio ? '● ' : '○ '}
              {r.start.systemAudio}
            </span>
            <span className={settings.captureMicrophone ? 'on' : 'off'}>
              {settings.captureMicrophone ? '● ' : '○ '}
              {r.start.microphone}
            </span>
            <button className="link" onClick={onOpenSettings}>
              {r.start.change}
            </button>
          </div>

          <button
            className="btn btn-record"
            onClick={() => void recorder.start(title.trim())}
          >
            <span className="rec-dot" aria-hidden="true" />
            {r.start.startRecording}
          </button>

          {recorder.error && (
            <div className="alert alert-error">
              <span>{recorder.error}</span>
              <button className="link" onClick={recorder.clearError}>
                {r.start.dismiss}
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  if (recorder.isFinishing) {
    return (
      <div className="view view-center">
        <div className="setup-card">
          <div className="spinner spinner-lg" aria-hidden="true" />
          <h1>{r.finishing.title}</h1>
          <p>{r.finishing.body}</p>
        </div>
      </div>
    )
  }

  const pending = recorder.progress.sent - recorder.progress.transcribed

  return (
    <div className="view view-record">
      <header className="record-bar">
        <div className="record-status">
          <span className={`rec-dot${recorder.isPaused ? ' paused' : ' live'}`} aria-hidden="true" />
          <span className="clock">{formatClock(recorder.elapsedMs)}</span>
          <span className="muted">
            {recorder.isPaused ? r.paused : r.recording}
            {pending > 0 && r.queued(pending)}
            {recorder.skippedSilent > 0 && r.skippedSilent(recorder.skippedSilent)}
          </span>
        </div>

        <div className="meters">
          <LevelMeter
            label={r.meterMic}
            value={recorder.levels.mic}
            active={settings.captureMicrophone}
          />
          <LevelMeter
            label={r.meterSystem}
            value={recorder.levels.system}
            active={settings.captureSystemAudio}
          />
        </div>

        <div className="record-actions">
          <button className="btn btn-ghost" onClick={recorder.togglePause}>
            {recorder.isPaused ? r.resume : r.pause}
          </button>
          <button className="btn btn-stop" onClick={onStop}>
            {r.stopAndSummarize}
          </button>
        </div>
      </header>

      {recorder.warnings.map((warning, index) => (
        <div className="alert alert-warn" key={index}>
          <span>{warning}</span>
          <button className="link" onClick={() => recorder.dismissWarning(index)}>
            {r.ok}
          </button>
        </div>
      ))}

      <div className="record-panes">
        <section className="pane pane-notes">
          <h2 className="pane-title">
            {r.yourNotes}
            <span className="pane-hint">{r.notesHint}</span>
          </h2>
          <textarea
            ref={notesRef}
            className="notes-editor"
            value={recorder.notes}
            onChange={(e) => recorder.setNotes(e.target.value)}
            placeholder={r.notesPlaceholder}
            spellCheck
          />
        </section>

        <section className="pane pane-transcript">
          <h2 className="pane-title">
            {r.transcript}
            <span className="pane-hint">
              {recorder.transcript.length === 0
                ? r.arrivesEvery(settings.segmentMinutes)
                : r.segmentsProgress(recorder.progress.transcribed, recorder.progress.sent)}
            </span>
          </h2>
          <div
            className="transcript"
            ref={transcriptRef}
            onScroll={handleTranscriptScroll}
          >
            {recorder.transcript.length === 0 ? (
              <p className="muted transcript-empty">
                {r.firstChunk(settings.segmentMinutes)}
              </p>
            ) : (
              coalesceTurns(recorder.transcript).map((line, index) => {
                const speaker = resolveSpeaker(line)
                return (
                  <p className="transcript-line" key={index}>
                    <span className="ts">{formatTimestamp(line.start)}</span>
                    {speaker && (
                      <span
                        className={`speaker-inline ${speaker.anonymous ? 'anon' : 'named'}`}
                      >
                        {speaker.label}
                      </span>
                    )}
                    {line.text}
                  </p>
                )
              })
            )}
            {!autoScroll && (
              <button className="scroll-pin" onClick={() => setAutoScroll(true)}>
                {r.follow}
              </button>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Meeting, Settings } from '@shared/types'
import { setLang, msgs } from '@shared/i18n'
import { useRecorder } from './hooks/useRecorder'
import RecordView from './views/RecordView'
import MeetingView from './views/MeetingView'
import SettingsView from './views/SettingsView'
import { formatWhen, formatDuration } from './lib/format'
import iconUrl from './assets/icon.png'

type Route =
  | { name: 'record' }
  | { name: 'meeting'; id: string }
  | { name: 'settings' }

function statusLabel(status: Meeting['status']): string {
  return status === 'ready' ? '' : msgs().ui.app.status[status]
}

export default function App(): JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [route, setRoute] = useState<Route>({ name: 'record' })
  const [search, setSearch] = useState('')

  const recorder = useRecorder(settings)

  /** Suggestion coming from microphone detection; `null` when there is none. */
  const [suggestion, setSuggestion] = useState<
    { kind: 'start'; apps: string[] } | { kind: 'stop' } | null
  >(null)

  const refreshMeetings = useCallback(async () => {
    setMeetings(await window.yogurt.meetings.list())
  }, [])

  useEffect(() => {
    void window.yogurt.settings.get().then(setSettings)
    void refreshMeetings()
  }, [refreshMeetings])

  // Any status change coming from main updates the list in place.
  useEffect(() => {
    return window.yogurt.events.onMeetingUpdated((updated) => {
      setMeetings((prev) => {
        const index = prev.findIndex((m) => m.id === updated.id)
        if (index === -1) return [updated, ...prev]
        const next = [...prev]
        next[index] = updated
        return next
      })
    })
  }, [])

  const handleSettingsSaved = useCallback((next: Settings) => setSettings(next), [])

  useEffect(() => {
    const offStart = window.yogurt.events.onSuggestStart((apps) =>
      setSuggestion({ kind: 'start', apps })
    )
    const offStop = window.yogurt.events.onSuggestStop(() => setSuggestion({ kind: 'stop' }))
    return () => {
      offStart()
      offStop()
    }
  }, [])

  // A suggestion that has come true no longer makes sense: starting to record
  // clears the invitation to start, and stopping clears the invitation to stop.
  useEffect(() => {
    setSuggestion((current) => {
      if (!current) return null
      if (current.kind === 'start' && recorder.isRecording) return null
      if (current.kind === 'stop' && !recorder.isRecording) return null
      return current
    })
  }, [recorder.isRecording])

  const handleStop = useCallback(async () => {
    const id = await recorder.stop()
    await refreshMeetings()
    if (id) setRoute({ name: 'meeting', id })
  }, [recorder, refreshMeetings])

  const handleDelete = useCallback(
    async (id: string) => {
      await window.yogurt.meetings.remove(id)
      setMeetings((prev) => prev.filter((m) => m.id !== id))
      setRoute((current) =>
        current.name === 'meeting' && current.id === id ? { name: 'record' } : current
      )
    },
    []
  )

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return meetings
    return meetings.filter((m) => m.title.toLowerCase().includes(query))
  }, [meetings, search])

  // Language is module state read by `msgs()` during render; applying it here,
  // before any child renders, keeps the whole tree in one language.
  if (settings) setLang(settings.resolvedLanguage)

  const needsSetup = settings !== null && !settings.hasApiKey
  const m = msgs().ui

  return (
    <div className="app">
      <aside className="sidebar">
        <header className="brand">
          <img className="brand-mark" src={iconUrl} alt="" aria-hidden="true" />
          <span className="brand-name">Yogurt</span>
        </header>

        <button
          className="btn btn-primary btn-new"
          onClick={() => setRoute({ name: 'record' })}
          disabled={recorder.isRecording && route.name === 'record'}
        >
          {recorder.isRecording ? m.app.backToRecording : m.app.newMeeting}
        </button>

        <div className="search-wrap">
          <input
            className="search"
            type="search"
            placeholder={m.app.searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <nav className="meeting-list">
          {filtered.length === 0 && (
            <p className="empty-hint">
              {meetings.length === 0 ? m.app.noMeetingsYet : m.app.nothingFound}
            </p>
          )}
          {filtered.map((meeting) => {
            const active = route.name === 'meeting' && route.id === meeting.id
            const status = statusLabel(meeting.status)
            return (
              <button
                key={meeting.id}
                className={`meeting-item${active ? ' active' : ''}`}
                onClick={() => setRoute({ name: 'meeting', id: meeting.id })}
              >
                <span className="meeting-item-title">{meeting.title || m.common.untitled}</span>
                <span className="meeting-item-meta">
                  {formatWhen(meeting.createdAt)}
                  {meeting.durationMs > 0 && ` · ${formatDuration(meeting.durationMs)}`}
                </span>
                {status && (
                  <span className={`badge badge-${meeting.status}`}>
                    {meeting.status !== 'error' && meeting.status !== 'recording' && (
                      <span className="spinner" aria-hidden="true" />
                    )}
                    {status}
                  </span>
                )}
              </button>
            )
          })}
        </nav>

        <footer className="sidebar-footer">
          <button
            className={`btn btn-ghost${route.name === 'settings' ? ' active' : ''}`}
            onClick={() => setRoute({ name: 'settings' })}
          >
            {m.app.settings}
            {needsSetup && <span className="dot-warn" title={m.app.apiKeyMissing} />}
          </button>
        </footer>
      </aside>

      <main className="content">
        {suggestion && (
          <div className="suggest-bar">
            {suggestion.kind === 'start' ? (
              <>
                <span className="suggest-dot" aria-hidden="true" />
                <span>
                  <strong>{suggestion.apps.join(', ')}</strong>
                  {m.app.suggestStart.usingMic}
                </span>
                <div className="suggest-actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => setSuggestion(null)}>
                    {m.app.suggestStart.notNow}
                  </button>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      setSuggestion(null)
                      setRoute({ name: 'record' })
                      void recorder.start('')
                    }}
                  >
                    {m.app.suggestStart.record}
                  </button>
                </div>
              </>
            ) : (
              <>
                <span className="suggest-dot" aria-hidden="true" />
                <span>{m.app.suggestStop.message}</span>
                <div className="suggest-actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => setSuggestion(null)}>
                    {m.app.suggestStop.keepRecording}
                  </button>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      setSuggestion(null)
                      void handleStop()
                    }}
                  >
                    {m.app.suggestStop.stop}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {route.name === 'record' && (
          <RecordView
            recorder={recorder}
            settings={settings}
            onStop={handleStop}
            onOpenSettings={() => setRoute({ name: 'settings' })}
          />
        )}

        {route.name === 'meeting' && (
          <MeetingView
            key={route.id}
            meetingId={route.id}
            onDelete={handleDelete}
            onRenamed={refreshMeetings}
          />
        )}

        {route.name === 'settings' && settings && (
          <SettingsView settings={settings} onSaved={handleSettingsSaved} />
        )}
      </main>
    </div>
  )
}

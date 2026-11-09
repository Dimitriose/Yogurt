import { useCallback, useEffect, useState } from 'react'
import type { MeetingDetail } from '@shared/types'
import { speakerLabelKey } from '@shared/types'
import type { NoteLine } from '@shared/notes'
import { coalesceTurns, resolveSpeaker } from '@shared/transcript'
import type { CostEstimate } from '@shared/models'
import { msgs } from '@shared/i18n'
import { useConfirm } from '../components/useConfirm'
import DropdownMenu from '../components/DropdownMenu'
import Markdown from '../components/Markdown'
import SpeakerPanel from './SpeakerPanel'
import { formatWhen, formatDuration, formatTimestamp } from '../lib/format'

interface Props {
  meetingId: string
  onDelete: (id: string) => void
  onRenamed: () => void
}

type Tab = 'summary' | 'notes' | 'transcript' | 'speakers'

function busyLabel(busy: string): string {
  const labels: Record<string, string> = msgs().ui.meeting.busy
  return labels[busy] ?? labels.fallback
}

/** Small amounts deserve more decimal places; "$0.00" tells you nothing. */
function money(usd: number): string {
  const digits = usd < 0.1 ? 3 : 2
  return msgs().ui.meeting.money(usd, digits)
}

/**
 * Price with its uncertainty made explicit.
 *
 * When the model's rate is not in the catalog, the calculation uses gpt-4o's,
 * which is the most expensive — so the value is a ceiling, not an estimate.
 * Presenting it as an estimate would give the number a precision it does not have.
 */
function moneyWithConfidence(usd: number, known: boolean): string {
  return known ? money(usd) : msgs().ui.meeting.upTo(money(usd))
}

export default function MeetingView({ meetingId, onDelete, onRenamed }: Props): JSX.Element {
  const [detail, setDetail] = useState<MeetingDetail | null>(null)
  const [tab, setTab] = useState<Tab>('summary')
  const [titleDraft, setTitleDraft] = useState<string | null>(null)
  const [notesDraft, setNotesDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [cost, setCost] = useState<CostEstimate | null>(null)
  const { confirm, dialog } = useConfirm()

  const load = useCallback(async () => {
    setDetail(await window.yogurt.meetings.get(meetingId))
    setCost(await window.yogurt.meetings.costEstimate(meetingId))
  }, [meetingId])

  useEffect(() => {
    void load()
  }, [load])

  // Reloads the content when main signals that this meeting changed state.
  useEffect(() => {
    return window.yogurt.events.onMeetingUpdated((updated) => {
      if (updated.id === meetingId) void load()
    })
  }, [meetingId, load])

  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(id)
  }, [toast])

  const m = msgs().ui
  const mm = m.meeting

  if (!detail) {
    return <div className="view view-center muted">{m.common.loading}</div>
  }

  const isWorking = detail.status === 'transcribing' || detail.status === 'summarizing'

  // The tab shows up whenever there is a speaker, whether from diarization or
  // just from channel separation (which already yields "Me" vs "Others").
  // Meetings recorded before timestamps existed only have the notes text.
  const displayedNoteLines: NoteLine[] =
    detail.noteLines.length > 0
      ? detail.noteLines
      : detail.notes.split('\n').map((text) => ({ text }))

  const speakerCount = new Set(
    detail.transcript.filter((l) => l.speaker).map((l) => speakerLabelKey(l.segmentIndex, l.speaker!))
  ).size
  const hasSpeakers = speakerCount > 0

  const commitTitle = async (): Promise<void> => {
    if (titleDraft === null) return
    const next = titleDraft.trim()
    setTitleDraft(null)
    if (next && next !== detail.title) {
      await window.yogurt.meetings.rename(meetingId, next)
      await load()
      onRenamed()
    }
  }

  const commitNotes = async (): Promise<void> => {
    if (notesDraft === null) return
    // `null`: editing outside a recording, so new lines get no timestamp.
    await window.yogurt.meetings.saveNotes(meetingId, notesDraft, null)
    setNotesDraft(null)
    await load()
    setToast(mm.notesSaved)
  }

  /**
   * Rewrites the summary from the already transcribed text. Cheap, but not free —
   * and it is the action that applies speaker names and edited notes.
   */
  const askRegenerate = async (): Promise<void> => {
    const price = cost
      ? mm.regenerate.price(
          cost.pricingKnown,
          moneyWithConfidence(cost.regenerateUsd, cost.pricingKnown)
        )
      : ''
    const ok = await confirm({
      title: mm.regenerate.title,
      message: mm.regenerate.message(price),
      confirmLabel: mm.regenerate.confirm
    })
    if (ok) await run('regenerate', () => window.yogurt.meetings.regenerate(meetingId))
  }

  /**
   * Re-sends all the audio. It is the app's expensive action: for a one-hour
   * meeting it costs the same as recording it again, which is why the warning
   * shows the amount.
   */
  const askRetranscribe = async (): Promise<void> => {
    const detalhe = cost
      ? mm.retranscribe.detail(cost.audioFiles, cost.channels, money(cost.retranscribeUsd))
      : mm.retranscribe.detailNoCost
    const ok = await confirm({
      title: mm.retranscribe.title,
      message: mm.retranscribe.message(detalhe),
      confirmLabel: mm.retranscribe.confirm,
      danger: true
    })
    if (ok) await run('retranscribe', () => window.yogurt.meetings.retranscribe(meetingId))
  }

  const run = async (label: string, fn: () => Promise<unknown>): Promise<void> => {
    setBusy(label)
    try {
      await fn()
      await load()
    } catch (err) {
      setToast(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="view view-meeting">
      <header className="meeting-header">
        {titleDraft === null ? (
          <h1 className="meeting-title" onClick={() => setTitleDraft(detail.title)} title={mm.clickToRename}>
            {detail.title || m.common.untitled}
          </h1>
        ) : (
          <input
            className="input input-title"
            value={titleDraft}
            autoFocus
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => void commitTitle()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commitTitle()
              if (e.key === 'Escape') setTitleDraft(null)
            }}
          />
        )}

        <div className="meeting-meta">
          <span>{formatWhen(detail.createdAt)}</span>
          {detail.durationMs > 0 && <span>{formatDuration(detail.durationMs)}</span>}
          {detail.language && <span>{detail.language}</span>}
          {detail.transcript.length > 0 && <span>{mm.excerpts(detail.transcript.length)}</span>}
        </div>

        {/* Warnings capped at two lines. Long API messages (or dozens of failed
            blocks) pushed the tabs and the "…" menu off the screen, exactly when
            a regenerate was needed. The full text goes to a .txt opened outside
            the app. */}
        {detail.error && (
          <div className="alert alert-error alert-compact">
            <span className="alert-text" title={detail.error}>
              {detail.error}
            </span>
            <button
              className="link alert-more"
              onClick={() => void window.yogurt.meetings.openErrorReport(meetingId)}
            >
              {mm.viewDetails}
            </button>
          </div>
        )}

        {detail.blockIssues && detail.blockIssues.length > 0 && (
          <div className="alert alert-warn block-issues alert-compact">
            <span className="alert-text">
              <strong>
                {mm.blocksIncomplete(detail.blockIssues.length)}
              </strong>{' '}
              {detail.blockIssues.every((i) => i.kind === 'truncated')
                ? mm.truncatedHint
                : detail.blockIssues.find((i) => i.kind === 'failed')?.message}
            </span>
            <button
              className="link alert-more"
              onClick={() => void window.yogurt.meetings.openErrorReport(meetingId)}
            >
              {mm.viewDetails}
            </button>
          </div>
        )}

        {isWorking && (
          <div className="alert alert-info">
            <span className="spinner" aria-hidden="true" />
            <span>
              {detail.status === 'transcribing'
                ? mm.transcribing(detail.transcribedCount, detail.segmentCount)
                : mm.writingSummary}
            </span>
          </div>
        )}

        <div className="toolbar">
          <div className="tabs">
            <button
              className={tab === 'summary' ? 'tab active' : 'tab'}
              onClick={() => setTab('summary')}
            >
              {mm.tabs.summary}
            </button>
            <button
              className={tab === 'notes' ? 'tab active' : 'tab'}
              onClick={() => setTab('notes')}
            >
              {mm.tabs.notes}
            </button>
            <button
              className={tab === 'transcript' ? 'tab active' : 'tab'}
              onClick={() => setTab('transcript')}
            >
              {mm.tabs.transcript}
            </button>
            {hasSpeakers && (
              <button
                className={tab === 'speakers' ? 'tab active' : 'tab'}
                onClick={() => setTab('speakers')}
              >
                {mm.tabs.speakers}
                <span className="tab-count">{speakerCount}</span>
              </button>
            )}
          </div>

          <div className="toolbar-actions">
            {busy && <span className="muted busy-note">{busyLabel(busy)}</span>}
            <DropdownMenu
              items={[
                {
                  label: mm.menu.export,
                  onSelect: () =>
                    void window.yogurt.meetings.export(meetingId, 'full').then((r) => {
                      if (r.saved) setToast(mm.menu.exported)
                    })
                },
                {
                  label: mm.menu.openFolder,
                  hint: mm.menu.openFolderHint,
                  onSelect: () => void window.yogurt.meetings.reveal(meetingId)
                },
                {
                  label: mm.menu.regenerate,
                  hint: cost
                    ? moneyWithConfidence(cost.regenerateUsd, cost.pricingKnown)
                    : mm.menu.regenerateHint,
                  separatorBefore: true,
                  disabled: busy !== null || isWorking,
                  onSelect: () => void askRegenerate()
                },
                {
                  label: mm.menu.retranscribe,
                  hint: cost
                    ? mm.menu.retranscribeHintCost(money(cost.retranscribeUsd))
                    : mm.menu.retranscribeHint,
                  disabled: busy !== null || isWorking || cost?.audioFiles === 0,
                  onSelect: () => void askRetranscribe()
                },
                {
                  label: mm.menu.discardAudio,
                  hint: mm.menu.discardAudioHint,
                  separatorBefore: true,
                  danger: true,
                  disabled: busy !== null || isWorking || cost?.audioFiles === 0,
                  onSelect: () => {
                    void confirm({
                      title: mm.discardAudio.title,
                      message: mm.discardAudio.message,
                      confirmLabel: mm.discardAudio.confirm,
                      danger: true
                    }).then((ok) => {
                      if (ok) {
                        void run('audio', () =>
                          window.yogurt.meetings.removeAudio(meetingId)
                        ).then(() => setToast(mm.discardAudio.done))
                      }
                    })
                  }
                },
                {
                  label: mm.menu.deleteMeeting,
                  danger: true,
                  onSelect: () => {
                    void confirm({
                      title: mm.deleteMeeting.title,
                      message: mm.deleteMeeting.message(detail.title),
                      confirmLabel: mm.deleteMeeting.confirm,
                      danger: true
                    }).then((ok) => {
                      if (ok) onDelete(meetingId)
                    })
                  }
                }
              ]}
            />
          </div>
        </div>
      </header>

      <div className="meeting-body">
        {tab === 'summary' && (
          <article className="prose">
            {detail.summary ? (
              <Markdown source={detail.summary} />
            ) : (
              <p className="muted">
                {mm.noSummary}{' '}
                {detail.transcript.length > 0 || detail.notes.trim()
                  ? mm.noSummaryUseRegenerate
                  : mm.noSummaryNothing}
              </p>
            )}
          </article>
        )}

        {tab === 'notes' && (
          <div className="notes-tab">
            <div className="notes-tab-bar">
              <span className="muted">
                {notesDraft === null
                  ? mm.notesHintView
                  : mm.notesHintEdit}
              </span>
              <div className="notes-tab-actions">
                {notesDraft === null ? (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setNotesDraft(detail.notes)}
                  >
                    {mm.edit}
                  </button>
                ) : (
                  <>
                    <button className="btn btn-ghost btn-sm" onClick={() => setNotesDraft(null)}>
                      {mm.discard}
                    </button>
                    <button className="btn btn-primary btn-sm" onClick={() => void commitNotes()}>
                      {mm.saveNotes}
                    </button>
                  </>
                )}
              </div>
            </div>

            {notesDraft === null ? (
              detail.noteLines.length === 0 && !detail.notes.trim() ? (
                <p className="muted">{mm.noNotes}</p>
              ) : (
                <div className="note-list">
                  {displayedNoteLines.map((line, index) =>
                    line.text.trim() ? (
                      <p className="note-line" key={index}>
                        <span className={line.atMs !== undefined ? 'ts' : 'ts ts-empty'}>
                          {line.atMs !== undefined ? formatTimestamp(line.atMs / 1000) : '—'}
                        </span>
                        {line.text}
                      </p>
                    ) : (
                      <div className="note-gap" key={index} />
                    )
                  )}
                </div>
              )
            ) : (
              <textarea
                className="notes-editor"
                value={notesDraft}
                autoFocus
                onChange={(e) => setNotesDraft(e.target.value)}
                placeholder={mm.noNotes}
              />
            )}
          </div>
        )}

        {tab === 'transcript' && (
          <div className="transcript transcript-full">
            {detail.transcript.length === 0 ? (
              <p className="muted">{mm.noTranscript}</p>
            ) : (
              // Grouped for display only — SpeakerPanel uses the raw lines,
              // because a grouped turn's time range runs across the other person's speech.
              coalesceTurns(detail.transcript).map((line, index) => {
                const speaker = resolveSpeaker(line, detail.speakerNames)
                return (
                  <p className="transcript-line" key={index}>
                    <span className="ts">{formatTimestamp(line.start)}</span>
                    {speaker && (
                      <span
                        className={`speaker-inline ${
                          speaker.anonymous ? 'anon' : speaker.assigned ? 'assigned' : 'named'
                        }`}
                      >
                        {speaker.label}
                      </span>
                    )}
                    {line.text}
                  </p>
                )
              })
            )}
          </div>
        )}

        {tab === 'speakers' && (
          <SpeakerPanel
            meeting={detail}
            onChanged={() => void load()}
            onRegenerate={() => void askRegenerate()}
          />
        )}
      </div>

      {toast && <div className="toast">{toast}</div>}
      {dialog}
    </div>
  )
}

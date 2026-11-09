import { useMemo, useState, type ReactNode } from 'react'
import type { AudioSource, MeetingDetail, TranscriptLine } from '@shared/types'
import { SELF_SPEAKER, isAnonymousSpeaker, speakerLabelKey } from '@shared/types'
import { formatTimestamp } from '../lib/format'
import { msgs } from '@shared/i18n'

interface Props {
  meeting: MeetingDetail
  /** Called when something changes on disk and the meeting needs reloading. */
  onChanged: () => void
  /** Triggers rewriting the summary, with the same confirmation as the menu. */
  onRegenerate?: () => void
}

interface LabelGroup {
  /** Qualified key, as stored in the meta: `"0:A"`. */
  key: string
  segmentIndex: number
  speaker: string
  source?: AudioSource
  /** Anonymous label (`A`, `B`) vs. an already known identity. */
  anonymous: boolean
  lines: TranscriptLine[]
  totalSec: number
}

/** The microphone channel is the user by construction: there is nothing to name. */
function isSelfLabel(g: LabelGroup): boolean {
  return g.speaker === SELF_SPEAKER
}

function groupByLabel(lines: TranscriptLine[]): LabelGroup[] {
  const groups = new Map<string, LabelGroup>()
  for (const line of lines) {
    if (!line.speaker) continue
    const segmentIndex = line.segmentIndex ?? 0
    const key = speakerLabelKey(segmentIndex, line.speaker)
    let group = groups.get(key)
    if (!group) {
      group = {
        key,
        segmentIndex,
        speaker: line.speaker,
        source: line.source,
        anonymous: isAnonymousSpeaker(line.speaker),
        lines: [],
        totalSec: 0
      }
      groups.set(key, group)
    }
    group.lines.push(line)
    group.totalSec += line.end - line.start
  }
  // Whoever spoke most comes first: that is who the user most wants to name.
  return [...groups.values()].sort((a, b) => b.totalSec - a.totalSec)
}

/** Renders the catalog's `**bold**` markup. */
function rich(text: string): ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*)/)
    .map((part, i) =>
      part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
        <strong key={i}>{part.slice(2, -2)}</strong>
      ) : (
        part
      )
    )
}

export default function SpeakerPanel({
  meeting,
  onChanged,
  onRegenerate
}: Props): JSX.Element {
  const m = msgs().settings.speakerPanel
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkName, setBulkName] = useState('')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Record<string, { message: string; ok: boolean }>>({})

  const groups = useMemo(() => groupByLabel(meeting.transcript), [meeting.transcript])
  const assigned = meeting.speakerNames ?? {}

  /**
   * Quick-access names: the ones you have already assigned in this meeting.
   *
   * Exists because the diarizer fragments a lot — 59 labels for 3 people in a
   * real meeting — and typing the same name twelve times is work the interface
   * should absorb. The scope is the meeting: API labels are per request and do
   * not carry over between meetings.
   */
  const quickNames = useMemo(
    () => [...new Set(Object.values(meeting.speakerNames ?? {}))],
    [meeting.speakerNames]
  )

  /** Names the label in this meeting. The name applies only here, and is reversible. */
  const assignName = async (group: LabelGroup, preset?: string): Promise<void> => {
    const name = (preset ?? drafts[group.key] ?? '').trim()
    if (!name) return

    setBusy(group.key)
    try {
      await window.yogurt.meetings.setSpeakerNames(meeting.id, [group.key], name)
      setDrafts((prev) => ({ ...prev, [group.key]: '' }))
      setFeedback((prev) => ({
        ...prev,
        [group.key]: { ok: true, message: m.identifiedAs(name) }
      }))
      onChanged()
    } catch (err) {
      setFeedback((prev) => ({
        ...prev,
        [group.key]: { ok: false, message: err instanceof Error ? err.message : String(err) }
      }))
    } finally {
      setBusy(null)
    }
  }

  const clearName = async (group: LabelGroup): Promise<void> => {
    setBusy(group.key)
    try {
      await window.yogurt.meetings.setSpeakerNames(meeting.id, [group.key], null)
      setFeedback((prev) => {
        const next = { ...prev }
        delete next[group.key]
        return next
      })
      onChanged()
    } finally {
      setBusy(null)
    }
  }

  /**
   * Applies one name to all selected labels in a single write.
   *
   * Exists because the real volume makes one-by-one correction impractical: a
   * 45-min meeting produced 59 labels for 3 people, and an outdated voice profile
   * stuck the wrong name on 11 of them. Fixing that took 55 interactions.
   */
  const applyBulk = async (name: string | null): Promise<void> => {
    const keys = [...selected]
    if (keys.length === 0) return
    setBusy('__lote__')
    try {
      await window.yogurt.meetings.setSpeakerNames(meeting.id, keys, name)
      setSelected(new Set())
      setBulkName('')
      onChanged()
    } catch (err) {
      setFeedback((prev) => ({
        ...prev,
        __lote__: { ok: false, message: err instanceof Error ? err.message : String(err) }
      }))
    } finally {
      setBusy(null)
    }
  }

  const toggle = (key: string): void =>
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })

  /**
   * Selects every label the API tagged with the same text.
   *
   * Safe precisely for names coming from the API: they are an identity claim by
   * the API itself, so every `*:Jorge` is the same person as far as it is
   * concerned — and if it got it wrong, they are all wrong together. This does
   * **not** hold for anonymous letters (the `A` in block 1 may not be the one in
   * block 2), which is why selection stays manual in that case.
   */
  const selectSameLabel = (speaker: string): void =>
    setSelected(
      new Set(groups.filter((g) => g.speaker === speaker && !isSelfLabel(g)).map((g) => g.key))
    )

  if (groups.length === 0) {
    return (
      <div className="speaker-panel">
        <p className="muted">{m.empty}</p>
      </div>
    )
  }

  const anonymousBlocks = new Set(groups.filter((g) => g.anonymous).map((g) => g.segmentIndex))
  const pendentes = groups.filter((g) => g.anonymous && !assigned[g.key]).length

  return (
    <div className="speaker-panel">
      <div className="speaker-summary">
        {rich(m.summary(groups.length, Object.keys(assigned).length, pendentes))}
      </div>

      {anonymousBlocks.size > 1 && (
        <div className="alert alert-info alert-inline">
          <span>{rich(m.anonymousNote)}</span>
        </div>
      )}

      {selected.size > 0 && (
        <div className="speaker-bulk">
          <div className="speaker-bulk-head">
            {rich(m.selectedCount(selected.size))}
            <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>
              {m.clearSelection}
            </button>
          </div>
          <div className="speaker-bulk-actions">
            {quickNames.map((n) => (
              <button
                key={n}
                className="chip"
                disabled={busy === '__lote__'}
                onClick={() => void applyBulk(n)}
              >
                {n}
              </button>
            ))}
            <input
              className="input"
              placeholder={m.bulkPlaceholder}
              value={bulkName}
              disabled={busy === '__lote__'}
              onChange={(e) => setBulkName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && bulkName.trim()) void applyBulk(bulkName)
              }}
            />
            <button
              className="btn btn-primary btn-sm"
              disabled={busy === '__lote__' || !bulkName.trim()}
              onClick={() => void applyBulk(bulkName)}
            >
              {busy === '__lote__' ? m.applying : m.nameN(selected.size)}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              disabled={busy === '__lote__'}
              onClick={() => void applyBulk(null)}
            >
              {m.undo}
            </button>
          </div>
          <small className="muted">{m.bulkHint}</small>
          {feedback.__lote__ && (
            <p className={feedback.__lote__.ok ? 'speaker-msg ok' : 'speaker-msg err'}>
              {feedback.__lote__.message}
            </p>
          )}
        </div>
      )}

      <div className="speaker-list">
        {groups.map((group) => {
          const name = assigned[group.key]
          const sample = group.lines.find((l) => l.text.length > 40) ?? group.lines[0]
          const isBusy = busy === group.key
          const msg = feedback[group.key]
          const isSelf = isSelfLabel(group)
          /**
           * Any label other than the microphone can be named — including the
           * ones that already came with a name from the API.
           *
           * Previously only anonymous ones were editable, and API-named ones were
           * read-only. That was backwards: an anonymous label is merely
           * incomplete, whereas an API-named one can be **wrong**. The case that
           * exposed it: the voice profile of someone absent from the meeting made
           * the API stick that name on 741s of another person's speech, with no
           * way to fix it on screen. Voice profiles have since been removed, but
           * the API can still return a proper name on its own — and can still
           * get it wrong.
           */
          const nameable = !isSelf

          return (
            <div
              className={`speaker-card${name ? ' speaker-card-named' : ''}`}
              key={group.key}
            >
              <div className="speaker-card-head">
                {!isSelf && (
                  <input
                    className="speaker-pick"
                    type="checkbox"
                    checked={selected.has(group.key)}
                    onChange={() => toggle(group.key)}
                    aria-label={m.selectAria(group.speaker, group.segmentIndex + 1)}
                  />
                )}
                {name ? (
                  <span className="speaker-tag assigned">✓ {name}</span>
                ) : (
                  <span className={isSelf ? 'speaker-tag self' : group.anonymous ? 'speaker-tag anon' : 'speaker-tag named'}>
                    {isSelf
                      ? m.self
                      : group.anonymous
                        ? m.anonTag(group.speaker, group.segmentIndex + 1)
                        : group.speaker}
                  </span>
                )}
                {name && (
                  <span className="speaker-origin">
                    {m.origin(group.speaker, group.segmentIndex + 1)}
                  </span>
                )}
                <span className="muted speaker-stats">
                  {m.stats(group.lines.length, Math.round(group.totalSec))}
                </span>
                {/* Only for names coming from the API: every label with the same name
                    is the same person as far as it is concerned, so selecting them
                    together is correct. An anonymous letter has no such guarantee. */}
                {!isSelf && !group.anonymous && !name && (
                  <button
                    className="btn btn-ghost btn-sm speaker-same"
                    onClick={() => selectSameLabel(group.speaker)}
                  >
                    {m.selectSame(
                      groups.filter((g) => g.speaker === group.speaker).length,
                      group.speaker
                    )}
                  </button>
                )}
              </div>

              {sample && (
                <p className="speaker-sample">
                  <span className="ts">{formatTimestamp(sample.start)}</span>
                  {sample.text.slice(0, 160)}
                  {sample.text.length > 160 ? '…' : ''}
                </p>
              )}

              {name ? (
                <div className="speaker-actions">
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={isBusy}
                    onClick={() => void clearName(group)}
                  >
                    {m.undo}
                  </button>
                </div>
              ) : nameable ? (
                <>
                  {quickNames.length > 0 && (
                    <div className="quick-names">
                      {quickNames.map((name) => (
                        <button
                          key={name}
                          className="chip"
                          disabled={isBusy}
                          onClick={() => void assignName(group, name)}
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="speaker-actions">
                    <input
                      className="input"
                      placeholder={
                        !group.anonymous
                          ? m.notThis(group.speaker)
                          : quickNames.length > 0
                            ? m.orTypeAnother
                            : m.whoIsIt
                      }
                      value={drafts[group.key] ?? ''}
                      disabled={isBusy}
                      onChange={(e) =>
                        setDrafts((prev) => ({ ...prev, [group.key]: e.target.value }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void assignName(group)
                      }}
                    />
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={isBusy || !(drafts[group.key] ?? '').trim()}
                      onClick={() => void assignName(group)}
                    >
                      {isBusy ? m.saving : m.identify}
                    </button>
                  </div>
                </>
              ) : (
                <p className="muted speaker-recognized">{m.alwaysYou}</p>
              )}

              {msg && (
                <p className={msg.ok ? 'speaker-msg ok' : 'speaker-msg err'}>{msg.message}</p>
              )}
            </div>
          )
        })}
      </div>

      {/* The action appears where the need arises. Previously this only said "use
          Regenerate summary", forcing a hunt for the button elsewhere on screen. */}
      {Object.keys(assigned).length > 0 && onRegenerate && (
        <div className="speaker-regen">
          <span>{m.regenNote(Object.keys(assigned).length)}</span>
          <button className="btn btn-primary btn-sm" onClick={onRegenerate}>
            {m.regenButton}
          </button>
        </div>
      )}

  </div>
  )
}

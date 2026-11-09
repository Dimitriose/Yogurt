import { useEffect, useState, type ReactNode } from 'react'
import type { Settings, SettingsUpdate } from '@shared/types'
import { MAX_SEGMENT_MINUTES, MAX_SEGMENT_MINUTES_DIARIZED } from '@shared/types'
import { TEXT_MODELS, tier1TpmFor } from '@shared/models'
import { msgs, locale, type LanguagePref } from '@shared/i18n'
import { useConfirm } from '../components/useConfirm'
import MicCalibration from '../components/MicCalibration'

interface Props {
  settings: Settings
  onSaved: (next: Settings) => void
}

type SettingsTab = 'api' | 'audio' | 'meeting'

const TAB_IDS: SettingsTab[] = ['api', 'audio', 'meeting']

/** Renders the catalog's inline markup: `**bold**`, `_emphasis_`, `` `code` ``. */
function rich(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|_[^_]+_|`[^`]+`)/).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4)
      return <strong key={i}>{part.slice(2, -2)}</strong>
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2)
      return <code key={i}>{part.slice(1, -1)}</code>
    if (part.startsWith('_') && part.endsWith('_') && part.length > 2)
      return <em key={i}>{part.slice(1, -1)}</em>
    return part
  })
}

export default function SettingsView({ settings, onSaved }: Props): JSX.Element {
  const m = msgs().settings
  const [apiKey, setApiKey] = useState('')
  const [local, setLocal] = useState(settings)
  const [status, setStatus] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [segmentNote, setSegmentNote] = useState<string | null>(null)
  const [modelNote, setModelNote] = useState<string | null>(null)
  const [version, setVersion] = useState<string | null>(null)
  const { dialog } = useConfirm()

  /**
   * Switches the minutes model and carries the TPM ceiling along with it.
   *
   * The ceiling is per model. Keeping the two independent is what produced the
   * worst silent outcome: picking a model with 200,000 TPM and still condensing
   * the transcript as if it were 30,000.
   *
   * Only touches the ceiling if the current value is the known default of
   * *another* catalog model — that way a number the user typed by hand (a
   * higher-tier account) is not overwritten by the first-tier guess.
   */
  const changeSummaryModel = async (id: string): Promise<void> => {
    const next = tier1TpmFor(id)
    const currentIsCatalogDefault = TEXT_MODELS.some((m) => m.tier1Tpm === local.tpmLimit)

    if (next && next !== local.tpmLimit && currentIsCatalogDefault) {
      await patch({ summaryModel: id, tpmLimit: next })
      setModelNote(m.models.tpmAdjusted(next.toLocaleString(locale()), id))
    } else {
      await patch({ summaryModel: id })
      setModelNote(
        next && next !== local.tpmLimit
          ? m.models.tpmKept(
              id,
              next.toLocaleString(locale()),
              local.tpmLimit.toLocaleString(locale())
            )
          : null
      )
    }
  }

  useEffect(() => {
    void window.yogurt.app.version().then(setVersion)
  }, [])

  const [tab, setTab] = useState<SettingsTab>('api')
  const segmentCeiling = local.diarization
    ? MAX_SEGMENT_MINUTES_DIARIZED
    : MAX_SEGMENT_MINUTES

  const patch = async (update: SettingsUpdate): Promise<Settings> => {
    const next = await window.yogurt.settings.update(update)
    setLocal(next)
    onSaved(next)
    return next
  }

  const saveKey = async (): Promise<void> => {
    const trimmed = apiKey.trim()
    if (!trimmed) return
    try {
      await patch({ apiKey: trimmed })
    } catch (err) {
      // The main process refuses to save without encryption; the message arrives prefixed by IPC.
      const message = err instanceof Error ? err.message : String(err)
      setStatus(message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      return
    }
    setApiKey('')
    setStatus(m.apiKey.savedValidating)
    setTesting(true)
    const result = await window.yogurt.settings.testKey()
    setTesting(false)
    setStatus(result.ok ? m.apiKey.validReady : m.apiKey.rejected(result.error ?? ''))
  }

  const clearKey = async (): Promise<void> => {
    await patch({ apiKey: '' })
    setStatus(m.apiKey.removed)
  }

  return (
    <div className="view view-settings">
      <header className="settings-header">
        <h1>{m.title}</h1>
        {/* Same classes as the meeting tabs: a single tab language across the app. */}
        <div className="tabs">
          {TAB_IDS.map((id) => (
            <button
              key={id}
              className={tab === id ? 'tab active' : 'tab'}
              onClick={() => setTab(id)}
            >
              {m.tabs[id]}
            </button>
          ))}
        </div>
      </header>

      {tab === 'api' && (
      <section className="settings-section">
        <h2>{m.apiKey.heading}</h2>
        <p className="muted">{m.apiKey.intro}</p>

        {local.hasApiKey ? (
          <div className="row">
            <span className="pill pill-ok">{m.apiKey.configured}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => void clearKey()}>
              {m.apiKey.remove}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              disabled={testing}
              onClick={() => {
                setTesting(true)
                setStatus(m.apiKey.validating)
                void window.yogurt.settings.testKey().then((r) => {
                  setTesting(false)
                  setStatus(r.ok ? m.apiKey.valid : m.apiKey.rejected(r.error ?? ''))
                })
              }}
            >
              {testing ? m.apiKey.validating : m.apiKey.test}
            </button>
          </div>
        ) : (
          <span className="pill pill-warn">{m.apiKey.none}</span>
        )}

        <div className="row">
          <input
            className="input input-mono"
            type="password"
            placeholder={m.apiKey.placeholder}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void saveKey()
            }}
          />
          <button className="btn btn-primary" disabled={!apiKey.trim()} onClick={() => void saveKey()}>
            {m.apiKey.save}
          </button>
        </div>

        {status && <p className="status">{status}</p>}
      </section>
      )}


      {tab === 'audio' && (
      <section className="settings-section">
        <h2>{m.audio.heading}</h2>

        <label className="check">
          <input
            type="checkbox"
            checked={local.captureSystemAudio}
            onChange={(e) => void patch({ captureSystemAudio: e.target.checked })}
          />
          <span>
            {m.audio.system}
            <small>{m.audio.systemHint}</small>
          </span>
        </label>

        <label className="check">
          <input
            type="checkbox"
            checked={local.captureMicrophone}
            onChange={(e) => void patch({ captureMicrophone: e.target.checked })}
          />
          <span>
            {m.audio.mic}
            <small>{m.audio.micHint}</small>
          </span>
        </label>

        <label className="field">
          <span>{m.audio.micGain(local.micGain.toFixed(1))}</span>
          <input
            type="range"
            min="0.2"
            max="3"
            step="0.1"
            value={local.micGain}
            onChange={(e) => void patch({ micGain: Number(e.target.value) })}
          />
        </label>

        <label className="field">
          <span>{m.audio.systemGain(local.systemGain.toFixed(1))}</span>
          <input
            type="range"
            min="0.2"
            max="3"
            step="0.1"
            value={local.systemGain}
            onChange={(e) => void patch({ systemGain: Number(e.target.value) })}
          />
        </label>

        <label className="field">
          <span>{m.audio.sensitivity}</span>
          <small className="muted">{m.audio.sensitivityHint}</small>
        </label>
        <MicCalibration
          thresholdDb={local.micThresholdDb}
          onChange={(db) => void patch({ micThresholdDb: db })}
        />

      </section>
      )}

      {tab === 'api' && (
      <section className="settings-section">
        <h2>{m.models.heading}</h2>

        <label className="field">
          <span>{m.models.transcription}</span>
          <select
            className="input"
            value={local.transcriptionModel}
            onChange={(e) => void patch({ transcriptionModel: e.target.value })}
          >
            <option value="whisper-1">{m.models.whisper}</option>
            <option value="gpt-4o-transcribe">{m.models.gpt4o}</option>
            <option value="gpt-4o-mini-transcribe">{m.models.gpt4oMini}</option>
          </select>
          <small className="muted">{m.models.transcriptionHint}</small>
        </label>

        <label className="field">
          <span>{m.models.summary}</span>
          <select
            className="input"
            value={local.summaryModel}
            onChange={(e) => void changeSummaryModel(e.target.value)}
          >
            {TEXT_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          {modelNote && <div className="alert alert-info">{modelNote}</div>}
          <small className="muted">{rich(m.models.summaryHint)}</small>
        </label>

        <div className="field">
          <span>{m.models.languageHeading}</span>
          <p className="muted">{rich(m.models.languageAuto)}</p>
          <small className="muted">{rich(m.models.languageRemoved)}</small>
          <small className="muted">{m.models.minutesLanguage}</small>
        </div>
      </section>
      )}

      {tab === 'meeting' && (
      <section className="settings-section">
        <h2>{m.language.heading}</h2>

        <label className="field">
          <select
            className="input"
            value={local.language}
            onChange={(e) => void patch({ language: e.target.value as LanguagePref })}
          >
            <option value="auto">{m.language.auto}</option>
            <option value="en">{m.language.en}</option>
            <option value="pt">{m.language.pt}</option>
          </select>
          <small className="muted">{m.language.hint}</small>
        </label>
      </section>
      )}

      {tab === 'meeting' && (
      <section className="settings-section">
        <h2>{m.speakers.heading}</h2>

        <label className="check">
          <input
            type="checkbox"
            checked={local.diarization}
            onChange={(e) => {
              const before = local.segmentMinutes
              void patch({ diarization: e.target.checked }).then((next) => {
                // The main process enforces the ceiling; without this notice the
                // segment change would happen silently.
                setSegmentNote(
                  next.segmentMinutes !== before
                    ? m.speakers.segmentReduced(before, next.segmentMinutes)
                    : null
                )
              })
            }}
          />
          <span>
            {m.speakers.identify}
            <small>{rich(m.speakers.identifyHint)}</small>
          </span>
        </label>

        {segmentNote && <div className="alert alert-info">{segmentNote}</div>}

        <p className="muted">{rich(m.speakers.naming)}</p>
      </section>
      )}

      {tab === 'meeting' && (
      <section className="settings-section">
        <h2>{m.segment.heading}</h2>

        <label className="field">
          <span>{m.segment.perBlock(local.segmentMinutes)}</span>
          <input
            type="range"
            min="1"
            max={segmentCeiling}
            step="1"
            value={local.segmentMinutes}
            onChange={(e) => void patch({ segmentMinutes: Number(e.target.value) })}
          />
          <small className="muted">{m.segment.hint}</small>
          {local.diarization && (
            <small className="muted">{m.segment.diarizedLimit(MAX_SEGMENT_MINUTES_DIARIZED)}</small>
          )}
        </label>
      </section>
      )}

      {tab === 'meeting' && (
      <section className="settings-section">
        <h2>{m.tpm.heading}</h2>

        <label className="field">
          <span>{m.tpm.label}</span>
          <input
            className="input"
            type="number"
            min="10000"
            step="1000"
            value={local.tpmLimit}
            onChange={(e) => void patch({ tpmLimit: Number(e.target.value) })}
          />
          <small className="muted">{m.tpm.hint}</small>
          <small className="muted">{m.tpm.defaultHint}</small>
        </label>
      </section>
      )}

      {tab === 'meeting' && (
      <section className="settings-section">
        <h2>{m.detection.heading}</h2>

        <label className="check">
          <input
            type="checkbox"
            checked={local.autoDetectMeetings}
            onChange={(e) => void patch({ autoDetectMeetings: e.target.checked })}
          />
          <span>
            {m.detection.label}
            <small>{m.detection.hint}</small>
          </span>
        </label>

        <p className="muted">{m.detection.note}</p>
      </section>
      )}

      {tab === 'meeting' && (
      <section className="settings-section">
        <h2>{m.instructions.heading}</h2>
        <p className="muted">{m.instructions.intro}</p>
        <textarea
          className="notes-editor notes-editor-sm"
          value={local.customInstructions}
          placeholder={m.instructions.placeholder}
          onChange={(e) => setLocal({ ...local, customInstructions: e.target.value })}
          onBlur={() => void patch({ customInstructions: local.customInstructions })}
        />
      </section>
      )}

      {tab === 'meeting' && (
      <section className="settings-section">
        <h2>{m.data.heading}</h2>
        <p className="muted">{m.data.intro}</p>
        <button className="btn btn-ghost btn-sm" onClick={() => void window.yogurt.app.openDataFolder()}>
          {m.data.openFolder}
        </button>
        <p className="muted">{rich(m.data.version(version ?? '—'))}</p>
      </section>
      )}

      {tab === 'meeting' && (
      <section className="settings-section">
        <h2>{m.window.heading}</h2>

        <label className="check">
          <input
            type="checkbox"
            checked={local.closeToTray}
            onChange={(e) => void patch({ closeToTray: e.target.checked })}
          />
          <span>
            {m.window.closeToTray}
            <small>{m.window.closeToTrayHint}</small>
          </span>
        </label>

        <p className="muted">{m.window.note}</p>
      </section>
      )}

      {dialog}
    </div>
  )
}

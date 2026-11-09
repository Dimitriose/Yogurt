import { app, safeStorage } from 'electron'
import { resolveLang, setLang, msgs } from '@shared/i18n'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_SETTINGS,
  MAX_SEGMENT_MINUTES,
  MAX_SEGMENT_MINUTES_DIARIZED,
  type Settings,
  type SettingsUpdate
} from '@shared/types'

interface StoredSettings extends Omit<Settings, 'hasApiKey' | 'resolvedLanguage'> {
  /** Key encrypted via safeStorage, in base64. */
  apiKeyEnc?: string
  /**
   * Legacy: versions up to 0.4.0 stored the key in plain text when the OS
   * offered no encryption. Today it is only read in order to migrate — never
   * written again.
   */
  apiKeyPlain?: string
}

let cache: StoredSettings | null = null

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

/**
 * Keys that existed and were removed. Without this cleanup the merge with the
 * defaults would keep them forever, and the renderer would receive fields the
 * type no longer describes.
 */
const OBSOLETE_KEYS: string[] = []

/**
 * The old `language` key: an audio-language selector. Removed because the API
 * parameter doesn't filter the audio — it tells the model the output language —
 * and setting it wrong made Whisper translate instead of transcribe.
 *
 * The key name is now reused by the UI language preference (`auto`/`en`/`pt`),
 * so only values that aren't a valid preference are dropped. Dropping the key
 * unconditionally would erase the user's language choice on every startup.
 * A leftover audio value of `en` or `pt` is kept and simply becomes the UI
 * language, which is harmless.
 */
function dropObsoleteLanguage(parsed: Record<string, unknown>): boolean {
  if (!('language' in parsed)) return false
  const value = parsed.language
  if (value === 'auto' || value === 'en' || value === 'pt') return false
  delete parsed.language
  return true
}

/**
 * Migrates anyone with `gpt-4o` stored as the minutes model.
 *
 * It isn't a style preference: on a first-tier account gpt-4o has **30,000
 * TPM**, and that exact ceiling is what made the minutes of a real 98-min
 * meeting fail with a 429. Luna has 200,000 on the same account. Anyone
 * installing over an older version would keep the old model stored and keep
 * getting the transcript condensed needlessly — receiving worse minutes because
 * of an avoidable limit.
 *
 * Only migrates when the stored ceiling is also gpt-4o's (or absent). A user who
 * typed their own limit has a higher-tier account, and then the model choice
 * was deliberate — not ours to undo.
 *
 * gpt-4o remains in the picker.
 */
function migrateSummaryModel(parsed: Record<string, unknown>): boolean {
  if (parsed.summaryModel !== 'gpt-4o') return false
  const tpm = parsed.tpmLimit
  if (tpm !== undefined && tpm !== 30_000) return false

  parsed.summaryModel = 'gpt-5.6-luna'
  parsed.tpmLimit = 200_000
  console.log(
    '[settings] minutes model migrated from gpt-4o to gpt-5.6-luna ' +
      "(30,000 → 200,000 TPM): gpt-4o's ceiling broke long meetings"
  )
  return true
}

function load(): StoredSettings {
  if (cache) return cache
  const path = settingsPath()
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
      let dirty = false
      for (const key of OBSOLETE_KEYS) {
        if (key in parsed) {
          delete parsed[key]
          dirty = true
        }
      }
      if (dropObsoleteLanguage(parsed)) dirty = true
      if (migrateSummaryModel(parsed)) dirty = true
      cache = { ...DEFAULT_SETTINGS, ...(parsed as Partial<StoredSettings>) }
      // Rewrite so the file on disk is clean too.
      if (dirty) persist(cache)
      return cache
    } catch (err) {
      console.error('[settings] corrupted file, recreating:', err)
    }
  }
  cache = { ...DEFAULT_SETTINGS }
  return cache
}

function persist(next: StoredSettings): void {
  cache = next
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf-8')
}

/**
 * Applies the segment size ceiling.
 *
 * Runs on read, and not only on write, so the invariant holds regardless of how
 * the value got to disk — settings saved before the ceiling existed, or a file
 * edited by hand. Without it, a recording would use the old value for never
 * having gone through Settings.
 */
function clampSegmentMinutes(diarization: boolean, minutes: number): number {
  const ceiling = diarization ? MAX_SEGMENT_MINUTES_DIARIZED : MAX_SEGMENT_MINUTES
  return Math.max(1, Math.min(ceiling, minutes))
}

/** Safe version for the renderer: without the key, only whether it exists. */
export function getPublicSettings(): Settings {
  const s = load()
  const { apiKeyEnc: _enc, apiKeyPlain: _plain, ...rest } = s
  const resolvedLanguage = resolveLang(rest.language, app.getLocale())
  // The main process's own strings (errors, tray, dialogs) follow the same
  // language as the UI. Cheap enough to re-apply on every read.
  setLang(resolvedLanguage)
  return {
    ...rest,
    segmentMinutes: clampSegmentMinutes(rest.diarization, rest.segmentMinutes),
    hasApiKey: Boolean(getApiKey()),
    resolvedLanguage
  }
}

function encryptKey(key: string): string {
  return safeStorage.encryptString(key).toString('base64')
}

export function getApiKey(): string | null {
  const s = load()
  // Migration of a legacy plain-text key: encrypt it as soon as the OS allows
  // and erase the readable version from disk.
  if (s.apiKeyPlain && !s.apiKeyEnc && safeStorage.isEncryptionAvailable()) {
    const plain = s.apiKeyPlain
    const next: StoredSettings = { ...s, apiKeyEnc: encryptKey(plain) }
    delete next.apiKeyPlain
    persist(next)
    console.warn('[settings] legacy plain-text key was encrypted')
    return plain
  }
  if (s.apiKeyEnc) {
    try {
      return safeStorage.decryptString(Buffer.from(s.apiKeyEnc, 'base64'))
    } catch (err) {
      console.error('[settings] failed to decrypt the key:', err)
      return null
    }
  }
  return s.apiKeyPlain ?? null
}

export function updateSettings(update: SettingsUpdate): Settings {
  const current = load()
  const { apiKey, ...rest } = update
  const next: StoredSettings = { ...current, ...rest }

  // Clamp applied here, and not in the UI, to act as the single source of
  // truth: turning diarization on with a large segment already saved has to
  // reduce it, not just limit the control on screen.
  next.segmentMinutes = clampSegmentMinutes(next.diarization, next.segmentMinutes)

  if (apiKey !== undefined) {
    const trimmed = apiKey.trim()
    delete next.apiKeyEnc
    delete next.apiKeyPlain
    if (trimmed) {
      // Without DPAPI available, refuse instead of writing the key readable to
      // disk: anyone with access to the files could copy it.
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error(msgs().main.settings.encryptionUnavailable)
      }
      next.apiKeyEnc = encryptKey(trimmed)
    }
  }

  persist(next)
  return getPublicSettings()
}

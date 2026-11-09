/**
 * Minimal, dependency-free i18n.
 *
 * Each namespace module exports `en` (the source of truth for the shape) and
 * `pt: typeof en`, so a missing or mistyped translation is a compile error.
 * Entries are either plain strings or functions for interpolation:
 *
 *   msgs().meeting.title            // string
 *   msgs().meeting.blocks(3)        // (n: number) => string
 *
 * The active language is module state, set once per process: the main process
 * resolves it from the settings and the OS locale; the renderer receives the
 * resolved value inside `Settings` and calls `setLang` before rendering.
 */
import * as ui from './ui'
import * as settingsUi from './settingsUi'
import * as main from './main'
import * as system from './system'

export type Lang = 'en' | 'pt'
export type LanguagePref = 'auto' | Lang

const catalogs = {
  en: { ui: ui.en, settings: settingsUi.en, main: main.en, system: system.en },
  pt: { ui: ui.pt, settings: settingsUi.pt, main: main.pt, system: system.pt }
}

export type Messages = (typeof catalogs)['en']

let current: Lang = 'en'

export function setLang(lang: Lang): void {
  current = lang
}

export function getLang(): Lang {
  return current
}

/** BCP 47 tag for `Intl`/`toLocaleString` in the active language. */
export function locale(): string {
  return current === 'pt' ? 'pt-BR' : 'en-US'
}

export function msgs(): Messages {
  return catalogs[current]
}

/** `auto` follows the OS: Portuguese for any `pt*` locale, English otherwise. */
export function resolveLang(pref: LanguagePref | undefined, systemLocale: string): Lang {
  if (pref === 'en' || pref === 'pt') return pref
  return systemLocale.toLowerCase().startsWith('pt') ? 'pt' : 'en'
}

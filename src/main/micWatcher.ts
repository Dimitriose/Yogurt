import { execFile } from 'node:child_process'
import { basename } from 'node:path'

/**
 * Detects when another application starts using (or releases) the microphone
 * on Windows, so Yogurt can offer to start and stop recording at the right time.
 *
 * **How.** Windows tracks microphone usage under
 * `HKCU\...\CapabilityAccessManager\ConsentStore\microphone`, the same
 * source as the Windows 11 privacy indicator. Each app has
 * `LastUsedTimeStart` and `LastUsedTimeStop`; while the session is open,
 * `LastUsedTimeStop` is `0`. Verified in practice: opening the microphone makes
 * the key show up with `0x0` within seconds, and releasing it clears it.
 *
 * We use `reg.exe` instead of PowerShell because the whole query costs ~60 ms —
 * cheap enough to poll every few seconds with no noticeable load.
 */

const KEY =
  'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone'

const POLL_MS = 5_000

/**
 * How long to wait before considering the microphone really free.
 *
 * Switching audio devices, or the meeting app itself reopening its session,
 * releases the microphone for a few seconds. Suggesting to stop recording in
 * that gap would be worse than waiting — hence the generous margin.
 */
const RELEASE_DEBOUNCE_MS = 25_000

/** Friendly names for what the user recognizes; anything else goes as-is. */
const FRIENDLY: Array<[RegExp, string]> = [
  [/^MSTeams/i, 'Microsoft Teams'],
  [/^Microsoft\.Teams/i, 'Microsoft Teams'],
  [/^(ms-teams|teams)\.exe$/i, 'Microsoft Teams'],
  [/^zoom\.exe$/i, 'Zoom'],
  [/^chrome\.exe$/i, 'Google Chrome'],
  [/^msedge\.exe$/i, 'Microsoft Edge'],
  [/^firefox\.exe$/i, 'Firefox'],
  [/^slack\.exe$/i, 'Slack'],
  [/^discord\.exe$/i, 'Discord'],
  [/^(webexmeetings|atmgr|webex)\.exe$/i, 'Webex'],
  [/^lync\.exe$/i, 'Skype for Business'],
  [/^skype\.exe$/i, 'Skype']
]

export interface MicWatcherHandlers {
  /** Another app started using the microphone. */
  onInUse: (apps: string[]) => void
  /** No other app is using the microphone, and the grace period has passed. */
  onReleased: () => void
}

let timer: NodeJS.Timeout | null = null
let handlers: MicWatcherHandlers | null = null
/** Apps (already filtered) seen in the last scan. */
let lastApps: string[] = []
/** When the microphone became free; null while it's in use. */
let freeSince: number | null = null
let releaseNotified = true

function friendlyName(raw: string): string {
  for (const [pattern, label] of FRIENDLY) {
    if (pattern.test(raw)) return label
  }
  return raw.replace(/\.exe$/i, '')
}

/**
 * Our own executable, which shows up in the registry when we record and must
 * not trigger anything.
 *
 * Only the process's actual basename, not a fixed list: excluding
 * `electron.exe` just in case would make the app ignore any Electron-based
 * meeting app. The side effect is that, when running in development (where we
 * are `electron.exe`), another Electron app can't be told apart from us — in
 * the packaged build we are `Yogurt.exe` and the distinction exists.
 */
function selfName(): string {
  return basename(process.execPath).toLowerCase()
}

/**
 * Extracts the app identifier from the registry key. Win32 apps live under
 * `NonPackaged` with the full path and `#` in place of `\`; packaged apps
 * appear directly by their family name.
 */
function appFromKey(key: string): string {
  const leaf = key.split('\\').pop() ?? ''
  return leaf.includes('#') ? (leaf.split('#').pop() ?? leaf) : leaf
}

function queryInUse(): Promise<string[]> {
  return new Promise((resolve) => {
    execFile(
      'reg.exe',
      ['query', KEY, '/s'],
      { windowsHide: true, timeout: 8_000 },
      (err, stdout) => {
        if (err) {
          // Without the registry (another OS, a restrictive policy) detection
          // simply doesn't run; the app keeps working manually.
          resolve([])
          return
        }

        const excluded = selfName()
        const found = new Set<string>()
        let currentKey = ''

        for (const line of stdout.split(/\r?\n/)) {
          if (line.startsWith('HKEY_')) {
            currentKey = line.trim()
            continue
          }
          const match = /^\s+LastUsedTimeStop\s+REG_QWORD\s+(0x[0-9a-fA-F]+)\s*$/.exec(line)
          if (!match) continue
          if (BigInt(match[1]) !== 0n) continue

          const app = appFromKey(currentKey)
          if (!app || app.toLowerCase() === excluded) continue
          found.add(friendlyName(app))
        }

        resolve([...found].sort())
      }
    )
  })
}

async function poll(): Promise<void> {
  const apps = await queryInUse()

  if (apps.length > 0) {
    freeSince = null
    releaseNotified = false
    // Only notify when the set changes: keeping the microphone open must not
    // re-issue the prompt on every scan.
    const changed =
      apps.length !== lastApps.length || apps.some((a, i) => a !== lastApps[i])
    if (changed) {
      console.log(`[micWatcher] microphone in use by: ${apps.join(', ')}`)
      handlers?.onInUse(apps)
    }
    lastApps = apps
    return
  }

  lastApps = []
  if (releaseNotified) return
  if (freeSince === null) {
    freeSince = Date.now()
    return
  }
  if (Date.now() - freeSince >= RELEASE_DEBOUNCE_MS) {
    releaseNotified = true
    freeSince = null
    console.log('[micWatcher] microphone free; suggesting stop')
    handlers?.onReleased()
  }
}

export function startMicWatcher(next: MicWatcherHandlers): void {
  if (process.platform !== 'win32') return
  handlers = next
  stopMicWatcher()
  lastApps = []
  freeSince = null
  releaseNotified = true
  timer = setInterval(() => void poll(), POLL_MS)
  void poll()
}

export function stopMicWatcher(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

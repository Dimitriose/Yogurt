import { app, Tray, Menu, nativeImage, BrowserWindow, powerSaveBlocker } from 'electron'
import { join } from 'node:path'
import { getRecordingState, onRecordingState, type RecordingState } from './appState'
import { getPublicSettings, updateSettings } from './settings'
import { msgs } from '@shared/i18n'

/**
 * Tray icon with a recording indicator.
 *
 * Both icon variants are ready-made files in `resources/`, generated outside
 * the runtime: compositing the image at run time would require a PNG decoder in
 * the main process, which Node doesn't ship.
 */

let tray: Tray | null = null
/** Handle of the sleep blocker, active only while recording. */
let sleepBlockerId: number | null = null

function resourcePath(name: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, name)
    : join(__dirname, '../../resources', name)
}

function trayImage(recording: boolean): Electron.NativeImage {
  const file = recording ? 'tray-recording.png' : 'tray.png'
  const image = nativeImage.createFromPath(resourcePath(file))
  // The Windows tray works at ~16px; resizing here comes out sharper than
  // letting the OS shrink a large PNG.
  return image.isEmpty() ? image : image.resize({ width: 16, height: 16 })
}

function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0')
  const s = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`
}

function statusLabel(state: RecordingState): string {
  const t = msgs().system.tray
  if (!state.recording) return t.idle
  const clock = formatClock(state.elapsedMs)
  return state.paused ? t.paused(clock) : t.recording(clock)
}

function mainWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows()[0] ?? null
}

function showWindow(): void {
  const win = mainWindow()
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/**
 * Rebuilt on every `render`, i.e. on each recording-state update, so a UI
 * language change shows up in the menu on the next update.
 */
function buildMenu(state: RecordingState): Electron.Menu {
  const t = msgs().system.tray
  return Menu.buildFromTemplate([
    { label: statusLabel(state), enabled: false },
    { type: 'separator' },
    { label: t.open, click: showWindow },
    { type: 'separator' },
    // `app.quit()` goes through `before-quit`, which is where the
    // recording-in-progress confirmation happens — so this item needs no check.
    { label: t.quit, click: () => app.quit() }
  ])
}

/** Keeps the machine awake while recording: suspending midway kills the capture. */
function syncSleepBlocker(recording: boolean): void {
  if (recording && sleepBlockerId === null) {
    sleepBlockerId = powerSaveBlocker.start('prevent-display-sleep')
  } else if (!recording && sleepBlockerId !== null) {
    if (powerSaveBlocker.isStarted(sleepBlockerId)) powerSaveBlocker.stop(sleepBlockerId)
    sleepBlockerId = null
  }
}

function render(state: RecordingState): void {
  if (!tray) return
  tray.setImage(trayImage(state.recording))
  tray.setToolTip(state.recording ? `Yogurt — ${statusLabel(state)}` : 'Yogurt')
  tray.setContextMenu(buildMenu(state))
  syncSleepBlocker(state.recording)
}

export function createTray(): void {
  if (tray) return

  tray = new Tray(trayImage(false))
  tray.on('click', showWindow)
  tray.on('double-click', showWindow)
  render(getRecordingState())

  onRecordingState(render)
}

/**
 * Tells the user, only once, that closing just hides the app. Without this they
 * conclude the app died — and avoiding that doubt was the whole point of the
 * tray.
 */
export function notifyHiddenToTray(): void {
  const settings = getPublicSettings()
  if (settings.trayHintShown || !tray) return

  updateSettings({ trayHintShown: true })
  try {
    const t = msgs().system.tray
    tray.displayBalloon({
      title: t.hintTitle,
      content: t.hintBody
    })
  } catch (err) {
    // displayBalloon is Windows-only; on other systems there's simply no notice.
    console.warn('[tray] balloon unavailable:', err)
  }
}

export function destroyTray(): void {
  syncSleepBlocker(false)
  tray?.destroy()
  tray = null
}

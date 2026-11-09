import {
  app,
  BrowserWindow,
  session,
  desktopCapturer,
  shell,
  dialog,
  Notification
} from 'electron'
import { join } from 'node:path'
import { registerIpc } from './ipc'
import { reconcileOrphans } from './meetings'
import { isRecording, isQuitting, setQuitting } from './appState'
import { createTray, destroyTray, notifyHiddenToTray } from './tray'
import { getPublicSettings } from './settings'
import { startMicWatcher, stopMicWatcher } from './micWatcher'
import { msgs } from '@shared/i18n'

const isDev = !app.isPackaged

/**
 * With `signAndEditExecutable: false` in electron-builder, the icon is not
 * embedded in the .exe resources — so the window has to load it from a file.
 */
function iconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(__dirname, '../../resources/icon.png')
}

/**
 * Confirms discarding the chunk in progress. Returns `true` when it is OK to
 * proceed — including when nothing is being recorded, in which case nothing is
 * lost and asking would just be noise.
 */
function confirmDiscardRecording(win?: BrowserWindow): boolean {
  if (!isRecording()) return true

  const t = msgs().system.dialogs.discardRecording
  const options: Electron.MessageBoxSyncOptions = {
    type: 'warning',
    buttons: [t.keepRecording, t.discardAndQuit],
    defaultId: 0,
    cancelId: 0,
    title: t.title,
    message: t.message,
    detail: t.detail
  }
  const response =
    win && !win.isDestroyed()
      ? dialog.showMessageBoxSync(win, options)
      : dialog.showMessageBoxSync(options)
  return response === 1
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    icon: iconPath(),
    // Background color while the window loads: avoids a dark flash before the
    // first paint. Must match the theme's --bg.
    backgroundColor: '#fffbfc',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // The preload only uses contextBridge and ipcRenderer, which exist in the
      // sandbox. With it on, a compromised renderer can't reach Node or the disk.
      sandbox: true,
      // Essential in a recording app. Chromium throttles timers of background
      // windows — after a few minutes, down to about one firing per minute.
      // Since segment rotation is a `setTimeout` of several minutes, hiding the
      // window in the tray would delay closing segments and misalign the
      // timestamps.
      backgroundThrottling: false
    }
  })

  win.on('ready-to-show', () => win.show())

  /**
   * Closing only hides to the tray: recording continues, and the user doesn't
   * lose the meeting for having clicked the X.
   *
   * With `closeToTray` off, the X quits — and then the confirmation has to
   * happen **here**, before the window is destroyed. Leaving it only to
   * `before-quit` would be too late: the window (and with it the renderer that
   * records) would already be dead, and cancelling would leave the app alive
   * with no window at all.
   */
  win.on('close', (event) => {
    if (isQuitting()) return

    if (getPublicSettings().closeToTray) {
      event.preventDefault()
      win.hide()
      notifyHiddenToTray()
      return
    }

    if (!confirmDiscardRecording(win)) {
      event.preventDefault()
      return
    }
    setQuitting(true)
  })

  // External links open in the browser, never inside the app — and only
  // http(s): `shell.openExternal` with `file:` or a registered protocol would
  // run local programs.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // The window only shows the app's own UI. Any attempt to navigate elsewhere
  // (a stray link, dragging a file onto the window) is blocked.
  win.webContents.on('will-navigate', (event, url) => {
    const own = isDev && process.env['ELECTRON_RENDERER_URL']
    if (own && url.startsWith(process.env['ELECTRON_RENDERER_URL']!)) return
    event.preventDefault()
  })

  // Renderer errors go to the main console: without this, a UI failure in the
  // packaged app leaves no trace anywhere.
  win.webContents.on('console-message', ({ level, message, lineNumber, sourceId }) => {
    if (level === 'warning' || level === 'error') {
      console.error(`[renderer] ${message} (${sourceId}:${lineNumber})`)
    }
  })

  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[main] render process gone:', details.reason, details.exitCode)
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

/**
 * System audio capture.
 *
 * The renderer calls `getDisplayMedia({ video: true, audio: true })`. Without
 * this handler, Chromium opens the screen picker and — on Windows — only
 * delivers audio from a tab. By answering with `audio: 'loopback'`, Electron
 * turns on WASAPI loopback capture of the default output device: everything
 * coming out of the speakers, including Teams, Meet and Zoom, regardless of
 * window.
 *
 * Video is mandatory in the response (the API requires a source), but the
 * renderer drops the video track immediately — nothing of the screen is
 * recorded.
 */
function setupDisplayMediaHandler(): void {
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen'], fetchWindowIcons: false })
        .then((sources) => {
          if (sources.length === 0) {
            // Without a video source there's no way to open the loopback stream.
            callback({})
            return
          }
          callback({ video: sources[0], audio: 'loopback' })
        })
        .catch((err) => {
          console.error('[main] desktopCapturer failed:', err)
          callback({})
        })
    },
    // No native OS picker: the choice is always "system audio".
    { useSystemPicker: false }
  )
}

/**
 * Wires microphone-usage detection to the suggestions in the UI.
 *
 * The main process decides *when* to suggest (it's the one that knows whether
 * we're already recording) and the renderer decides *how* to show it. When the
 * window is hidden in the tray, a system notification is the only way — a
 * banner in an invisible window is useless.
 */
function setupMicWatcher(): void {
  startMicWatcher({
    onInUse: (apps) => {
      if (!getPublicSettings().autoDetectMeetings) return
      if (isRecording()) return

      const win = BrowserWindow.getAllWindows()[0]
      const appList = apps.join(', ')
      win?.webContents.send('mic:suggest-start', apps)

      if (win && !win.isVisible() && Notification.isSupported()) {
        const t = msgs().system.notifications.meetingStarting
        const notification = new Notification({
          title: t.title,
          body: t.body(appList),
          icon: iconPath()
        })
        notification.on('click', () => {
          win.show()
          win.focus()
        })
        notification.show()
      }
    },

    onReleased: () => {
      if (!getPublicSettings().autoDetectMeetings) return
      if (!isRecording()) return

      const win = BrowserWindow.getAllWindows()[0]
      win?.webContents.send('mic:suggest-stop')

      if (win && !win.isVisible() && Notification.isSupported()) {
        const t = msgs().system.notifications.meetingEnded
        const notification = new Notification({
          title: t.title,
          body: t.body,
          icon: iconPath()
        })
        notification.on('click', () => {
          win.show()
          win.focus()
        })
        notification.show()
      }
    }
  })
}

/** Grants microphone and screen capture without a prompt — that's the app's whole purpose. */
function setupPermissions(): void {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    const allowed = ['media', 'audioCapture', 'display-capture']
    callback(allowed.includes(permission))
  })

  session.defaultSession.setPermissionCheckHandler((_wc, permission) =>
    ['media', 'audioCapture', 'display-capture'].includes(permission)
  )
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  // Second instance: the first one may be hidden in the tray, so reopening it
  // is more useful than just focusing.
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    app.setAppUserModelId('com.yogurt.app')
    // Resolves and applies the UI language before anything builds strings
    // (tray menu, dialogs). Needs `app.getLocale()`, so only after ready.
    getPublicSettings()
    setupDisplayMediaHandler()
    setupPermissions()
    registerIpc()
    reconcileOrphans()
    createTray()
    createWindow()
    setupMicWatcher()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  /**
   * Covers the tray's "Quit", the system shortcut and any internal
   * `app.quit()`. The early return on `isQuitting` avoids asking twice when
   * quitting was already confirmed in the window's close handler.
   */
  app.on('before-quit', (event) => {
    if (isQuitting()) return
    if (!confirmDiscardRecording(BrowserWindow.getAllWindows()[0])) {
      event.preventDefault()
      return
    }
    setQuitting(true)
  })

  app.on('will-quit', () => {
    stopMicWatcher()
    destroyTray()
  })

  app.on('window-all-closed', () => {
    // With `closeToTray` the window is never destroyed by the X, so getting
    // here means a real quit. Without it, this is the normal shutdown path.
    if (process.platform !== 'darwin') app.quit()
  })
}

import { app, ipcMain, dialog, shell, BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AudioSource, SegmentPayload, SettingsUpdate } from '@shared/types'
import { locale, msgs } from '@shared/i18n'
import * as store from './store'
import * as meetings from './meetings'
import { getPublicSettings, updateSettings } from './settings'
import { resetClient, testApiKey } from './openai'
import { formatTimestamp } from './prompts'
import { setRecordingState, type RecordingState } from './appState'
import { estimateCosts } from './costs'

export function registerIpc(): void {
  // ---- Settings ------------------------------------------------------------
  ipcMain.handle('settings:get', () => getPublicSettings())

  ipcMain.handle('settings:update', (_e, update: SettingsUpdate) => {
    const next = updateSettings(update)
    if (update.apiKey !== undefined) resetClient()
    return next
  })

  ipcMain.handle('settings:testKey', () => testApiKey())

  // ---- Meetings ------------------------------------------------------------
  ipcMain.handle('meeting:start', (_e, title: string) => meetings.startMeeting(title))

  ipcMain.handle('meeting:addSegment', (_e, payload: SegmentPayload) => {
    meetings.addSegment(payload)
  })

  ipcMain.handle(
    'meeting:saveNotes',
    (_e, id: string, notes: string, elapsedMs: number | null) => {
      meetings.saveNotes(id, notes, elapsedMs)
    }
  )

  ipcMain.handle('meeting:finish', (_e, id: string, durationMs: number) =>
    meetings.finishMeeting(id, durationMs)
  )

  ipcMain.handle('meeting:list', () => store.listMeetings())

  ipcMain.handle('meeting:get', (_e, id: string) => store.getMeetingDetail(id))

  ipcMain.handle('meeting:rename', (_e, id: string, title: string) =>
    store.patchMeta(id, { title })
  )

  ipcMain.handle('meeting:delete', (_e, id: string) => {
    store.deleteMeeting(id)
  })

  ipcMain.handle('meeting:deleteAudio', (_e, id: string) => {
    store.deleteMeetingAudio(id)
  })

  ipcMain.handle('meeting:costEstimate', (_e, id: string) => estimateCosts(id))

  ipcMain.handle('meeting:regenerate', (_e, id: string) => meetings.regenerateSummary(id))

  ipcMain.handle('meeting:retranscribe', (_e, id: string) => meetings.retranscribe(id))

  // ---- Export --------------------------------------------------------------
  ipcMain.handle(
    'meeting:export',
    async (event, id: string, kind: 'summary' | 'full') => {
      const detail = store.getMeetingDetail(id)
      if (!detail) return { saved: false as const }

      const m = msgs().main.export
      const safeTitle = detail.title.replace(/[\\/:*?"<>|]/g, '-').slice(0, 80)
      const options = {
        title: m.dialogTitle,
        defaultPath: `${safeTitle || m.defaultFileName}.md`,
        filters: [{ name: 'Markdown', extensions: ['md'] }]
      }
      const win = BrowserWindow.fromWebContents(event.sender)
      const { canceled, filePath } = win
        ? await dialog.showSaveDialog(win, options)
        : await dialog.showSaveDialog(options)
      if (canceled || !filePath) return { saved: false as const }

      const parts = [`# ${detail.title}`, '', `_${new Date(detail.createdAt).toLocaleString(locale())} · ${Math.round(detail.durationMs / 60000)} min_`, '']
      if (detail.summary) parts.push(detail.summary, '')
      if (kind === 'full') {
        if (detail.notes.trim()) {
          parts.push('---', '', `## ${m.originalNotes}`, '', detail.notes.trim(), '')
        }
        if (detail.transcript.length) {
          parts.push('---', '', `## ${m.transcript}`, '')
          for (const line of detail.transcript) {
            parts.push(`**[${formatTimestamp(line.start)}]** ${line.text}`, '')
          }
        }
      }

      writeFileSync(filePath, parts.join('\n'), 'utf-8')
      return { saved: true as const, filePath }
    }
  )

  ipcMain.handle('meeting:reveal', (_e, id: string) => {
    shell.openPath(store.meetingDir(id))
  })

  // Writes the full error and the per-block issues to a .txt and opens it in
  // the default editor. On screen the warning is limited to a few lines: long
  // API messages pushed the tabs and the "…" menu out of reach.
  ipcMain.handle('meeting:openErrorReport', async (_e, id: string) => {
    const meta = store.readMeta(id)
    if (!meta) return
    const r = msgs().main.errorReport
    const lines: string[] = [
      r.heading(app.getVersion()),
      `${r.meeting}: ${meta.title}`,
      `${r.date}: ${meta.createdAt}`,
      `${r.generatedAt}: ${new Date().toISOString()}`,
      ''
    ]
    if (meta.error) lines.push(r.error, meta.error, '')
    if (meta.blockIssues?.length) {
      lines.push(r.incompleteBlocks(meta.blockIssues.length))
      for (const issue of meta.blockIssues) {
        const source = issue.source ? ` · ${issue.source === 'mic' ? r.mic : r.system}` : ''
        const detail =
          issue.kind === 'truncated' && issue.coveredSec !== undefined && issue.durationSec
            ? r.truncated(Math.round(issue.coveredSec), Math.round(issue.durationSec)) +
              (issue.outputTokens !== undefined ? ` · ${r.outputTokens(issue.outputTokens)}` : '')
            : issue.message
        lines.push(`- ${r.block(issue.index + 1)}${source}: ${detail}`)
      }
      lines.push('')
    }
    const path = join(store.meetingDir(id), r.fileName)
    writeFileSync(path, lines.join('\r\n'), 'utf-8')
    await shell.openPath(path)
  })

  ipcMain.handle('app:version', () => app.getVersion())

  ipcMain.handle('app:openDataFolder', () => {
    shell.openPath(store.meetingsRoot())
  })

  ipcMain.handle('app:setRecordingState', (_e, state: RecordingState) => {
    setRecordingState(state)
  })

  // ---- Speakers ------------------------------------------------------------
  ipcMain.handle(
    'meeting:readSegment',
    (_e, id: string, index: number, source?: AudioSource) => {
      const buffer = store.readSegment(id, index, source)
      // A Buffer travels over IPC as a Uint8Array; the renderer gets an ArrayBuffer.
      return buffer ? new Uint8Array(buffer) : null
    }
  )

  /**
   * Names (or clears, with `name: null`) several speaker labels at once.
   *
   * In batch, and not one per call, because that is the real volume: in a
   * 45-min meeting diarization produced 59 labels for 3 people, and fixing them
   * one by one meant 55 writes of `meta.json` and 55 events to the renderer. A
   * single write also avoids a half-applied intermediate state if something
   * fails along the way.
   */
  ipcMain.handle(
    'meeting:setSpeakerNames',
    (_e, id: string, labelKeys: string[], name: string | null) => {
      const meta = store.readMeta(id)
      if (!meta) return null
      const next = { ...(meta.speakerNames ?? {}) }
      const trimmed = name?.trim()
      for (const key of labelKeys) {
        if (trimmed) {
          next[key] = trimmed
        } else {
          delete next[key]
        }
      }
      return store.patchMeta(id, {
        speakerNames: Object.keys(next).length > 0 ? next : undefined
      })
    }
  )

}

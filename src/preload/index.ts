import { contextBridge, ipcRenderer } from 'electron'
import type { YogurtApi } from '@shared/api'
import type { Meeting, TranscriptLine } from '@shared/types'

/** Registers a listener and returns the function that removes it. */
function on(channel: string, handler: (...args: unknown[]) => void): () => void {
  const wrapped = (_e: unknown, ...args: unknown[]): void => handler(...args)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

const api: YogurtApi = {
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (update) => ipcRenderer.invoke('settings:update', update),
    testKey: () => ipcRenderer.invoke('settings:testKey')
  },

  meetings: {
    start: (title) => ipcRenderer.invoke('meeting:start', title),
    addSegment: (payload) => ipcRenderer.invoke('meeting:addSegment', payload),
    saveNotes: (id, notes, elapsedMs) =>
      ipcRenderer.invoke('meeting:saveNotes', id, notes, elapsedMs),
    finish: (id, durationMs) => ipcRenderer.invoke('meeting:finish', id, durationMs),
    list: () => ipcRenderer.invoke('meeting:list'),
    get: (id) => ipcRenderer.invoke('meeting:get', id),
    rename: (id, title) => ipcRenderer.invoke('meeting:rename', id, title),
    remove: (id) => ipcRenderer.invoke('meeting:delete', id),
    removeAudio: (id) => ipcRenderer.invoke('meeting:deleteAudio', id),
    costEstimate: (id) => ipcRenderer.invoke('meeting:costEstimate', id),
    regenerate: (id) => ipcRenderer.invoke('meeting:regenerate', id),
    retranscribe: (id) => ipcRenderer.invoke('meeting:retranscribe', id),
    export: (id, kind) => ipcRenderer.invoke('meeting:export', id, kind),
    reveal: (id) => ipcRenderer.invoke('meeting:reveal', id),
    openErrorReport: (id) => ipcRenderer.invoke('meeting:openErrorReport', id),
    readSegment: (id, index, source) =>
      ipcRenderer.invoke('meeting:readSegment', id, index, source),
    setSpeakerNames: (id, labelKeys, name) =>
      ipcRenderer.invoke('meeting:setSpeakerNames', id, labelKeys, name)
  },

  app: {
    version: () => ipcRenderer.invoke('app:version'),
    openDataFolder: () => ipcRenderer.invoke('app:openDataFolder'),
    setRecordingState: (state) => ipcRenderer.invoke('app:setRecordingState', state)
  },

  events: {
    onMeetingUpdated: (cb) => on('meeting:updated', (...args) => cb(args[0] as Meeting)),

    onTranscript: (cb) =>
      on('meeting:transcript', (...args) =>
        cb(args[0] as string, args[1] as TranscriptLine[])
      ),

    onSegmentError: (cb) =>
      on('meeting:segment-error', (...args) =>
        cb(args[0] as string, args[1] as number, args[2] as string)
      ),

    onSuggestStart: (cb) => on('mic:suggest-start', (...args) => cb(args[0] as string[])),

    onSuggestStop: (cb) => on('mic:suggest-stop', () => cb())
  }
}

contextBridge.exposeInMainWorld('yogurt', api)

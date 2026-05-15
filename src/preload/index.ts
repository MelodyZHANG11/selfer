import { contextBridge, ipcRenderer } from 'electron'
import type { DigestQueueChangeEvent, SelferAPI } from '@shared/types'

const api: SelferAPI = {
  reindex: () => ipcRenderer.invoke('selfer:reindex'),
  listSessions: (filters) => ipcRenderer.invoke('selfer:listSessions', filters),
  listProjects: () => ipcRenderer.invoke('selfer:listProjects'),
  listTags: () => ipcRenderer.invoke('selfer:listTags'),
  getSession: (id) => ipcRenderer.invoke('selfer:getSession', id),
  setCustomName: (id, name) => ipcRenderer.invoke('selfer:setCustomName', id, name),
  addTag: (id, tag) => ipcRenderer.invoke('selfer:addTag', id, tag),
  removeTag: (id, tag) => ipcRenderer.invoke('selfer:removeTag', id, tag),
  editMessage: (id, eventUuid, newText) =>
    ipcRenderer.invoke('selfer:editMessage', id, eventUuid, newText),
  deleteMessage: (id, eventUuid) =>
    ipcRenderer.invoke('selfer:deleteMessage', id, eventUuid),
  revertEdits: (id) => ipcRenderer.invoke('selfer:revertEdits', id),
  generateDigest: (date) => ipcRenderer.invoke('selfer:generateDigest', date),
  getDigestQueueStatus: () => ipcRenderer.invoke('selfer:getDigestQueueStatus'),
  onDigestQueueChanged: (cb) => {
    const listener = (_e: unknown, evt: DigestQueueChangeEvent): void => cb(evt)
    ipcRenderer.on('selfer:digestQueue:changed', listener)
    return () => {
      ipcRenderer.removeListener('selfer:digestQueue:changed', listener)
    }
  },
  listDigests: () => ipcRenderer.invoke('selfer:listDigests'),
  readDigest: (path) => ipcRenderer.invoke('selfer:readDigest', path),
  getDigestDoc: (date) => ipcRenderer.invoke('selfer:getDigestDoc', date),
  getDigestDocLocalized: (date, lang) =>
    ipcRenderer.invoke('selfer:getDigestDocLocalized', date, lang),
  listAvailableTranslations: (date) =>
    ipcRenderer.invoke('selfer:listAvailableTranslations', date),
  listDigestTimeline: (date) => ipcRenderer.invoke('selfer:listDigestTimeline', date),
  refineDigestSection: (args) => ipcRenderer.invoke('selfer:refineDigestSection', args),
  revertDigestRefine: (date, sectionId, itemId) =>
    ipcRenderer.invoke('selfer:revertDigestRefine', date, sectionId, itemId),
  todayLocalDate: () => ipcRenderer.invoke('selfer:todayLocalDate'),
  getDigestSchedule: () => ipcRenderer.invoke('selfer:getDigestSchedule'),
  getSettings: () => ipcRenderer.invoke('selfer:getSettings'),
  saveSettings: (s) => ipcRenderer.invoke('selfer:saveSettings', s),
  getStats: () => ipcRenderer.invoke('selfer:getStats'),
  listOpenAIModels: (baseUrl, apiKey) =>
    ipcRenderer.invoke('selfer:listOpenAIModels', baseUrl, apiKey),
  listSshAliases: () => ipcRenderer.invoke('selfer:listSshAliases'),
  testSshHost: (alias) => ipcRenderer.invoke('selfer:testSshHost', alias),
  syncSshHost: (alias) => ipcRenderer.invoke('selfer:syncSshHost', alias)
}

contextBridge.exposeInMainWorld('selfer', api)

import { app, BrowserWindow, nativeImage, shell } from 'electron'
import path from 'node:path'
import { registerIpc } from './ipc'
import { ensureSelferDirs } from './fs'
import { openDb, migrate } from './db'
import { Indexer } from './indexer'
import { buildAdapters } from './buildAdapters'
import { DigestScheduler } from './digestScheduler'
import { DigestQueue } from './digestQueue'
import iconAsset from '../../build/icon.png?asset'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    title: 'Selfer',
    titleBarStyle: 'hiddenInset',
    icon: iconAsset,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  // macOS dev: the Dock icon is otherwise the default Electron icon.
  // In a packaged .app, macOS picks the icon from Info.plist (electron-builder) so this is dev-time polish.
  if (process.platform === 'darwin' && app.dock) {
    try {
      app.dock.setIcon(nativeImage.createFromPath(iconAsset))
    } catch (err) {
      console.warn('[main] failed to set dock icon:', err)
    }
  }

  ensureSelferDirs()
  const db = openDb()
  migrate(db)

  const built = buildAdapters()
  const indexer = new Indexer(db, built)
  const digestScheduler = new DigestScheduler(db)
  const digestQueue = new DigestQueue(db)
  digestQueue.onChange((evt) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('selfer:digestQueue:changed', evt)
    }
  })
  registerIpc({ db, indexer, digestScheduler, digestQueue })

  // Initial scan (non-blocking)
  indexer.reindexAll().catch((err) => console.error('[indexer] initial scan failed:', err))
  indexer.startWatching()
  digestScheduler.start()

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

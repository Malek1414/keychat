const { app, BrowserWindow, session, shell, systemPreferences, Menu } = require('electron')
const path = require('node:path')

const DEV_URL = process.env.KEYCHAT_DEV_URL

function createWindow() {
  const mac = process.platform === 'darwin'
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 420,
    minHeight: 520,
    title: 'KeyChat',
    backgroundColor: '#00000000',
    show: false,
    ...(mac ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 20 } } : { autoHideMenuBar: true }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  })

  win.once('ready-to-show', () => win.show())

  // Links in answers open in the real browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    const own = DEV_URL ? url.startsWith(DEV_URL) : url.startsWith('file:')
    if (!own) {
      e.preventDefault()
      if (/^https?:/.test(url)) void shell.openExternal(url)
    }
  })

  if (DEV_URL) void win.loadURL(DEV_URL)
  else void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
}

app.whenReady().then(async () => {
  // The microphone is the only permission the app asks for (dictation + voice mode).
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media' || permission === 'clipboard-sanitized-write')
  })
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media')
  if (process.platform === 'darwin') {
    try {
      await systemPreferences.askForMediaAccess('microphone')
    } catch {
      /* user can still grant later in System Settings */
    }
  }
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null)

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

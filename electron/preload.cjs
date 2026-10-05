const { contextBridge } = require('electron')

// Lets the web app know it's running as the desktop app (for title-bar spacing).
contextBridge.exposeInMainWorld('desktop', { platform: process.platform })

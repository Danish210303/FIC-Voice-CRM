import { app, BrowserWindow, ipcMain, Notification, shell, dialog, session } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

// Enable WebRTC user media, UDP/STUN traffic, and audio autoplay flags
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('enable-usermedia-screen-capturing');
app.commandLine.appendSwitch('allow-http-screen-capture');
app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'default');
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');
app.commandLine.appendSwitch('enable-webrtc-pipewire-capturer');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Ensure single instance of the application
const gotTheLock = app.requestSingleInstanceLock();

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  mainWindow = new BrowserWindow({
    width: 1300,
    height: 850,
    minWidth: 1050,
    minHeight: 650,
    frame: false, // Sleek custom titlebar
    titleBarStyle: 'hidden',
    backgroundColor: '#0b0f17',
    icon: path.join(__dirname, '../public/login.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      sandbox: false,
    },
  });

  // Security: Prevent unhandled new windows, open in OS browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Guard against navigating away from the HTML file bundle
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file:') && !url.startsWith('http://localhost')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Load app: Dev server URL or built index.html
  const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
  if (isDev) {
    mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html')).catch((err) => {
      console.error("Failed to load index.html:", err);
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    // Explicitly grant microphone and WebRTC media permissions in Electron
    session.defaultSession.setPermissionRequestHandler((_, permission, callback) => {
      const allowedPermissions = ['media', 'audioCapture', 'mediaKeySystem', 'notifications'];
      callback(allowedPermissions.includes(permission));
    });

    session.defaultSession.setPermissionCheckHandler((_, permission) => {
      const allowedPermissions = ['media', 'audioCapture', 'mediaKeySystem', 'notifications'];
      return allowedPermissions.includes(permission);
    });

    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handlers for window controls & native features
ipcMain.on('window:minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window:maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on('window:close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.handle('window:isMaximized', () => {
  return mainWindow ? mainWindow.isMaximized() : false;
});

ipcMain.handle('app:version', () => {
  return app.getVersion();
});

ipcMain.on('app:notification', (_, { title, body }: { title: string; body: string }) => {
  if (Notification.isSupported()) {
    new Notification({ title, body, icon: path.join(__dirname, '../public/login.png') }).show();
  }
});

ipcMain.on('app:openExternal', (_, url: string) => {
  if (url && (url.startsWith('http:') || url.startsWith('https:'))) {
    shell.openExternal(url);
  }
});

ipcMain.handle('dialog:openCSVFile', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select CSV File',
    properties: ['openFile'],
    filters: [
      { name: 'CSV Files', extensions: ['csv'] }
    ]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const filePath = result.filePaths[0];
  const fileBuffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);

  return {
    filePath,
    fileName,
    content: fileBuffer.toString('utf-8')
  };
});


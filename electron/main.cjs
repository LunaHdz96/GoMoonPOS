const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');
const { openDb } = require('./db.cjs');
const { createService } = require('./service.cjs');

let service;
let mainWindow;
let updateStatus = { state: 'idle' };
const iconPath = app.isPackaged
  ? path.join(process.resourcesPath, 'icon.ico')
  : path.join(__dirname, '..', 'build', 'icon.ico');

function publishUpdateStatus(status) {
  updateStatus = status;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update-status', status);
}

function configureAutoUpdater() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => publishUpdateStatus({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => publishUpdateStatus({ state: 'available', version: info.version }));
  autoUpdater.on('update-not-available', () => publishUpdateStatus({ state: 'none' }));
  autoUpdater.on('download-progress', (progress) => publishUpdateStatus({
    state: 'downloading',
    percent: Math.round(progress.percent),
  }));
  autoUpdater.on('update-downloaded', (info) => publishUpdateStatus({ state: 'downloaded', version: info.version }));
  autoUpdater.on('error', (error) => publishUpdateStatus({ state: 'error', message: error.message }));
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'GoMoonPOS',
    icon: iconPath,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/wa\.me\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  if (process.env.ELECTRON_DEV) await mainWindow.loadURL('http://localhost:5173');
  else await mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

app.whenReady().then(async () => {
  const db = await openDb(path.join(app.getPath('userData'), 'gomoonpos.sqlite'));
  service = createService(db);
  ipcMain.handle('api', async (_e, method, args) => {
    try {
      return { ok: true, data: await service.call(method, args) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  await createWindow();
  configureAutoUpdater();
  ipcMain.handle('updates.status', () => updateStatus);
  ipcMain.handle('updates.check', async () => {
    if (!app.isPackaged) throw new Error('Las actualizaciones sólo se consultan en la aplicación instalada');
    await autoUpdater.checkForUpdates();
    return updateStatus;
  });
  ipcMain.handle('updates.download', async () => {
    if (updateStatus.state !== 'available') throw new Error('No hay una actualización disponible');
    await autoUpdater.downloadUpdate();
    return updateStatus;
  });
  ipcMain.handle('updates.install', () => {
    if (updateStatus.state !== 'downloaded') throw new Error('La actualización aún no se ha descargado');
    autoUpdater.quitAndInstall();
  });
  if (app.isPackaged) autoUpdater.checkForUpdates().catch((error) => publishUpdateStatus({ state: 'error', message: error.message }));
});

app.on('window-all-closed', () => app.quit());

/**
 * Desktop shell: shows the web build of the app (desktop/dist, made by
 * `npm run desktop:build`) in a window. No bundled Electron — it runs on the
 * system one: `electron42 desktop`.
 *
 * The bundle is served from a private app:// scheme rather than file://, so
 * its absolute asset paths resolve and localStorage (where the encrypted vault
 * lives, under ~/.config/Iron2FA) has a stable origin. Every other request is
 * refused: the app needs no network, so it gets none.
 */
const { app, BrowserWindow, net, protocol, session, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DIST = path.join(__dirname, 'dist');
const ORIGIN = 'app://iron2fa';

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win = null;

  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    protocol.handle('app', (request) => {
      const url = new URL(request.url);
      const file = path.normalize(path.join(DIST, decodeURIComponent(url.pathname)));
      if (url.host !== 'iron2fa' || (file !== DIST && !file.startsWith(DIST + path.sep))) {
        return new Response('Not found', { status: 404 });
      }
      return net.fetch(pathToFileURL(file === DIST ? path.join(DIST, 'index.html') : file).toString());
    });

    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      const ok = details.url.startsWith(ORIGIN + '/') || details.url.startsWith('blob:') ||
        details.url.startsWith('data:') || details.url.startsWith('devtools:') || details.url.startsWith('file:');
      callback({ cancel: !ok });
    });
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(permission === 'clipboard-sanitized-write');
    });

    win = new BrowserWindow({
      width: 440,
      height: 760,
      minWidth: 340,
      minHeight: 480,
      backgroundColor: '#14161a',
      autoHideMenuBar: true,
      title: 'Iron2FA',
      icon: path.join(__dirname, 'icon.png'),
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, url) => {
      if (!url.startsWith(ORIGIN + '/')) event.preventDefault();
    });
    win.loadURL(ORIGIN + '/index.html');
    win.on('closed', () => {
      win = null;
    });
  });

  app.on('window-all-closed', () => app.quit());
}

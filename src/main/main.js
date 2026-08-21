'use strict';

const { app, ipcMain, dialog, session, Menu, shell, nativeImage } = require('electron');

const { Store } = require('./store');
const { AccountStore } = require('./accounts');
const { AppWindow } = require('./window');
const { AppTray } = require('./tray');
const { buildMenu } = require('./menu');
const avatars = require('./avatars');
const { APP_ID, isAllowedHost } = require('./config');

const isDev = process.argv.includes('--dev') || !app.isPackaged;
const startHidden = process.argv.includes('--hidden');

app.isQuitting = false;

// Must happen before 'ready': it becomes the Wayland app_id / X11 WM_CLASS that
// the desktop environment matches against the installed .desktop file.
app.setDesktopName(APP_ID);

// A chat client is only useful if accounts keep running while you are not
// looking at them. `backgroundThrottling: false` covers an unfocused window,
// but a *hidden* one — minimised, or closed to the tray — still gets its
// renderers suspended, which stops message delivery and notifications. These
// are the Chromium switches every desktop messenger sets for the same reason.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

// A second launch must hand focus to the running window rather than opening a
// rival instance that fights over the same session directories.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

const settings = new Store('settings.json', {
  closeToTray: true,
  startMinimized: false,
  spellcheckLanguages: [],
  useWaylandOzone: false,
  window: null
});

if (settings.get('useWaylandOzone') && process.env.WAYLAND_DISPLAY) {
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
  app.commandLine.appendSwitch('enable-features', 'WaylandWindowDecorations');
}

const accounts = new AccountStore();
let appWindow = null;
let tray = null;
// Last avatar URL fetched per account, so a repeated report costs nothing.
const lastAvatarSrc = new Map();

app.on('second-instance', () => appWindow?.show());

// A session logout tears the whole cgroup down at once: the zygote and GPU
// helper processes die before the main process does, Chromium's attempts to
// respawn the GPU process then fail, and it aborts with a deliberate SIGTRAP
// ("GPU process isn't usable. Goodbye.") — which Ubuntu's apport reports as an
// app crash on next login. Treat termination signals as an orderly shutdown
// instead: persist state and leave before Chromium enters that race.
for (const signal of ['SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    app.isQuitting = true;
    try {
      appWindow?.saveWindowState();
      tray?.destroy();
    } catch {
      /* exiting anyway */
    }
    app.exit(0);
  });
}

app.whenReady().then(() => {
  // startHidden is passed as its own flag rather than written into settings:
  // mutating settings.data here would get persisted by the next save (window
  // state is saved on every close), turning a one-off --hidden launch into a
  // permanent start-minimised preference.
  appWindow = new AppWindow({
    accounts,
    settings,
    isDev,
    startHidden: startHidden || !!settings.get('startMinimized')
  });
  appWindow.create();

  tray = new AppTray({ appWindow, accounts });
  tray.create();
  appWindow.onUnreadChange = () => tray?.refresh();
  // Keeps menu and tray radio marks honest when the active account changes by
  // any route — sidebar click, Ctrl+Tab, notification click.
  appWindow.onActiveChange = () => refreshMenus();

  refreshMenus();
  registerIpc();
});

app.on('window-all-closed', () => {
  // With close-to-tray on, the window hides instead of closing, so reaching
  // here means the user really did close it and expects the app to exit.
  if (!settings.get('closeToTray') || !tray?.tray) app.quit();
});

app.on('before-quit', () => {
  app.isQuitting = true;
  appWindow?.saveWindowState();
});

app.on('will-quit', () => tray?.destroy());

/* -------------------------------------------------------------------- */
/* Menus                                                                */
/* -------------------------------------------------------------------- */

function refreshMenus() {
  buildMenu({ appWindow, accounts, onAddAccount: () => addAccount() });
  tray?.refresh();
  appWindow?.pushAccounts();
}

/* -------------------------------------------------------------------- */
/* Account operations                                                   */
/* -------------------------------------------------------------------- */

function addAccount(name) {
  const account = accounts.add(name);
  appWindow.ensureView(account.id);
  appWindow.setActive(account.id);
  refreshMenus();
  return account;
}

async function removeAccount(accountId) {
  const account = accounts.get(accountId);
  if (!account) return false;

  const { response } = await dialog.showMessageBox(appWindow.window, {
    type: 'warning',
    buttons: ['Cancel', 'Remove account'],
    defaultId: 0,
    cancelId: 0,
    title: 'Remove account',
    message: `Remove “${account.name}”?`,
    detail:
      'This logs the account out of this app and deletes its local session ' +
      'data. Your chats stay on your phone and on WhatsApp’s servers — ' +
      'nothing is deleted there. You can link the account again later.'
  });
  if (response !== 1) return false;

  const partition = accounts.partitionFor(accountId);
  appWindow.removeView(accountId);
  accounts.remove(accountId);
  avatars.remove(accountId);
  lastAvatarSrc.delete(accountId);

  try {
    const ses = session.fromPartition(partition);
    await ses.clearStorageData();
    await ses.clearCache();
  } catch (err) {
    console.error('[main] failed to clear session data:', err.message);
  }

  const next = accounts.activeId();
  if (next) appWindow.setActive(next);
  refreshMenus();
  return true;
}

/* -------------------------------------------------------------------- */
/* IPC                                                                  */
/* -------------------------------------------------------------------- */

function registerIpc() {
  /** Only the sidebar view may drive account management. */
  const fromSidebar = (event) =>
    appWindow?.sidebar && event.sender === appWindow.sidebar.webContents;

  /** Map an account webContents back to its account id. */
  const accountIdFor = (event) => {
    for (const [id, view] of appWindow?.views || []) {
      if (view.webContents === event.sender) return id;
    }
    return null;
  };

  ipcMain.handle('accounts:list', (event) => {
    if (!fromSidebar(event)) return null;
    appWindow.pushAccounts();
    return true;
  });

  ipcMain.handle('accounts:add', (event) => {
    if (!fromSidebar(event)) return null;
    return addAccount();
  });

  ipcMain.handle('accounts:remove', async (event, id) => {
    if (!fromSidebar(event)) return false;
    return removeAccount(id);
  });

  ipcMain.handle('accounts:rename', (event, id, name) => {
    if (!fromSidebar(event)) return null;
    const clean = String(name || '').trim().slice(0, 40);
    if (!clean) return null;
    const updated = accounts.update(id, { name: clean });
    refreshMenus();
    return updated;
  });

  ipcMain.on('accounts:activate', (event, id) => {
    if (!fromSidebar(event)) return;
    appWindow.setActive(id);
  });

  ipcMain.on('accounts:reload', (event, id) => {
    if (!fromSidebar(event)) return;
    appWindow.views.get(id)?.webContents.reload();
  });

  ipcMain.on('accounts:mute', (event, id, muted) => {
    if (!fromSidebar(event)) return;
    accounts.update(id, { muted: !!muted });
    refreshMenus();
  });

  ipcMain.on('accounts:reorder', (event, ids) => {
    if (!fromSidebar(event) || !Array.isArray(ids)) return;
    accounts.reorder(ids.map(String));
    refreshMenus();
  });

  ipcMain.on('accounts:context-menu', (event, id) => {
    if (!fromSidebar(event)) return;
    const account = accounts.get(id);
    if (!account) return;
    Menu.buildFromTemplate([
      { label: account.name, enabled: false },
      { type: 'separator' },
      { label: 'Reload', click: () => appWindow.views.get(id)?.webContents.reload() },
      {
        label: 'Mute notifications',
        type: 'checkbox',
        checked: !!account.muted,
        click: (item) => {
          accounts.update(id, { muted: item.checked });
          refreshMenus();
        }
      },
      { type: 'separator' },
      { label: 'Remove account…', click: () => removeAccount(id) }
    ]).popup({ window: appWindow.window });
  });

  ipcMain.on('app:open-external', (event, url) => {
    if (!fromSidebar(event)) return;
    if (/^https:\/\//.test(String(url))) shell.openExternal(url);
  });

  ipcMain.on('ui:overlay', (event, open) => {
    if (!fromSidebar(event)) return;
    appWindow.setOverlay(open);
  });

  ipcMain.handle('settings:get', (event) => {
    if (!fromSidebar(event)) return null;
    return {
      closeToTray: !!settings.get('closeToTray'),
      startMinimized: !!settings.get('startMinimized'),
      useWaylandOzone: !!settings.get('useWaylandOzone')
    };
  });

  ipcMain.handle('settings:set', (event, key, value) => {
    if (!fromSidebar(event)) return null;
    // Allowlisted so the renderer cannot write arbitrary keys into settings.
    if (!['closeToTray', 'startMinimized', 'useWaylandOzone'].includes(key)) {
      return null;
    }
    settings.set(key, !!value);
    return true;
  });

  // The preload found the user's photo but cannot read its pixels: the CDN
  // serves it without CORS headers, so a canvas in the page would be tainted.
  // Fetched here instead — the main process is not subject to CORS — through
  // the account's own session, then normalised to a 96px PNG.
  ipcMain.on('account:avatar-src', async (event, url) => {
    const id = accountIdFor(event);
    if (!id) return;

    let parsed;
    try {
      parsed = new URL(String(url));
    } catch {
      return;
    }
    if (parsed.protocol !== 'https:' || !isAllowedHost(parsed.href)) return;
    if (lastAvatarSrc.get(id) === parsed.href) return;

    try {
      const response = await event.sender.session.fetch(parsed.href);
      if (!response.ok) return;
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length === 0 || buffer.length > 5 * 1024 * 1024) return;

      const image = nativeImage.createFromBuffer(buffer);
      if (image.isEmpty()) return;
      const png = image.resize({ width: 96, height: 96 }).toPNG();

      lastAvatarSrc.set(id, parsed.href);
      appWindow.setAvatar(id, `data:image/png;base64,${png.toString('base64')}`);
      if (isDev) console.log(`[avatar] ${accounts.get(id)?.name}: fetched OK`);
    } catch (err) {
      console.error('[main] avatar fetch failed:', err.message);
    }
  });

  // Sent by the account preload once it can find the signed-in user's photo.
  ipcMain.on('account:avatar', (event, dataUrl, diagnostic) => {
    const id = accountIdFor(event);
    if (!id) return;
    if (isDev && diagnostic) {
      console.log(`[avatar] ${accounts.get(id)?.name}:`, JSON.stringify(diagnostic));
    }
    if (dataUrl) appWindow.setAvatar(id, dataUrl);
  });

  // Fired by the notification hook injected into a WhatsApp page.
  ipcMain.on('account:notification-click', (event) => {
    const id = accountIdFor(event);
    if (!id) return;
    appWindow.show();
    appWindow.setActive(id);
  });
}

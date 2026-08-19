'use strict';

const { app, ipcMain, dialog, session, Menu, shell } = require('electron');

const { Store } = require('./store');
const { AccountStore } = require('./accounts');
const { AppWindow } = require('./window');
const { AppTray } = require('./tray');
const { buildMenu } = require('./menu');
const avatars = require('./avatars');
const { APP_ID } = require('./config');

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

app.on('second-instance', () => appWindow?.show());

app.whenReady().then(() => {
  appWindow = new AppWindow({ accounts, settings, isDev });
  if (startHidden || settings.get('startMinimized')) {
    settings.data.startMinimized = true; // honoured by create(), not persisted
  }
  appWindow.create();

  tray = new AppTray({ appWindow, accounts });
  tray.create();
  appWindow.onUnreadChange = () => tray?.refresh();

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
    refreshMenus();
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
    refreshMenus();
  });
}

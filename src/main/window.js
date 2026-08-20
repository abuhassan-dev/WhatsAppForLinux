'use strict';

const path = require('path');
const { BaseWindow, WebContentsView, shell, app } = require('electron');

const avatars = require('./avatars');
const { setupSession } = require('./session');
const { attachContextMenu, setZoom, stepZoom } = require('./context-menu');
const {
  WHATSAPP_URL,
  SIDEBAR_WIDTH,
  DEFAULT_WINDOW,
  isAllowedHost
} = require('./config');

const RENDERER = path.join(__dirname, '..', 'renderer');
const PRELOAD = path.join(__dirname, '..', 'preload');

// Injected into the page's main world. The isolated preload cannot patch the
// page's own `window.Notification`, so the hook lives here and reports back
// over a DOM event — the DOM is the one thing both worlds share.
const NOTIFICATION_HOOK = `(() => {
  if (window.__waflNotificationHook) return;
  window.__waflNotificationHook = true;
  const Native = window.Notification;
  if (!Native) return;
  function Wrapped(title, options) {
    const notification = new Native(title, options);
    notification.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('wafl:notification-click'));
    });
    return notification;
  }
  Wrapped.prototype = Native.prototype;
  Wrapped.requestPermission = (...args) => Native.requestPermission(...args);
  Object.defineProperty(Wrapped, 'permission', { get: () => Native.permission });
  window.Notification = Wrapped;
})();`;

class AppWindow {
  /**
   * @param {object} deps
   * @param {import('./accounts').AccountStore} deps.accounts
   * @param {import('./store').Store} deps.settings
   * @param {boolean} deps.isDev
   */
  constructor({ accounts, settings, isDev, startHidden = false }) {
    this.accounts = accounts;
    this.settings = settings;
    this.isDev = isDev;
    this.startHidden = startHidden;

    /** @type {Map<string, WebContentsView>} */
    this.views = new Map();
    /** @type {Map<string, number>} */
    this.unread = new Map();
    /** @type {Map<string, string>} account id -> PNG data URL */
    this.avatars = new Map();

    this.window = null;
    this.sidebar = null;
    this.overlayOpen = false;
    this.onUnreadChange = null;
    this.onActiveChange = null;
  }

  /* ------------------------------------------------------------------ */
  /* Lifecycle                                                          */
  /* ------------------------------------------------------------------ */

  create() {
    const saved = this.settings.get('window') || {};
    this.window = new BaseWindow({
      width: saved.width || DEFAULT_WINDOW.width,
      height: saved.height || DEFAULT_WINDOW.height,
      x: saved.x,
      y: saved.y,
      minWidth: DEFAULT_WINDOW.minWidth,
      minHeight: DEFAULT_WINDOW.minHeight,
      title: 'WhatsAppForLinux',
      backgroundColor: '#111b21',
      autoHideMenuBar: true,
      icon: path.join(__dirname, '..', 'assets', 'icon.png'),
      show: false
    });

    if (saved.maximized) this.window.maximize();

    this._createSidebar();
    this.window.on('resize', () => this._layout());
    this.window.on('maximize', () => this._layout());
    this.window.on('unmaximize', () => this._layout());
    this.window.on('close', (event) => this._onClose(event));
    this.window.on('closed', () => {
      // The views' webContents are not destroyed with the window; left alone
      // they would keep running (unthrottled, by design) with no window at all.
      for (const view of this.views.values()) {
        if (!view.webContents.isDestroyed()) view.webContents.close();
      }
      if (this.sidebar && !this.sidebar.webContents.isDestroyed()) {
        this.sidebar.webContents.close();
      }
      this.views.clear();
      this.unread.clear();
      this.window = null;
      this.sidebar = null;
    });

    // BaseWindow emits no ready-to-show, so the sidebar painting is the cue.
    this.sidebar.webContents.once('did-finish-load', () => {
      if (!this.startHidden) this.window?.show();
      this.pushAccounts();
    });

    for (const account of this.accounts.all()) {
      const stored = avatars.load(account.id);
      if (stored) this.avatars.set(account.id, stored);
    }

    // Every account loads at startup, not just the visible one — a messenger
    // that only receives messages for the tab you are looking at is useless.
    for (const [index, account] of this.accounts.all().entries()) {
      setTimeout(() => this.ensureView(account.id), index * 400);
    }

    const activeId = this.accounts.activeId() || this.accounts.all()[0]?.id;
    if (activeId) this.setActive(activeId);

    return this.window;
  }

  _createSidebar() {
    this.sidebar = new WebContentsView({
      webPreferences: {
        preload: path.join(PRELOAD, 'sidebar.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false
      }
    });
    // Transparent: when a sheet is open this view covers the whole window,
    // and the rail paints its own background in CSS.
    this.sidebar.setBackgroundColor('#00000000');
    this.sidebar.webContents.loadFile(path.join(RENDERER, 'index.html'));
    this.window.contentView.addChildView(this.sidebar);

    // The sidebar is local UI; it has no business navigating anywhere.
    this.sidebar.webContents.setWindowOpenHandler(({ url }) => {
      openExternally(url);
      return { action: 'deny' };
    });
    this.sidebar.webContents.on('will-navigate', (event) => event.preventDefault());

    this._layout();
  }

  /* ------------------------------------------------------------------ */
  /* Account views                                                      */
  /* ------------------------------------------------------------------ */

  ensureView(accountId) {
    if (this.views.has(accountId)) return this.views.get(accountId);
    const account = this.accounts.get(accountId);
    if (!account || !this.window) return null;

    const ses = setupSession(this.accounts.partitionFor(accountId), {
      spellcheckLanguages: this.settings.get('spellcheckLanguages')
    });

    const view = new WebContentsView({
      webPreferences: {
        session: ses,
        preload: path.join(PRELOAD, 'whatsapp.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: true,
        // Background accounts must keep ticking to receive messages.
        backgroundThrottling: false
      }
    });
    view.setBackgroundColor('#111b21');

    const wc = view.webContents;
    this._wireAccountWebContents(accountId, wc);

    this.views.set(accountId, view);
    this.window.contentView.addChildView(view);
    view.setVisible(accountId === this.accounts.activeId());
    this._layout();

    wc.setZoomLevel(account.zoom || 0);
    wc.loadURL(WHATSAPP_URL);
    return view;
  }

  _wireAccountWebContents(accountId, wc) {
    // Anything that is not WhatsApp opens in the user's real browser.
    wc.setWindowOpenHandler(({ url }) => {
      openExternally(url);
      return { action: 'deny' };
    });

    wc.on('will-navigate', (event, url) => {
      if (!isAllowedHost(url)) {
        event.preventDefault();
        openExternally(url);
      }
    });

    wc.on('will-frame-navigate', (event) => {
      if (event.isMainFrame) return;
      if (!isAllowedHost(event.url)) event.preventDefault();
    });

    wc.on('page-title-updated', (_event, title) => {
      this._setUnread(accountId, parseUnread(title));
    });

    wc.on('dom-ready', () => {
      wc.setZoomLevel(this.accounts.get(accountId)?.zoom || 0);
      wc.executeJavaScript(NOTIFICATION_HOOK, true).catch((err) => {
        console.error('[window] notification hook failed:', err.message);
      });
    });

    wc.on('render-process-gone', (_event, details) => {
      console.error(`[window] account ${accountId} renderer gone: ${details.reason}`);
      if (details.reason !== 'clean-exit' && !wc.isDestroyed()) wc.reload();
    });

    attachContextMenu(wc, {
      isDev: this.isDev,
      onZoomChange: (level) => this.accounts.update(accountId, { zoom: level })
    });
  }

  setAvatar(accountId, dataUrl) {
    if (!this.accounts.get(accountId)) return;
    if (this.avatars.get(accountId) === dataUrl) return;
    if (!avatars.save(accountId, dataUrl)) return;
    this.avatars.set(accountId, dataUrl);
    this.pushAccounts();
  }

  removeView(accountId) {
    const view = this.views.get(accountId);
    if (!view) return;
    this.window?.contentView.removeChildView(view);
    if (!view.webContents.isDestroyed()) view.webContents.close();
    this.views.delete(accountId);
    this.unread.delete(accountId);
    this.avatars.delete(accountId);
  }

  /* ------------------------------------------------------------------ */
  /* Switching, layout, unread                                          */
  /* ------------------------------------------------------------------ */

  setActive(accountId) {
    if (!this.accounts.get(accountId)) return;
    this.accounts.setActive(accountId);
    this.ensureView(accountId);
    for (const [id, view] of this.views) {
      view.setVisible(id === accountId);
    }
    const active = this.views.get(accountId);
    active?.webContents.focus();
    // Now that this view is on screen it will actually render, so it is the
    // only moment its avatar can be read.
    if (active && !active.webContents.isDestroyed()) {
      active.webContents.send('wafl:extract-avatar');
    }
    this._layout();
    this.pushAccounts();
    this.onActiveChange?.();
  }

  cycleAccount(step) {
    const ids = this.accounts.all().map((a) => a.id);
    if (ids.length < 2) return;
    const current = ids.indexOf(this.accounts.activeId());
    const next = (current + step + ids.length) % ids.length;
    this.setActive(ids[next]);
  }

  activeWebContents() {
    const view = this.views.get(this.accounts.activeId());
    return view && !view.webContents.isDestroyed() ? view.webContents : null;
  }

  /**
   * Expand the sidebar view across the window so a modal sheet has room, and
   * raise it above the account views. Re-adding a child view is how Electron
   * reorders it to the top.
   */
  setOverlay(open) {
    this.overlayOpen = !!open;
    if (this.overlayOpen && this.sidebar) {
      this.window?.contentView.addChildView(this.sidebar);
    }
    this._layout();
    if (!this.overlayOpen) this.activeWebContents()?.focus();
  }

  _layout() {
    if (!this.window) return;
    const { width, height } = this.window.getContentBounds();
    // The rail is always shown: it holds the "add account" button, so hiding
    // it when the last account is removed would leave no way to add one.
    const railWidth = SIDEBAR_WIDTH;

    this.sidebar?.setBounds({
      x: 0,
      y: 0,
      width: this.overlayOpen ? width : railWidth,
      height
    });
    for (const view of this.views.values()) {
      view.setBounds({
        x: railWidth,
        y: 0,
        width: Math.max(0, width - railWidth),
        height
      });
    }
  }

  _setUnread(accountId, count) {
    if (this.unread.get(accountId) === count) return;
    this.unread.set(accountId, count);
    this.pushAccounts();

    const total = [...this.unread.entries()].reduce((sum, [id, n]) => {
      return this.accounts.get(id)?.muted ? sum : sum + n;
    }, 0);
    if (app.isReady()) app.setBadgeCount(total);
    this.onUnreadChange?.(total);
  }

  totalUnread() {
    return [...this.unread.entries()].reduce((sum, [id, n]) => {
      return this.accounts.get(id)?.muted ? sum : sum + n;
    }, 0);
  }

  /** Serialise account state down to the sidebar renderer. */
  pushAccounts() {
    if (!this.sidebar || this.sidebar.webContents.isDestroyed()) return;
    this.sidebar.webContents.send('accounts:state', {
      accounts: this.accounts.all().map((account) => ({
        id: account.id,
        name: account.name,
        color: account.color,
        muted: !!account.muted,
        unread: this.unread.get(account.id) || 0,
        avatar: this.avatars.get(account.id) || null,
        loading: !this.views.has(account.id)
      })),
      activeId: this.accounts.activeId()
    });
  }

  /* ------------------------------------------------------------------ */
  /* Window helpers                                                     */
  /* ------------------------------------------------------------------ */

  zoom(delta) {
    const wc = this.activeWebContents();
    if (!wc) return;
    const accountId = this.accounts.activeId();
    const commit = (level) => this.accounts.update(accountId, { zoom: level });
    if (delta === 0) setZoom(wc, 0, commit);
    else stepZoom(wc, delta, commit);
  }

  show() {
    // The window may have been destroyed while the tray kept the app alive.
    if (!this.window) {
      this.startHidden = false;
      this.create();
    }
    if (this.window.isMinimized()) this.window.restore();
    this.window.show();
    this.window.focus();
  }

  toggle() {
    if (!this.window) return this.show();
    if (this.window.isVisible() && !this.window.isMinimized()) this.window.hide();
    else this.show();
  }

  _onClose(event) {
    this.saveWindowState();
    if (this.settings.get('closeToTray') && !app.isQuitting) {
      event.preventDefault();
      this.window.hide();
    }
  }

  saveWindowState() {
    if (!this.window) return;
    const maximized = this.window.isMaximized();
    const bounds = maximized ? this.window.getNormalBounds() : this.window.getBounds();
    this.settings.set('window', { ...bounds, maximized });
  }
}

function parseUnread(title) {
  const match = /\((\d+)\+?\)/.exec(title || '');
  return match ? parseInt(match[1], 10) : 0;
}

function openExternally(url) {
  let protocol;
  try {
    protocol = new URL(url).protocol;
  } catch {
    return;
  }
  // Only ever hand the desktop a web link — never file:, and never an
  // arbitrary custom scheme that some page decided to hand us.
  if (protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:') {
    shell.openExternal(url);
  } else {
    console.warn(`[window] refused to open external URL with protocol ${protocol}`);
  }
}

module.exports = { AppWindow };

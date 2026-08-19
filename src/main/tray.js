'use strict';

const path = require('path');
const { Tray, Menu, app, nativeImage } = require('electron');

const ICON = path.join(__dirname, '..', 'assets', 'tray.png');

/**
 * System tray icon: unread total in the tooltip, per-account entries in the
 * menu so a background account with waiting messages is one click away.
 */
class AppTray {
  constructor({ appWindow, accounts }) {
    this.appWindow = appWindow;
    this.accounts = accounts;
    this.tray = null;
  }

  create() {
    const image = nativeImage.createFromPath(ICON);
    if (image.isEmpty()) {
      console.warn('[tray] icon missing, tray disabled');
      return null;
    }
    this.tray = new Tray(image);
    this.tray.setToolTip('WhatsAppForLinux');
    this.tray.on('click', () => this.appWindow.toggle());
    this.refresh();
    return this.tray;
  }

  refresh() {
    if (!this.tray) return;

    const items = this.accounts.all().map((account) => {
      const unread = this.appWindow.unread.get(account.id) || 0;
      const label = unread > 0 ? `${account.name} (${unread})` : account.name;
      return {
        label,
        type: 'radio',
        checked: account.id === this.accounts.activeId(),
        click: () => {
          this.appWindow.show();
          this.appWindow.setActive(account.id);
        }
      };
    });

    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Show / hide window', click: () => this.appWindow.toggle() },
        { type: 'separator' },
        ...(items.length ? items : [{ label: 'No accounts', enabled: false }]),
        { type: 'separator' },
        {
          label: 'Quit',
          click: () => {
            app.isQuitting = true;
            app.quit();
          }
        }
      ])
    );

    const total = this.appWindow.totalUnread();
    this.tray.setToolTip(
      total > 0 ? `WhatsAppForLinux — ${total} unread` : 'WhatsAppForLinux'
    );
  }

  destroy() {
    this.tray?.destroy();
    this.tray = null;
  }
}

module.exports = { AppTray };

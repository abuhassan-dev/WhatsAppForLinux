'use strict';

const { Menu, app, shell, dialog } = require('electron');

const HOMEPAGE = 'https://github.com/abuhassan-dev/WhatsAppForLinux';

/**
 * Application menu. Hidden behind Alt by default (autoHideMenuBar), but it is
 * what registers the keyboard accelerators, so it is not optional.
 */
function buildMenu({ appWindow, accounts, onAddAccount }) {
  const accountItems = accounts.all().slice(0, 9).map((account, index) => ({
    label: `${index + 1}. ${account.name}`,
    accelerator: `CommandOrControl+${index + 1}`,
    type: 'radio',
    checked: account.id === accounts.activeId(),
    click: () => appWindow.setActive(account.id)
  }));

  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Add account…',
          accelerator: 'CommandOrControl+Shift+N',
          click: () => onAddAccount()
        },
        { type: 'separator' },
        {
          label: 'Hide to tray',
          accelerator: 'CommandOrControl+W',
          click: () => appWindow.window?.hide()
        },
        {
          label: 'Quit',
          accelerator: 'CommandOrControl+Q',
          click: () => {
            app.isQuitting = true;
            app.quit();
          }
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Reload',
          accelerator: 'CommandOrControl+R',
          click: () => appWindow.activeWebContents()?.reload()
        },
        {
          label: 'Force reload',
          accelerator: 'CommandOrControl+Shift+R',
          click: () => appWindow.activeWebContents()?.reloadIgnoringCache()
        },
        { type: 'separator' },
        {
          label: 'Zoom in',
          accelerator: 'CommandOrControl+Plus',
          click: () => appWindow.zoom(+0.5)
        },
        {
          label: 'Zoom out',
          accelerator: 'CommandOrControl+-',
          click: () => appWindow.zoom(-0.5)
        },
        {
          label: 'Reset zoom',
          accelerator: 'CommandOrControl+0',
          click: () => appWindow.zoom(0)
        },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Accounts',
      submenu: [
        ...accountItems,
        ...(accountItems.length ? [{ type: 'separator' }] : []),
        {
          label: 'Next account',
          accelerator: 'Control+Tab',
          click: () => appWindow.cycleAccount(+1)
        },
        {
          label: 'Previous account',
          accelerator: 'Control+Shift+Tab',
          click: () => appWindow.cycleAccount(-1)
        }
      ]
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Project page', click: () => shell.openExternal(HOMEPAGE) },
        {
          label: 'About',
          click: () =>
            dialog.showMessageBox({
              type: 'info',
              title: 'About WhatsAppForLinux',
              message: `WhatsAppForLinux ${app.getVersion()}`,
              detail:
                `Electron ${process.versions.electron}\n` +
                `Chromium ${process.versions.chrome}\n` +
                `Node ${process.versions.node}\n\n` +
                'An independent project. Not affiliated with or endorsed by ' +
                'WhatsApp LLC or Meta Platforms, Inc. WhatsApp is a trademark ' +
                'of its respective owner.',
              buttons: ['OK']
            })
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { buildMenu, HOMEPAGE };

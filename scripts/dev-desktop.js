#!/usr/bin/env node
'use strict';

/**
 * Register a .desktop entry for a *source checkout*, so the desktop
 * environment can resolve the running window's app_id to a name and icon.
 *
 * Installed packages (deb/rpm/snap) ship their own entry and do not need this.
 * Without a matching entry, GNOME shows a generic placeholder icon, and on
 * GNOME 50+ xdg-desktop-portal refuses sessions for the unresolvable id.
 *
 *   node scripts/dev-desktop.js install
 *   node scripts/dev-desktop.js uninstall
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const pkg = require(path.join(ROOT, 'package.json'));

const APP_ID = path.basename(pkg.desktopName, '.desktop');
const HOME = os.homedir();
const DATA_HOME = process.env.XDG_DATA_HOME || path.join(HOME, '.local', 'share');
const APPS_DIR = path.join(DATA_HOME, 'applications');
const ICONS_DIR = path.join(DATA_HOME, 'icons', 'hicolor');
const DESKTOP_FILE = path.join(APPS_DIR, `${APP_ID}.desktop`);
const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256, 512];

function electronBinary() {
  const fromModule = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron');
  if (fs.existsSync(fromModule)) return fromModule;
  throw new Error(
    'Electron binary not found. Run `npm install` (and if npm blocked install ' +
    'scripts, `node node_modules/electron/install.js`) first.'
  );
}

function install() {
  const exec = `${electronBinary()} ${ROOT}`;
  const entry = [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${pkg.productName} (source)`,
    `Comment=${pkg.description}`,
    `Exec=${exec}`,
    `Icon=${APP_ID}`,
    'Terminal=false',
    'Categories=Network;InstantMessaging;Chat;',
    'Keywords=whatsapp;chat;messaging;im;messenger;',
    `StartupWMClass=${APP_ID}`,
    'StartupNotify=true',
    ''
  ].join('\n');

  fs.mkdirSync(APPS_DIR, { recursive: true });
  fs.writeFileSync(DESKTOP_FILE, entry);

  let copied = 0;
  for (const size of ICON_SIZES) {
    const source = path.join(ROOT, 'build', 'icons', `${size}x${size}.png`);
    if (!fs.existsSync(source)) continue;
    const target = path.join(ICONS_DIR, `${size}x${size}`, 'apps');
    fs.mkdirSync(target, { recursive: true });
    fs.copyFileSync(source, path.join(target, `${APP_ID}.png`));
    copied += 1;
  }

  refreshCaches();
  console.log(`Installed ${DESKTOP_FILE}`);
  console.log(`Installed ${copied} icon sizes as ${APP_ID}.png`);
  console.log(`Exec = ${exec}`);
}

function uninstall() {
  let removed = 0;
  if (fs.existsSync(DESKTOP_FILE)) {
    fs.unlinkSync(DESKTOP_FILE);
    removed += 1;
  }
  for (const size of ICON_SIZES) {
    const icon = path.join(ICONS_DIR, `${size}x${size}`, 'apps', `${APP_ID}.png`);
    if (fs.existsSync(icon)) {
      fs.unlinkSync(icon);
      removed += 1;
    }
  }
  refreshCaches();
  console.log(`Removed ${removed} file(s) for ${APP_ID}`);
}

/** Best-effort cache refresh; both tools are optional on many systems. */
function refreshCaches() {
  const attempts = [
    ['update-desktop-database', [APPS_DIR]],
    ['gtk-update-icon-cache', ['-f', '-t', ICONS_DIR]]
  ];
  for (const [command, args] of attempts) {
    try {
      execFileSync(command, args, { stdio: 'ignore' });
    } catch {
      // Not installed, or nothing to update — neither is fatal.
    }
  }
}

const action = process.argv[2];
if (action === 'install') install();
else if (action === 'uninstall') uninstall();
else {
  console.error('Usage: node scripts/dev-desktop.js <install|uninstall>');
  process.exit(1);
}

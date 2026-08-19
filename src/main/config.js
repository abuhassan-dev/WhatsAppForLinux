'use strict';

// Reverse-DNS application ID. This is the app's identity for Linux desktop
// integration: Wayland app_id, X11 WM_CLASS, and the xdg-desktop-portal app id.
// It must match the basename of the installed .desktop file or the desktop
// environment cannot resolve the window to an icon — and on GNOME 50+ portals
// refuse sessions for ids they cannot resolve.
const APP_ID = 'com.mayon.whatsappforlinux';

const WHATSAPP_URL = 'https://web.whatsapp.com/';

// Hosts the app is willing to render in-window. Everything else is handed to
// the user's default browser. Checked against a parsed hostname, never with a
// substring match.
const ALLOWED_HOSTS = ['whatsapp.com', 'whatsapp.net'];

// WhatsApp Web sniffs the UA and refuses to load for browsers it considers
// stale. Deriving the version from the bundled Chromium means the claim stays
// truthful and never goes out of date on its own.
function chromeUserAgent() {
  const major = (process.versions.chrome || '').split('.')[0] || '140';
  return (
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    `Chrome/${major}.0.0.0 Safari/537.36`
  );
}

function isAllowedHost(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return ALLOWED_HOSTS.some((base) => host === base || host.endsWith(`.${base}`));
}

const SIDEBAR_WIDTH = 68;

const DEFAULT_WINDOW = { width: 1280, height: 840, minWidth: 620, minHeight: 480 };

// Tile colours offered when creating an account, in rotation.
const ACCOUNT_COLORS = [
  '#25d366', '#128c7e', '#34b7f1', '#7f66ff',
  '#ff7043', '#ec407a', '#ffa726', '#26a69a'
];

module.exports = {
  APP_ID,
  WHATSAPP_URL,
  ALLOWED_HOSTS,
  ACCOUNT_COLORS,
  SIDEBAR_WIDTH,
  DEFAULT_WINDOW,
  chromeUserAgent,
  isAllowedHost
};

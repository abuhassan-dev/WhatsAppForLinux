'use strict';

const { session } = require('electron');
const { chromeUserAgent, isAllowedHost } = require('./config');

// Permissions WhatsApp Web legitimately needs. Everything else is refused.
const GRANTED = new Set([
  'notifications',
  'media',              // microphone + camera, for voice notes and calls
  'clipboard-read',
  'clipboard-sanitized-write',
  'fullscreen',
  'background-sync',
  // WhatsApp Web keeps its session keys in IndexedDB. Without this the
  // browser may evict that storage under disk pressure and silently log the
  // account out.
  'persistent-storage'
]);

const configured = new Set();

/**
 * Prepare the isolated session backing one account. Called once per partition;
 * repeated calls for the same partition are a no-op.
 */
function setupSession(partition, { spellcheckLanguages } = {}) {
  const ses = session.fromPartition(partition);
  if (configured.has(partition)) return ses;
  configured.add(partition);

  ses.setUserAgent(chromeUserAgent());

  // A permission is only granted if both the permission and the requesting
  // origin check out, so a hijacked frame on some other host gets nothing.
  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const origin = details?.requestingUrl || webContents?.getURL() || '';
    const allowed = GRANTED.has(permission) && isAllowedHost(origin);
    if (!allowed) {
      console.warn(`[session] denied "${permission}" for ${origin || 'unknown origin'}`);
    }
    callback(allowed);
  });

  ses.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    const origin = requestingOrigin || webContents?.getURL() || '';
    return GRANTED.has(permission) && isAllowedHost(origin);
  });

  // No display-media handler is installed on purpose: without one, Electron
  // refuses getDisplayMedia outright, which is the behaviour we want.

  if (spellcheckLanguages?.length && ses.availableSpellCheckerLanguages) {
    const supported = ses.availableSpellCheckerLanguages;
    const usable = spellcheckLanguages.filter((lang) => supported.includes(lang));
    if (usable.length) ses.setSpellCheckerLanguages(usable);
  }

  return ses;
}

module.exports = { setupSession };

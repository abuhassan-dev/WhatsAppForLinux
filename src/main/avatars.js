'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// Avatars come from a remote page, so they are treated as untrusted input:
// only base64 PNG is accepted, and only up to a sane size.
const DATA_URL = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/;
const MAX_BYTES = 512 * 1024;

function dir() {
  return path.join(app.getPath('userData'), 'avatars');
}

function file(accountId) {
  // accountId is a UUID we generated, but join defensively anyway.
  return path.join(dir(), `${path.basename(String(accountId))}.png`);
}

/** @returns {string|null} a data URL, or null if there is no stored avatar. */
function load(accountId) {
  try {
    const png = fs.readFileSync(file(accountId));
    return `data:image/png;base64,${png.toString('base64')}`;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('[avatars] read failed:', err.message);
    }
    return null;
  }
}

/** @returns {boolean} whether the value was accepted and written. */
function save(accountId, dataUrl) {
  const match = DATA_URL.exec(String(dataUrl || ''));
  if (!match) {
    console.warn('[avatars] rejected a non-PNG data URL');
    return false;
  }
  const png = Buffer.from(match[1], 'base64');
  if (png.length === 0 || png.length > MAX_BYTES) {
    console.warn(`[avatars] rejected an avatar of ${png.length} bytes`);
    return false;
  }
  // Verify it really is a PNG rather than trusting the declared type.
  if (!png.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    console.warn('[avatars] rejected data that is not a PNG');
    return false;
  }
  try {
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(file(accountId), png);
    return true;
  } catch (err) {
    console.error('[avatars] write failed:', err.message);
    return false;
  }
}

function remove(accountId) {
  try {
    fs.unlinkSync(file(accountId));
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('[avatars] delete failed:', err.message);
  }
}

module.exports = { load, save, remove };

'use strict';

const { ipcRenderer } = require('electron');

/* ------------------------------------------------------------------ */
/* Notification clicks                                                */
/* ------------------------------------------------------------------ */

// Runs in the isolated world, so it cannot see the page's `window.Notification`
// directly. The main process injects a hook into the page's own world that
// re-emits notification clicks as a DOM event, and the DOM is shared across
// worlds — so this listener does see it.
document.addEventListener('wafl:notification-click', () => {
  ipcRenderer.send('account:notification-click');
});

/* ------------------------------------------------------------------ */
/* Own-profile avatar                                                 */
/* ------------------------------------------------------------------ */

const AVATAR_PX = 96;          // rendered at 46px, so this stays crisp on HiDPI
const FIRST_TRY_MS = 3000;     // while waiting for login / first paint
const REFRESH_MS = 5 * 60_000; // in case the user changes their photo

let lastSent = null;

// Meta's CDN encodes the media type in the path. t61.24694-24 is the profile
// photo type, which rules out stickers, chat media and inline UI graphics
// without having to guess at sizes.
const PROFILE_MEDIA = '/t61.24694-24/';

// Anything inside the chat list belongs to somebody else.
const LIST_ROLES =
  '[role="gridcell"],[role="row"],[role="listitem"],[role="grid"],[role="list"]';

// The app's own chrome, where the signed-in user's photo lives.
const CHROME = 'header,nav,[role="navigation"]';

/**
 * Find the signed-in user's own avatar.
 *
 * WhatsApp Web exposes no API for this, and its class names are generated
 * atomic CSS that changes without notice, so matching on them is pointless.
 * Three stable signals instead:
 *
 *   1. the CDN media-type path, which marks it as a profile photo;
 *   2. not inside a grid/row/listitem — that is the chat list, i.e. contacts;
 *   3. inside the app header, where the profile button sits.
 *
 * Document order breaks the remaining tie: the chat-list panel's header comes
 * before an open conversation's header, and only the former holds your photo.
 */
function findOwnAvatar() {
  const candidates = [];

  for (const img of document.querySelectorAll('img')) {
    const src = img.currentSrc || img.src || '';
    if (!src.includes(PROFILE_MEDIA)) continue;
    if (!img.complete || img.naturalWidth === 0) continue;
    if (img.closest(LIST_ROLES)) continue;
    candidates.push(img);
  }

  if (candidates.length === 0) return null;

  const inChrome = candidates.filter((img) => img.closest(CHROME));
  return (inChrome.length ? inChrome : candidates)[0];
}

function toPngDataUrl(img) {
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_PX;
  canvas.height = AVATAR_PX;
  const context = canvas.getContext('2d');
  if (!context) return null;
  try {
    context.drawImage(img, 0, 0, AVATAR_PX, AVATAR_PX);
    return canvas.toDataURL('image/png');
  } catch {
    // Tainted canvas — nothing we can do, fall back to initials.
    return null;
  }
}

/** Counts only, for tuning the lookup. No URLs, geometry or page text. */
function diagnose() {
  const images = Array.from(document.querySelectorAll('img'));
  const profilePhotos = images.filter((img) =>
    (img.currentSrc || img.src || '').includes(PROFILE_MEDIA)
  );
  return {
    imgs: images.length,
    profilePhotos: profilePhotos.length,
    outsideList: profilePhotos.filter((img) => !img.closest(LIST_ROLES)).length
  };
}

function publishAvatar() {
  let img;
  try {
    img = findOwnAvatar();
  } catch (err) {
    ipcRenderer.send('account:avatar', null, { error: err.message });
    return false;
  }
  if (!img) {
    ipcRenderer.send('account:avatar', null, { found: false, ...diagnose() });
    return false;
  }

  const dataUrl = toPngDataUrl(img);
  if (!dataUrl || dataUrl === lastSent) return !!dataUrl;

  lastSent = dataUrl;
  ipcRenderer.send('account:avatar', dataUrl, { found: true });
  return true;
}

let timer = null;
let attempts = 0;

/**
 * A hidden WebContentsView never paints, and WhatsApp Web builds its UI through
 * requestAnimationFrame — which Chromium does not run for an occluded renderer.
 * So a background account has an empty DOM and there is nothing to read. The
 * main process calls this when the account becomes visible; the ramp then
 * covers however long WhatsApp takes to render.
 */
function runSequence() {
  clearTimeout(timer);
  attempts = 0;
  tick();
}

function tick() {
  let found = false;
  try {
    found = publishAvatar();
  } catch (err) {
    // Never let one bad pass kill the loop permanently — rescheduling lives in
    // `finally` so a throw costs one attempt, not the whole feature.
    try {
      ipcRenderer.send('account:avatar', null, { error: String(err && err.message) });
    } catch {
      /* main process is gone; nothing to report to */
    }
  } finally {
    attempts += 1;
    const delay = found ? REFRESH_MS : attempts < 8 ? FIRST_TRY_MS : 15000;
    timer = setTimeout(tick, delay);
  }
}

ipcRenderer.on('wafl:extract-avatar', runSequence);
window.addEventListener('load', () => setTimeout(runSequence, 1500));

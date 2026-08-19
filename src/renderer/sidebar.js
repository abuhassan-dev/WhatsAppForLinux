'use strict';

const api = window.accounts;

const tilesEl = document.getElementById('tiles');
const overlayEl = document.getElementById('overlay');
const renameSheet = document.getElementById('sheet-rename');
const renameInput = document.getElementById('rename-input');
const settingsSheet = document.getElementById('sheet-settings');

let state = { accounts: [], activeId: null };
let renameTargetId = null;
let dragSourceId = null;

/* ----------------------------------------------------------- rendering */

function initials(name) {
  const words = String(name).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  // One word gets one letter — "WO" for "Work" reads like an abbreviation
  // nobody chose. Two or more words get first + last initial.
  if (words.length === 1) return words[0][0].toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

function render() {
  tilesEl.replaceChildren();

  for (const account of state.accounts) {
    const li = document.createElement('li');

    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'tile';
    tile.style.background = account.color;
    tile.dataset.id = account.id;
    tile.draggable = true;

    if (account.avatar) {
      const photo = document.createElement('img');
      photo.className = 'avatar';
      photo.src = account.avatar;
      photo.alt = '';
      tile.append(photo);
    } else {
      // Initials are the fallback whenever the photo cannot be read — a
      // signed-out account, or WhatsApp Web having moved its markup again.
      tile.append(document.createTextNode(initials(account.name)));
    }
    const notes = [];
    if (account.unread) notes.push(`${account.unread} unread`);
    if (account.muted) notes.push('muted');
    tile.title = account.name + (notes.length ? ` — ${notes.join(', ')}` : '');
    tile.setAttribute('aria-label', tile.title);
    if (account.id === state.activeId) {
      tile.classList.add('active');
      tile.setAttribute('aria-current', 'true');
    }
    if (account.muted) tile.classList.add('muted');

    if (account.unread > 0 && !account.muted) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = account.unread > 99 ? '99+' : String(account.unread);
      tile.append(badge);
    }

    if (account.loading) {
      const spinner = document.createElement('span');
      spinner.className = 'spinner';
      tile.append(spinner);
    }

    li.append(tile);
    tilesEl.append(li);
  }
}

/* -------------------------------------------------------- interactions */

tilesEl.addEventListener('click', (event) => {
  const tile = event.target.closest('.tile');
  if (tile) api.activate(tile.dataset.id);
});

tilesEl.addEventListener('dblclick', (event) => {
  const tile = event.target.closest('.tile');
  if (tile) openRename(tile.dataset.id);
});

tilesEl.addEventListener('contextmenu', (event) => {
  const tile = event.target.closest('.tile');
  if (!tile) return;
  event.preventDefault();
  api.contextMenu(tile.dataset.id);
});

/* Drag to reorder. */
tilesEl.addEventListener('dragstart', (event) => {
  const tile = event.target.closest('.tile');
  if (!tile) return;
  dragSourceId = tile.dataset.id;
  tile.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move';
  // Firefox-style requirement: a drag needs payload to start at all.
  event.dataTransfer.setData('text/plain', dragSourceId);
});

tilesEl.addEventListener('dragover', (event) => {
  if (!dragSourceId) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  const tile = event.target.closest('.tile');
  clearDropMarkers();
  if (!tile || tile.dataset.id === dragSourceId) return;
  const box = tile.getBoundingClientRect();
  const before = event.clientY < box.top + box.height / 2;
  tile.classList.add(before ? 'drop-before' : 'drop-after');
});

tilesEl.addEventListener('drop', (event) => {
  if (!dragSourceId) return;
  event.preventDefault();
  const tile = event.target.closest('.tile');
  if (tile && tile.dataset.id !== dragSourceId) {
    const box = tile.getBoundingClientRect();
    const before = event.clientY < box.top + box.height / 2;
    const ids = state.accounts.map((a) => a.id).filter((id) => id !== dragSourceId);
    const at = ids.indexOf(tile.dataset.id);
    ids.splice(before ? at : at + 1, 0, dragSourceId);
    api.reorder(ids);
  }
  endDrag();
});

tilesEl.addEventListener('dragend', endDrag);

function endDrag() {
  clearDropMarkers();
  tilesEl.querySelector('.dragging')?.classList.remove('dragging');
  dragSourceId = null;
}

function clearDropMarkers() {
  for (const el of tilesEl.querySelectorAll('.drop-before, .drop-after')) {
    el.classList.remove('drop-before', 'drop-after');
  }
}

document.getElementById('add').addEventListener('click', () => api.add());
document.getElementById('open-settings').addEventListener('click', openSettings);

/* -------------------------------------------------------------- sheets */

/**
 * The sidebar view is only as wide as the rail until a sheet opens, at which
 * point the main process stretches it across the window so the sheet has
 * somewhere to live. Anything that opens a sheet must therefore close it.
 */
function showOverlay(sheet) {
  for (const el of overlayEl.querySelectorAll('.sheet')) el.hidden = el !== sheet;
  overlayEl.hidden = false;
  api.overlay(true);
}

function closeOverlay() {
  overlayEl.hidden = true;
  renameTargetId = null;
  api.overlay(false);
}

overlayEl.addEventListener('click', (event) => {
  if (event.target === overlayEl || event.target.hasAttribute('data-close')) {
    closeOverlay();
  }
});

document.addEventListener('keydown', (event) => {
  if (overlayEl.hidden) return;
  if (event.key === 'Escape') closeOverlay();
  if (event.key === 'Enter' && !renameSheet.hidden) saveRename();
});

function openRename(id) {
  const account = state.accounts.find((a) => a.id === id);
  if (!account) return;
  renameTargetId = id;
  renameInput.value = account.name;
  showOverlay(renameSheet);
  renameInput.focus();
  renameInput.select();
}

document.getElementById('rename-save').addEventListener('click', saveRename);

async function saveRename() {
  const name = renameInput.value.trim();
  if (renameTargetId && name) await api.rename(renameTargetId, name);
  closeOverlay();
}

const SETTING_KEYS = ['closeToTray', 'startMinimized', 'useWaylandOzone'];

async function openSettings() {
  const settings = await api.settings.get();
  for (const key of SETTING_KEYS) {
    document.getElementById(`set-${key}`).checked = !!settings[key];
  }
  showOverlay(settingsSheet);
}

for (const key of SETTING_KEYS) {
  document.getElementById(`set-${key}`).addEventListener('change', (event) => {
    api.settings.set(key, event.target.checked);
  });
}

document.getElementById('site-link').addEventListener('click', (event) => {
  // The sidebar is local UI and must never navigate; hand the URL to the
  // user's browser instead.
  event.preventDefault();
  api.openExternal(event.currentTarget.href);
});

/* ---------------------------------------------------------------- boot */

api.onState((next) => {
  state = next;
  render();
});

api.refresh();

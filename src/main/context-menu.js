'use strict';

const { Menu, MenuItem, clipboard, shell } = require('electron');
/**
 * Native right-click menu for an account view. Built per-event so spellcheck
 * suggestions and the enabled/disabled state of each item reflect what was
 * actually clicked.
 */
function attachContextMenu(webContents, { isDev = false, onZoomChange } = {}) {
  webContents.on('context-menu', (_event, params) => {
    const menu = new Menu();
    const add = (options) => menu.append(new MenuItem(options));
    let needsSeparator = false;
    const separate = () => {
      if (needsSeparator) {
        add({ type: 'separator' });
        needsSeparator = false;
      }
    };

    if (params.misspelledWord) {
      for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
        add({
          label: suggestion,
          click: () => webContents.replaceMisspelling(suggestion)
        });
      }
      if (params.dictionarySuggestions.length === 0) {
        add({ label: 'No spelling suggestions', enabled: false });
      }
      add({
        label: 'Add to dictionary',
        click: () =>
          webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
      });
      needsSeparator = true;
    }

    if (params.linkURL) {
      separate();
      add({
        label: 'Open link in browser',
        click: () => {
          if (/^https?:$/.test(safeProtocol(params.linkURL))) {
            shell.openExternal(params.linkURL);
          }
        }
      });
      add({
        label: 'Copy link address',
        click: () => clipboard.writeText(params.linkURL)
      });
      needsSeparator = true;
    }

    if (params.mediaType === 'image' && params.srcURL) {
      separate();
      add({ label: 'Copy image', click: () => webContents.copyImageAt(params.x, params.y) });
      add({ label: 'Save image as…', click: () => webContents.downloadURL(params.srcURL) });
      needsSeparator = true;
    }

    if (params.isEditable || params.selectionText) {
      separate();
      add({ label: 'Undo', role: 'undo', enabled: params.editFlags.canUndo });
      add({ label: 'Redo', role: 'redo', enabled: params.editFlags.canRedo });
      add({ type: 'separator' });
      add({ label: 'Cut', role: 'cut', enabled: params.editFlags.canCut });
      add({ label: 'Copy', role: 'copy', enabled: params.editFlags.canCopy });
      add({ label: 'Paste', role: 'paste', enabled: params.editFlags.canPaste });
      add({ label: 'Select all', role: 'selectAll', enabled: params.editFlags.canSelectAll });
      needsSeparator = true;
    }

    separate();
    add({ label: 'Zoom in', click: () => stepZoom(webContents, +0.5, onZoomChange) });
    add({ label: 'Zoom out', click: () => stepZoom(webContents, -0.5, onZoomChange) });
    add({ label: 'Reset zoom', click: () => setZoom(webContents, 0, onZoomChange) });
    add({ type: 'separator' });
    add({ label: 'Reload', click: () => webContents.reload() });

    if (isDev) {
      add({ type: 'separator' });
      add({
        label: 'Inspect element',
        click: () => webContents.inspectElement(params.x, params.y)
      });
    }

    menu.popup();
  });
}

function safeProtocol(url) {
  try {
    return new URL(url).protocol;
  } catch {
    return '';
  }
}

function setZoom(webContents, level, onZoomChange) {
  const clamped = Math.max(-3, Math.min(3, level));
  webContents.setZoomLevel(clamped);
  onZoomChange?.(clamped);
}

function stepZoom(webContents, delta, onZoomChange) {
  setZoom(webContents, webContents.getZoomLevel() + delta, onZoomChange);
}

module.exports = { attachContextMenu, setZoom, stepZoom };

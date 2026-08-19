'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

/**
 * Minimal JSON-file store. Writes go through a temp file + rename so a crash
 * mid-write cannot leave a truncated config behind.
 */
class Store {
  constructor(filename, defaults = {}) {
    this.file = path.join(app.getPath('userData'), filename);
    this.defaults = defaults;
    this.data = this._read();
  }

  _read() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      return { ...this.defaults, ...JSON.parse(raw) };
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error(`[store] ${this.file} unreadable, falling back to defaults:`, err.message);
      }
      return { ...this.defaults };
    }
  }

  get(key) {
    return this.data[key];
  }

  set(key, value) {
    this.data[key] = value;
    this.save();
  }

  save() {
    const tmp = `${this.file}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error(`[store] failed to persist ${this.file}:`, err.message);
    }
  }
}

module.exports = { Store };

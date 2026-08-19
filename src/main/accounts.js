'use strict';

const crypto = require('crypto');
const { Store } = require('./store');
const { ACCOUNT_COLORS } = require('./config');

/**
 * The account list and its persistence.
 *
 * Each account owns a `persist:` session partition, which is what actually
 * makes multi-account work: cookies, localStorage and IndexedDB are scoped per
 * partition, so two accounts can hold two independent WhatsApp Web logins with
 * no awareness of each other.
 */
class AccountStore {
  constructor() {
    this.store = new Store('accounts.json', { accounts: [], activeId: null });
    if (this.all().length === 0) {
      this.add('Account 1');
    }
  }

  all() {
    return this.store.get('accounts') || [];
  }

  get(id) {
    return this.all().find((a) => a.id === id) || null;
  }

  partitionFor(id) {
    return `persist:wa-${id}`;
  }

  add(name) {
    const accounts = this.all();
    const account = {
      id: crypto.randomUUID(),
      name: name || `Account ${accounts.length + 1}`,
      color: ACCOUNT_COLORS[accounts.length % ACCOUNT_COLORS.length],
      zoom: 0,
      muted: false
    };
    accounts.push(account);
    this.store.set('accounts', accounts);
    if (!this.activeId()) this.setActive(account.id);
    return account;
  }

  update(id, patch) {
    const accounts = this.all();
    const account = accounts.find((a) => a.id === id);
    if (!account) return null;
    // id and colour rotation index must not be patchable from the renderer.
    delete patch.id;
    Object.assign(account, patch);
    this.store.set('accounts', accounts);
    return account;
  }

  remove(id) {
    const accounts = this.all().filter((a) => a.id !== id);
    this.store.set('accounts', accounts);
    if (this.activeId() === id) {
      this.setActive(accounts.length ? accounts[0].id : null);
    }
    return accounts;
  }

  reorder(orderedIds) {
    const byId = new Map(this.all().map((a) => [a.id, a]));
    const reordered = orderedIds.map((id) => byId.get(id)).filter(Boolean);
    // Anything the renderer forgot to mention keeps its place at the end.
    for (const account of this.all()) {
      if (!reordered.includes(account)) reordered.push(account);
    }
    this.store.set('accounts', reordered);
    return reordered;
  }

  activeId() {
    return this.store.get('activeId');
  }

  setActive(id) {
    this.store.set('activeId', id);
    return id;
  }
}

module.exports = { AccountStore };

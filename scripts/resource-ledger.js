const AVL_MODULE_ID = "actor-vault";
const AVL_LEDGER_SETTING = "resourceLedger";
const AVL_RESOURCE_SCOPE = "world";
const AVL_RESOURCE_KEY = "metaResources";
const AVL_HISTORY_KEY = "metaResourcesHistory";

class ActorVaultLedger {
  static registerSettings() {
    if (game.settings.settings.has(`${AVL_MODULE_ID}.${AVL_LEDGER_SETTING}`)) return;
    game.settings.register(AVL_MODULE_ID, AVL_LEDGER_SETTING, {
      name: "Persistent Resource Ledger",
      scope: "world",
      config: false,
      type: Object,
      default: { version: 1, entries: {} }
    });
  }

  static normalizeResources(stored) {
    const source = stored && typeof stored === "object" ? stored : {};
    const merged = foundry.utils.mergeObject(
      { gold: 0, credits: 0, xp: 0, housingTier: 0, storage: ["", "", "", ""] },
      source,
      { inplace: false }
    );
    merged.gold = Number(merged.gold) || 0;
    merged.credits = Number(merged.credits) || 0;
    merged.xp = Number(merged.xp) || 0;
    merged.housingTier = Math.min(4, Math.max(0, Math.trunc(Number(merged.housingTier) || 0)));
    if (!Array.isArray(merged.storage)) merged.storage = [];
    merged.storage = [...merged.storage, "", "", "", ""].slice(0, 4).map(value => String(value ?? ""));
    return merged;
  }

  static forgePlayerId(user) {
    return user?.flags?.["forge-vtt"]?.player || null;
  }

  static store() {
    const raw = game.settings.get(AVL_MODULE_ID, AVL_LEDGER_SETTING);
    return raw && typeof raw === "object" ? foundry.utils.deepClone(raw) : { version: 1, entries: {} };
  }

  static async write(store) {
    await game.settings.set(AVL_MODULE_ID, AVL_LEDGER_SETTING, store);
    return store;
  }

  static keyForUser(user) {
    if (!user) return null;
    return this.forgePlayerId(user) ? `forge:${this.forgePlayerId(user)}` : `foundry:${user.id}`;
  }

  static keyForUserId(userId) {
    const user = game.users.get(userId);
    return user ? this.keyForUser(user) : null;
  }

  static getEntryByKey(key) {
    return key ? this.store().entries?.[key] || null : null;
  }

  static getEntry(userId) {
    const key = this.keyForUserId(userId);
    return key ? this.getEntryByKey(key) : null;
  }

  static getResources(userId) {
    return this.normalizeResources(this.getEntry(userId)?.resources || game.users.get(userId)?.getFlag(AVL_RESOURCE_SCOPE, AVL_RESOURCE_KEY) || {});
  }

  static getHistory(userId) {
    const entry = this.getEntry(userId);
    if (Array.isArray(entry?.history)) return foundry.utils.deepClone(entry.history);
    const legacy = game.users.get(userId)?.getFlag(AVL_RESOURCE_SCOPE, AVL_HISTORY_KEY);
    return Array.isArray(legacy) ? foundry.utils.deepClone(legacy) : [];
  }

  static getLoans(userId) {
    return foundry.utils.deepClone(this.getEntry(userId)?.loans || {});
  }

  static allEntries() {
    return Object.entries(this.store().entries || {}).map(([key, entry]) => ({ key, ...foundry.utils.deepClone(entry) }));
  }

  static ensureEntryInStore(store, user) {
    const key = this.keyForUser(user);
    if (!key) return null;
    const existing = store.entries?.[key] || {};
    store.entries ||= {};
    store.entries[key] = {
      key,
      name: user.name,
      forgePlayerId: this.forgePlayerId(user),
      currentFoundryUserId: user.id,
      foundryUserIds: Array.from(new Set([...(existing.foundryUserIds || []), user.id])),
      resources: this.normalizeResources(existing.resources || user.getFlag(AVL_RESOURCE_SCOPE, AVL_RESOURCE_KEY) || {}),
      history: Array.isArray(existing.history)
        ? existing.history
        : (Array.isArray(user.getFlag(AVL_RESOURCE_SCOPE, AVL_HISTORY_KEY)) ? foundry.utils.deepClone(user.getFlag(AVL_RESOURCE_SCOPE, AVL_HISTORY_KEY)) : []),
      loans: existing.loans && typeof existing.loans === "object" ? existing.loans : {},
      archived: false,
      updatedAt: Date.now()
    };
    return store.entries[key];
  }

  static async syncCurrentUsers() {
    if (!game.user.isGM) return;
    const store = this.store();
    const currentKeys = new Set();
    for (const user of game.users) {
      if (!user?.id) continue;
      const key = this.keyForUser(user);
      if (!key) continue;
      currentKeys.add(key);
      this.ensureEntryInStore(store, user);
    }
    for (const [key, entry] of Object.entries(store.entries || {})) {
      if (!currentKeys.has(key)) entry.archived = true;
    }
    await this.write(store);
  }

  static async commitResources(userId, nextResources, options = {}) {
    const user = game.users.get(userId);
    if (!user) throw new Error("Player not found.");
    const store = this.store();
    const entry = this.ensureEntryInStore(store, user);
    const previous = this.normalizeResources(options.previous || entry.resources);
    const next = this.normalizeResources(nextResources);
    entry.resources = foundry.utils.deepClone(next);
    entry.history ||= [];
    entry.history.unshift({
      timestamp: Date.now(),
      editorUserId: options.editorUserId || game.user.id,
      editorName: game.users.get(options.editorUserId || game.user.id)?.name || game.user.name || "Unknown",
      action: options.action || "Dashboard update",
      actorId: options.actorId || null,
      actorName: options.actorName || null,
      previous: foundry.utils.deepClone(previous),
      state: foundry.utils.deepClone(next),
      previousLongRest: options.previousLongRest ? foundry.utils.deepClone(options.previousLongRest) : undefined,
      longRest: options.longRest ? foundry.utils.deepClone(options.longRest) : undefined
    });
    entry.history = entry.history.slice(0, 100);
    entry.updatedAt = Date.now();
    await this.write(store);
    await user.setFlag(AVL_RESOURCE_SCOPE, AVL_RESOURCE_KEY, next);
    await user.setFlag(AVL_RESOURCE_SCOPE, AVL_HISTORY_KEY, entry.history.slice(0, 30));
    return entry;
  }

  static loanDefinitions() {
    return {
      ironContract: {
        id: "ironContract",
        name: "The Iron Contract",
        receiveLabel: "250g + 5sc",
        repayLabel: "300g + 6sc",
        receiveGold: 250,
        receiveCredits: 5,
        repayGold: 300,
        repayCredits: 6
      },
      trainingGrounds: {
        id: "trainingGrounds",
        name: "Training Grounds",
        receiveLabel: "1000 XP",
        repayLabel: "1200 XP",
        receiveXp: 1000,
        repayXp: 1200
      }
    };
  }

  static async takeLoan(userId, loanId, requesterId = game.user.id) {
    const user = game.users.get(userId);
    if (!user) throw new Error("Player not found.");
    const requester = game.users.get(requesterId);
    if (!requester) throw new Error("Requesting user not found.");
    if (!requester.isGM && requester.id !== user.id) throw new Error("You may only take a loan for yourself.");
    const def = this.loanDefinitions()[loanId];
    if (!def) throw new Error("Unknown loan contract.");
    const store = this.store();
    const entry = this.ensureEntryInStore(store, user);
    entry.loans ||= {};
    if (entry.loans[loanId]?.active) throw new Error(`${def.name} is already active.`);
    const previous = this.normalizeResources(entry.resources);
    const next = foundry.utils.deepClone(previous);
    if (loanId === "ironContract") {
      next.gold += def.receiveGold;
      next.credits += def.receiveCredits;
    }
    if (loanId === "trainingGrounds") next.xp += def.receiveXp;
    entry.resources = next;
    entry.loans[loanId] = { active: true, takenAt: Date.now(), takenByUserId: requester.id, receiveLabel: def.receiveLabel, repayLabel: def.repayLabel };
    entry.history ||= [];
    entry.history.unshift({ timestamp: Date.now(), editorUserId: requester.id, editorName: requester.name, action: `${def.name} — Loan Issued (+${def.receiveLabel})`, previous, state: foundry.utils.deepClone(next) });
    entry.history = entry.history.slice(0, 100);
    await this.write(store);
    await user.setFlag(AVL_RESOURCE_SCOPE, AVL_RESOURCE_KEY, next);
    await user.setFlag(AVL_RESOURCE_SCOPE, AVL_HISTORY_KEY, entry.history.slice(0, 30));
    return { message: `${user.name} received ${def.receiveLabel} from ${def.name}.` };
  }

  static async repayLoan(userId, loanId, requesterId = game.user.id) {
    const user = game.users.get(userId);
    if (!user) throw new Error("Player not found.");
    const requester = game.users.get(requesterId);
    if (!requester) throw new Error("Requesting user not found.");
    if (!requester.isGM && requester.id !== user.id) throw new Error("You may only repay your own loan.");
    const def = this.loanDefinitions()[loanId];
    if (!def) throw new Error("Unknown loan contract.");
    const store = this.store();
    const entry = this.ensureEntryInStore(store, user);
    if (!entry.loans?.[loanId]?.active) throw new Error(`${def.name} is not active.`);
    const previous = this.normalizeResources(entry.resources);
    const next = foundry.utils.deepClone(previous);
    if (loanId === "ironContract") {
      if (next.gold < def.repayGold || next.credits < def.repayCredits) throw new Error(`${def.name} requires ${def.repayLabel} to repay.`);
      next.gold -= def.repayGold;
      next.credits -= def.repayCredits;
    }
    if (loanId === "trainingGrounds") {
      if (next.xp < def.repayXp) throw new Error(`${def.name} requires ${def.repayLabel} to repay.`);
      next.xp -= def.repayXp;
    }
    entry.resources = next;
    entry.loans[loanId] = { ...entry.loans[loanId], active: false, repaidAt: Date.now(), repaidByUserId: requester.id };
    entry.history ||= [];
    entry.history.unshift({ timestamp: Date.now(), editorUserId: requester.id, editorName: requester.name, action: `${def.name} — Loan Repaid (-${def.repayLabel})`, previous, state: foundry.utils.deepClone(next) });
    entry.history = entry.history.slice(0, 100);
    await this.write(store);
    await user.setFlag(AVL_RESOURCE_SCOPE, AVL_RESOURCE_KEY, next);
    await user.setFlag(AVL_RESOURCE_SCOPE, AVL_HISTORY_KEY, entry.history.slice(0, 30));
    return { message: `${user.name} repaid ${def.name}.` };
  }

  static async deleteArchived(key) {
    if (!game.user.isGM) throw new Error("Only a GM can delete archived ledger users.");
    const store = this.store();
    const entry = store.entries?.[key];
    if (!entry) throw new Error("Archived ledger user not found.");
    if (!entry.archived) throw new Error("Only archived ledger users can be deleted.");
    delete store.entries[key];
    await this.write(store);
  }
}

globalThis.ActorVaultLedger = ActorVaultLedger;
Hooks.once("init", () => ActorVaultLedger.registerSettings());
Hooks.once("ready", async () => { if (game.user.isGM) await ActorVaultLedger.syncCurrentUsers(); });

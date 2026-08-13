const AVL_MODULE_ID = "actor-vault";
const AVL_LEDGER_SETTING = "resourceLedger";
const AVL_BACKUP_SETTING = "resourceLedgerBackups";
const AVL_RESOURCE_SCOPE = "world";
const AVL_RESOURCE_KEY = "metaResources";
const AVL_HISTORY_KEY = "metaResourcesHistory";
const AVL_LEDGER_VERSION = 2;

class ActorVaultLedger {
  static registerSettings() {
    if (!game.settings.settings.has(`${AVL_MODULE_ID}.${AVL_LEDGER_SETTING}`)) {
      game.settings.register(AVL_MODULE_ID, AVL_LEDGER_SETTING, {
        name: "Persistent Resource Ledger",
        scope: "world",
        config: false,
        type: Object,
        default: { version: AVL_LEDGER_VERSION, entries: {} }
      });
    }
    if (!game.settings.settings.has(`${AVL_MODULE_ID}.${AVL_BACKUP_SETTING}`)) {
      game.settings.register(AVL_MODULE_ID, AVL_BACKUP_SETTING, {
        name: "Persistent Resource Ledger Backups",
        scope: "world",
        config: false,
        type: Object,
        default: { backups: [] }
      });
    }
  }

  static normalizeResources(stored) {
    const source = stored && typeof stored === "object" ? stored : {};
    const merged = foundry.utils.mergeObject(
      {
        gold: 0,
        credits: 0,
        xp: 0,
        housingTier: 0,
        storage: ["", "", "", ""],
        studyBonus: false,
        skillTreeRespecCount: 0
      },
      source,
      { inplace: false }
    );
    merged.gold = Number(merged.gold) || 0;
    merged.credits = Number(merged.credits) || 0;
    merged.xp = Number(merged.xp) || 0;
    merged.housingTier = Math.min(4, Math.max(0, Math.trunc(Number(merged.housingTier) || 0)));
    merged.studyBonus = Boolean(merged.studyBonus);
    merged.skillTreeRespecCount = Math.max(0, Math.trunc(Number(merged.skillTreeRespecCount) || 0));
    if (!Array.isArray(merged.storage)) merged.storage = [];
    merged.storage = [...merged.storage, "", "", "", ""].slice(0, 4).map(value => String(value ?? ""));
    return merged;
  }

  static forgePlayerId(user) {
    return user?.flags?.["forge-vtt"]?.player || null;
  }

  static emptyStore() {
    return { version: AVL_LEDGER_VERSION, entries: {} };
  }

  static store() {
    const raw = game.settings.get(AVL_MODULE_ID, AVL_LEDGER_SETTING);
    return raw && typeof raw === "object" ? foundry.utils.deepClone(raw) : this.emptyStore();
  }

  static async write(store) {
    store.version = AVL_LEDGER_VERSION;
    store.entries ||= {};
    await game.settings.set(AVL_MODULE_ID, AVL_LEDGER_SETTING, store);
    return store;
  }

  static keyForUser(user) {
    if (!user) return null;
    const forgeId = this.forgePlayerId(user);
    return forgeId ? `forge:${forgeId}` : `foundry:${user.id}`;
  }

  static keyForUserId(userId) {
    return this.keyForUser(game.users.get(userId));
  }

  static getEntryByKey(key) {
    return key ? this.store().entries?.[key] || null : null;
  }

  static getEntry(userId) {
    const key = this.keyForUserId(userId);
    return key ? this.getEntryByKey(key) : null;
  }

  static getResources(userId) {
    const entry = this.getEntry(userId);
    if (entry) return this.normalizeResources(entry.resources);
    const user = game.users.get(userId);
    return this.normalizeResources(user?.getFlag(AVL_RESOURCE_SCOPE, AVL_RESOURCE_KEY) || {});
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

  static resourceDelta(previous, next) {
    const delta = {};
    for (const key of ["gold", "credits", "xp"]) {
      const amount = (Number(next?.[key]) || 0) - (Number(previous?.[key]) || 0);
      if (amount) delta[key] = amount;
    }
    return delta;
  }

  static changedValues(previous, next) {
    const changes = {};
    for (const key of ["housingTier", "studyBonus", "skillTreeRespecCount", "storage"]) {
      if (JSON.stringify(previous?.[key]) !== JSON.stringify(next?.[key])) {
        changes[key] = { from: foundry.utils.deepClone(previous?.[key]), to: foundry.utils.deepClone(next?.[key]) };
      }
    }
    return changes;
  }

  static normalizeHistoryEntry(historyEntry) {
    const entry = foundry.utils.deepClone(historyEntry || {});
    const previous = this.normalizeResources(entry.previous || {});
    const state = this.normalizeResources(entry.state || previous);
    return {
      id: entry.id || foundry.utils.randomID(20),
      timestamp: Number(entry.timestamp) || Date.now(),
      type: entry.type || "legacy",
      action: entry.action || "Legacy resource update",
      editorUserId: entry.editorUserId || null,
      editorName: entry.editorName || null,
      actorId: entry.actorId || null,
      actorName: entry.actorName || null,
      delta: entry.delta && typeof entry.delta === "object" ? entry.delta : this.resourceDelta(previous, state),
      changes: entry.changes && typeof entry.changes === "object" ? entry.changes : this.changedValues(previous, state),
      metadata: entry.metadata && typeof entry.metadata === "object" ? entry.metadata : {},
      previous,
      state,
      previousLongRest: entry.previousLongRest,
      longRest: entry.longRest
    };
  }

  static ensureEntryInStore(store, user) {
    const key = this.keyForUser(user);
    if (!key) return null;
    store.entries ||= {};
    const existing = store.entries[key];

    // User flags are imported only when the persistent ledger entry is first created.
    // After that, the ledger is the source of truth and flags are compatibility mirrors only.
    const legacyResources = user.getFlag(AVL_RESOURCE_SCOPE, AVL_RESOURCE_KEY) || {};
    const legacyHistory = user.getFlag(AVL_RESOURCE_SCOPE, AVL_HISTORY_KEY) || [];
    const resources = this.normalizeResources(existing?.resources ?? legacyResources);
    const historySource = Array.isArray(existing?.history) ? existing.history : (Array.isArray(legacyHistory) ? legacyHistory : []);

    store.entries[key] = {
      ...(existing || {}),
      key,
      name: user.name,
      forgePlayerId: this.forgePlayerId(user),
      currentFoundryUserId: user.id,
      foundryUserIds: Array.from(new Set([...(existing?.foundryUserIds || []), user.id])),
      resources,
      history: historySource.map(history => this.normalizeHistoryEntry(history)).slice(0, 250),
      loans: existing?.loans && typeof existing.loans === "object" ? existing.loans : {},
      archived: false,
      updatedAt: Date.now()
    };
    delete store.entries[key].manualArchived;
    return store.entries[key];
  }

  static async mirrorUser(user, entry) {
    if (!user || !entry) return;
    const resources = this.normalizeResources(entry.resources);
    const history = (entry.history || []).slice(0, 30);
    const currentResources = this.normalizeResources(user.getFlag(AVL_RESOURCE_SCOPE, AVL_RESOURCE_KEY));
    const currentHistory = user.getFlag(AVL_RESOURCE_SCOPE, AVL_HISTORY_KEY) || [];
    if (JSON.stringify(resources) !== JSON.stringify(currentResources)) {
      await user.setFlag(AVL_RESOURCE_SCOPE, AVL_RESOURCE_KEY, resources);
    }
    if (JSON.stringify(history) !== JSON.stringify(currentHistory)) {
      await user.setFlag(AVL_RESOURCE_SCOPE, AVL_HISTORY_KEY, history);
    }
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
      entry.archived = !currentKeys.has(key);
      if (entry.archived) entry.currentFoundryUserId = null;
    }
    await this.write(store);
    for (const user of game.users) {
      const entry = store.entries?.[this.keyForUser(user)];
      if (entry) await this.mirrorUser(user, entry);
    }
  }

  static async transact(userId, transaction = {}) {
    const user = game.users.get(userId);
    if (!user) throw new Error("Player not found.");
    const store = this.store();
    const entry = this.ensureEntryInStore(store, user);
    const previous = this.normalizeResources(entry.resources);
    const next = foundry.utils.deepClone(previous);
    const requestedDelta = transaction.delta && typeof transaction.delta === "object" ? transaction.delta : {};

    for (const key of ["gold", "credits", "xp"]) {
      if (requestedDelta[key] !== undefined) next[key] = (Number(next[key]) || 0) + (Number(requestedDelta[key]) || 0);
    }
    if (transaction.set && typeof transaction.set === "object") {
      Object.assign(next, foundry.utils.deepClone(transaction.set));
    }

    const normalizedNext = this.normalizeResources(next);
    if (!transaction.allowNegative) {
      if (normalizedNext.gold < 0) throw new Error("Not enough gold for this transaction.");
      if (normalizedNext.credits < 0) throw new Error("Not enough Server Credits for this transaction.");
      if (normalizedNext.xp < 0) throw new Error("Not enough XP for this transaction.");
    }

    entry.resources = normalizedNext;
    if (typeof transaction.mutateEntry === "function") transaction.mutateEntry(entry, normalizedNext, previous);

    const editorUserId = transaction.editorUserId || game.user.id;
    const editor = game.users.get(editorUserId);
    const historyEntry = {
      id: foundry.utils.randomID(20),
      timestamp: Date.now(),
      type: transaction.type || "resource",
      action: transaction.action || "Resource transaction",
      editorUserId,
      editorName: editor?.name || game.user?.name || "Unknown",
      actorId: transaction.actorId || null,
      actorName: transaction.actorName || null,
      delta: this.resourceDelta(previous, normalizedNext),
      changes: this.changedValues(previous, normalizedNext),
      metadata: foundry.utils.deepClone(transaction.metadata || {}),
      previous: foundry.utils.deepClone(previous),
      state: foundry.utils.deepClone(normalizedNext),
      previousLongRest: transaction.previousLongRest ? foundry.utils.deepClone(transaction.previousLongRest) : undefined,
      longRest: transaction.longRest ? foundry.utils.deepClone(transaction.longRest) : undefined
    };
    entry.history ||= [];
    entry.history.unshift(historyEntry);
    entry.history = entry.history.slice(0, 250);
    entry.updatedAt = Date.now();
    await this.write(store);
    await this.mirrorUser(user, entry);
    return { entry, previous, next: normalizedNext, historyEntry };
  }

  static async commitResources(userId, nextResources, options = {}) {
    const current = this.getResources(userId);
    return this.transact(userId, {
      type: options.type || "manual",
      action: options.action || "Dashboard update",
      set: this.normalizeResources(nextResources),
      editorUserId: options.editorUserId,
      actorId: options.actorId,
      actorName: options.actorName,
      metadata: options.metadata,
      previousLongRest: options.previousLongRest,
      longRest: options.longRest,
      // Explicitly retaining this for compatibility with older callers that pass previous.
      previous: options.previous || current
    });
  }

  static loanDefinitions() {
    return {
      ironContract: {
        id: "ironContract",
        name: "The Iron Contract",
        receiveLabel: "250g + 5sc",
        repayLabel: "300g + 6sc",
        receive: { gold: 250, credits: 5, xp: 0 },
        repay: { gold: 300, credits: 6, xp: 0 }
      },
      trainingGrounds: {
        id: "trainingGrounds",
        name: "Training Grounds",
        receiveLabel: "1000 XP",
        repayLabel: "1200 XP",
        receive: { gold: 0, credits: 0, xp: 1000 },
        repay: { gold: 0, credits: 0, xp: 1200 }
      }
    };
  }

  static async takeLoan(userId, loanId, requesterId = game.user.id) {
    const requester = game.users.get(requesterId);
    const user = game.users.get(userId);
    if (!requester || !user) throw new Error("Player not found.");
    if (!requester.isGM && requester.id !== user.id) throw new Error("You may only take a loan for yourself.");
    const def = this.loanDefinitions()[loanId];
    if (!def) throw new Error("Unknown loan contract.");
    const entry = this.getEntry(userId);
    if (entry?.loans?.[loanId]?.active) throw new Error(`${def.name} is already active.`);

    await this.transact(userId, {
      type: "loan",
      action: `${def.name} — Loan Issued (+${def.receiveLabel})`,
      delta: def.receive,
      editorUserId: requesterId,
      metadata: { loanId, mode: "take", receive: def.receive, repay: def.repay },
      mutateEntry: ledgerEntry => {
        ledgerEntry.loans ||= {};
        ledgerEntry.loans[loanId] = {
          active: true,
          takenAt: Date.now(),
          takenByUserId: requesterId,
          receiveLabel: def.receiveLabel,
          repayLabel: def.repayLabel
        };
      }
    });
    return { message: `${user.name} received ${def.receiveLabel} from ${def.name}.` };
  }

  static async repayLoan(userId, loanId, requesterId = game.user.id) {
    const requester = game.users.get(requesterId);
    const user = game.users.get(userId);
    if (!requester || !user) throw new Error("Player not found.");
    if (!requester.isGM && requester.id !== user.id) throw new Error("You may only repay your own loan.");
    const def = this.loanDefinitions()[loanId];
    if (!def) throw new Error("Unknown loan contract.");
    const entry = this.getEntry(userId);
    if (!entry?.loans?.[loanId]?.active) throw new Error(`${def.name} is not active.`);

    await this.transact(userId, {
      type: "loan",
      action: `${def.name} — Loan Repaid (-${def.repayLabel})`,
      delta: { gold: -def.repay.gold, credits: -def.repay.credits, xp: -def.repay.xp },
      editorUserId: requesterId,
      metadata: { loanId, mode: "repay", receive: def.receive, repay: def.repay },
      mutateEntry: ledgerEntry => {
        ledgerEntry.loans ||= {};
        ledgerEntry.loans[loanId] = {
          ...ledgerEntry.loans[loanId],
          active: false,
          repaidAt: Date.now(),
          repaidByUserId: requesterId
        };
      }
    });
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

  static async createInternalBackup(reason, ledger = null) {
    if (!game.user.isGM) return;
    const backupStore = game.settings.get(AVL_MODULE_ID, AVL_BACKUP_SETTING) || { backups: [] };
    backupStore.backups ||= [];
    backupStore.backups.unshift({
      id: foundry.utils.randomID(20),
      timestamp: Date.now(),
      reason: reason || "Manual backup",
      ledger: foundry.utils.deepClone(ledger || this.store())
    });
    backupStore.backups = backupStore.backups.slice(0, 10);
    await game.settings.set(AVL_MODULE_ID, AVL_BACKUP_SETTING, backupStore);
  }

  static exportBackup() {
    return {
      format: "actor-vault-resource-ledger",
      formatVersion: 1,
      exportedAt: Date.now(),
      moduleVersion: game.modules.get(AVL_MODULE_ID)?.version || "unknown",
      worldId: game.world?.id || null,
      ledger: this.store()
    };
  }

  static migrateStore(store) {
    const migrated = foundry.utils.deepClone(store && typeof store === "object" ? store : this.emptyStore());
    migrated.entries ||= {};
    for (const [key, rawEntry] of Object.entries(migrated.entries)) {
      const entry = rawEntry && typeof rawEntry === "object" ? rawEntry : {};
      entry.key = key;
      entry.resources = this.normalizeResources(entry.resources || {});
      entry.history = (Array.isArray(entry.history) ? entry.history : []).map(history => this.normalizeHistoryEntry(history)).slice(0, 250);
      entry.loans = entry.loans && typeof entry.loans === "object" ? entry.loans : {};
      entry.archived = Boolean(entry.archived);
      delete entry.manualArchived;
      migrated.entries[key] = entry;
    }
    migrated.version = AVL_LEDGER_VERSION;
    return migrated;
  }

  static async migrateIfNeeded() {
    if (!game.user.isGM) return;
    const store = this.store();
    const version = Math.max(1, Math.trunc(Number(store.version) || 1));
    if (version >= AVL_LEDGER_VERSION) return;
    await this.createInternalBackup(`Automatic pre-migration backup: v${version} → v${AVL_LEDGER_VERSION}`, store);
    await this.write(this.migrateStore(store));
    ui.notifications.info(`Actor Vault resource ledger migrated to schema v${AVL_LEDGER_VERSION}.`);
  }

  static async importBackup(payload) {
    if (!game.user.isGM) throw new Error("Only a GM can import resource-ledger backups.");
    if (!payload || payload.format !== "actor-vault-resource-ledger" || !payload.ledger?.entries) {
      throw new Error("This is not a valid Actor Vault resource-ledger backup.");
    }
    await this.createInternalBackup("Automatic backup before manual ledger import");
    const migrated = this.migrateStore(payload.ledger);
    await this.write(migrated);
    await this.syncCurrentUsers();
    return migrated;
  }
}

globalThis.ActorVaultLedger = ActorVaultLedger;
Hooks.once("init", () => ActorVaultLedger.registerSettings());
Hooks.once("ready", async () => {
  if (!game.user.isGM) return;
  await ActorVaultLedger.migrateIfNeeded();
  await ActorVaultLedger.syncCurrentUsers();
});

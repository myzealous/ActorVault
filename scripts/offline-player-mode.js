const AVOP_MODULE_ID = "actor-vault";
const AVOP_FLAG = "offlineLedger";
const AVOP_RESOURCE_SCOPE = "world";
const AVOP_RESOURCE_KEY = "metaResources";
const AVOP_HISTORY_KEY = "metaResourcesHistory";
const AVOP_LONG_REST_PATH = "flags.actor-vault.longRest";

class ActorVaultOfflinePlayerMode {
  static originals = {};

  static primaryGM() {
    return game.users
      .filter(user => user.active && user.isGM)
      .sort((a, b) => a.id.localeCompare(b.id))[0] || null;
  }

  static enabledFor(userId = game.user.id) {
    return !game.user.isGM && !this.primaryGM() && userId === game.user.id;
  }

  static offlineEntry(userId) {
    const user = game.users.get(userId);
    if (!user) return null;

    const stored = user.getFlag(AVOP_MODULE_ID, AVOP_FLAG);
    if (stored && typeof stored === "object") return foundry.utils.deepClone(stored);

    const ledger = globalThis.ActorVaultLedger;
    if (!ledger) return null;

    // IMPORTANT: do not call the original getResources/getHistory/getLoans here.
    // Those methods call this.getEntry(), which is replaced by the offline shim and
    // would recurse back into offlineEntry() until the browser stack overflows.
    const persistent = this.originals.getEntry
      ? this.originals.getEntry.call(ledger, userId)
      : null;

    const legacyResources = user.getFlag(AVOP_RESOURCE_SCOPE, AVOP_RESOURCE_KEY) || {};
    const legacyHistory = user.getFlag(AVOP_RESOURCE_SCOPE, AVOP_HISTORY_KEY) || [];

    return {
      resources: ledger.normalizeResources(persistent?.resources ?? legacyResources),
      history: foundry.utils.deepClone(
        Array.isArray(persistent?.history)
          ? persistent.history
          : (Array.isArray(legacyHistory) ? legacyHistory : [])
      ),
      loans: foundry.utils.deepClone(
        persistent?.loans && typeof persistent.loans === "object"
          ? persistent.loans
          : {}
      ),
      updatedAt: Number(persistent?.updatedAt) || Date.now()
    };
  }

  static async writeOfflineEntry(userId, entry) {
    const user = game.users.get(userId);
    if (!user || user.id !== game.user.id) throw new Error("You may only update your own Actor Vault data while no GM is online.");
    entry.updatedAt = Date.now();
    entry.history = Array.isArray(entry.history) ? entry.history.slice(0, 250) : [];
    entry.loans ||= {};
    await user.setFlag(AVOP_MODULE_ID, AVOP_FLAG, entry);
    await user.setFlag(AVOP_RESOURCE_SCOPE, AVOP_RESOURCE_KEY, foundry.utils.deepClone(entry.resources));
    await user.setFlag(AVOP_RESOURCE_SCOPE, AVOP_HISTORY_KEY, foundry.utils.deepClone(entry.history.slice(0, 30)));
    return entry;
  }

  static installLedgerFallback() {
    const ledger = globalThis.ActorVaultLedger;
    if (!ledger || this.originals.transact) return;

    this.originals.getEntry = ledger.getEntry;
    this.originals.getResources = ledger.getResources;
    this.originals.getHistory = ledger.getHistory;
    this.originals.getLoans = ledger.getLoans;
    this.originals.transact = ledger.transact;

    ledger.getEntry = function(userId) {
      if (!ActorVaultOfflinePlayerMode.enabledFor(userId)) return ActorVaultOfflinePlayerMode.originals.getEntry.call(this, userId);
      const entry = ActorVaultOfflinePlayerMode.offlineEntry(userId);
      return entry ? { ...entry, resources: this.normalizeResources(entry.resources), history: entry.history || [], loans: entry.loans || {} } : null;
    };

    ledger.getResources = function(userId) {
      if (!ActorVaultOfflinePlayerMode.enabledFor(userId)) return ActorVaultOfflinePlayerMode.originals.getResources.call(this, userId);
      return this.normalizeResources(ActorVaultOfflinePlayerMode.offlineEntry(userId)?.resources || {});
    };

    ledger.getHistory = function(userId) {
      if (!ActorVaultOfflinePlayerMode.enabledFor(userId)) return ActorVaultOfflinePlayerMode.originals.getHistory.call(this, userId);
      return foundry.utils.deepClone(ActorVaultOfflinePlayerMode.offlineEntry(userId)?.history || []);
    };

    ledger.getLoans = function(userId) {
      if (!ActorVaultOfflinePlayerMode.enabledFor(userId)) return ActorVaultOfflinePlayerMode.originals.getLoans.call(this, userId);
      return foundry.utils.deepClone(ActorVaultOfflinePlayerMode.offlineEntry(userId)?.loans || {});
    };

    ledger.transact = async function(userId, transaction = {}) {
      if (!ActorVaultOfflinePlayerMode.enabledFor(userId)) {
        return ActorVaultOfflinePlayerMode.originals.transact.call(this, userId, transaction);
      }

      const user = game.users.get(userId);
      if (!user) throw new Error("Player not found.");
      if (user.id !== game.user.id) throw new Error("You may only change your own Actor Vault resources while no GM is online.");

      const entry = ActorVaultOfflinePlayerMode.offlineEntry(userId);
      const previous = this.normalizeResources(entry.resources);
      const next = foundry.utils.deepClone(previous);
      const delta = transaction.delta && typeof transaction.delta === "object" ? transaction.delta : {};

      for (const key of ["gold", "credits", "xp"]) {
        if (delta[key] !== undefined) next[key] = (Number(next[key]) || 0) + (Number(delta[key]) || 0);
      }
      if (transaction.set && typeof transaction.set === "object") Object.assign(next, foundry.utils.deepClone(transaction.set));

      const normalizedNext = this.normalizeResources(next);
      if (!transaction.allowNegative) {
        if (normalizedNext.gold < 0) throw new Error("Not enough gold for this transaction.");
        if (normalizedNext.credits < 0) throw new Error("Not enough Server Credits for this transaction.");
        if (normalizedNext.xp < 0) throw new Error("Not enough XP for this transaction.");
      }

      entry.resources = normalizedNext;
      entry.loans ||= {};
      if (typeof transaction.mutateEntry === "function") transaction.mutateEntry(entry, normalizedNext, previous);

      const historyEntry = {
        id: foundry.utils.randomID(20),
        timestamp: Date.now(),
        type: transaction.type || "resource",
        action: transaction.action || "Resource transaction",
        editorUserId: game.user.id,
        editorName: game.user.name,
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
      await ActorVaultOfflinePlayerMode.writeOfflineEntry(userId, entry);
      return { entry, previous, next: normalizedNext, historyEntry };
    };
  }

  static ownerId(actor) {
    return foundry.utils.getProperty(actor, "flags.actor-vault.record.mainUserId") || null;
  }

  static async executePlayerAccess(action, data, requesterId) {
    const access = globalThis.ActorVaultPlayerAccess;
    const ledger = globalThis.ActorVaultLedger;
    if (!access || !ledger) throw new Error("Actor Vault player services are unavailable.");
    if (requesterId !== game.user.id) throw new Error("Invalid offline Actor Vault requester.");

    if (action === "saveResources") {
      if (data.userId !== requesterId) throw new Error("You may only edit your own dashboard resources.");
      const previous = ledger.getResources(requesterId);
      const next = ledger.normalizeResources({ ...previous, ...(data.resources || {}) });
      await ledger.transact(requesterId, {
        type: "resource",
        action: "Dashboard resources updated",
        set: next,
        editorUserId: requesterId,
        metadata: { source: "offline-player" }
      });
      return { message: `${game.user.name}'s dashboard was saved.` };
    }

    if (["longRest", "noLongRest", "quickRecovery"].includes(action)) {
      const actor = game.actors.get(data.actorId);
      if (!actor) throw new Error("Actor not found.");
      const ownerId = this.ownerId(actor);
      if (ownerId !== requesterId || !actor.isOwner) throw new Error("You may only change long-rest settings for your own character.");

      const previousRest = access.restState(actor);
      let nextRest = foundry.utils.deepClone(previousRest);
      let creditDelta = 0;
      let label = "";

      if (action === "quickRecovery") {
        const enabled = Boolean(data.enabled);
        if (previousRest.quickRecovery === enabled) return { message: `${actor.name}: Quick Recovery unchanged.` };
        nextRest = { quickRecovery: enabled, cost: access.clampRestCost(previousRest.cost + (enabled ? -1 : 1), enabled) };
        label = `Quick Recovery ${enabled ? "enabled" : "disabled"} for ${actor.name} (${previousRest.cost} to ${nextRest.cost})`;
      } else if (action === "longRest") {
        const resources = ledger.getResources(ownerId);
        const paid = previousRest.cost;
        if (resources.credits < paid) throw new Error(`${actor.name} needs ${paid} Server Credit${paid === 1 ? "" : "s"}.`);
        nextRest = { ...previousRest, cost: access.clampRestCost(previousRest.cost + 1, previousRest.quickRecovery) };
        creditDelta = -paid;
        label = `${actor.name} Long Rest (${paid} credit${paid === 1 ? "" : "s"} paid)`;
      } else {
        nextRest = { ...previousRest, cost: access.clampRestCost(previousRest.cost - 1, previousRest.quickRecovery) };
        label = `${actor.name} Did Not Long Rest (${previousRest.cost} to ${nextRest.cost})`;
      }

      await actor.update({ [AVOP_LONG_REST_PATH]: nextRest });
      try {
        await ledger.transact(ownerId, {
          type: "long-rest",
          action: label,
          delta: { credits: creditDelta },
          editorUserId: requesterId,
          actorId: actor.id,
          actorName: actor.name,
          previousLongRest: previousRest,
          longRest: nextRest,
          metadata: { previousRest, nextRest, source: "offline-player" }
        });
      } catch (error) {
        await actor.update({ [AVOP_LONG_REST_PATH]: previousRest }).catch(() => {});
        throw error;
      }
      return { message: action === "longRest" ? `${actor.name} completed a long rest.` : `${actor.name}: long-rest settings updated.` };
    }

    throw new Error(`Unknown offline player-access action: ${action}`);
  }

  static installSocketFallback() {
    const bridge = globalThis.ActorVaultSocketBridge;
    if (!bridge || this.originals.bridgeRequest) return;
    this.originals.bridgeRequest = bridge.request;

    bridge.request = async function(scope, action, data = {}) {
      if (game.user.isGM || ActorVaultOfflinePlayerMode.primaryGM()) {
        return ActorVaultOfflinePlayerMode.originals.bridgeRequest.call(this, scope, action, data);
      }
      if (scope === "meta-shop") {
        if (!globalThis.ActorVaultMetaShop) throw new Error("Meta Shop is unavailable.");
        return ActorVaultMetaShop.execute(action, data, game.user.id);
      }
      if (scope === "player-access") {
        return ActorVaultOfflinePlayerMode.executePlayerAccess(action, data, game.user.id);
      }
      throw new Error(`Actor Vault ${scope} requires a GM.`);
    };

    if (globalThis.ActorVaultMetaShop) {
      ActorVaultMetaShop.request = (action, data = {}) => bridge.request("meta-shop", action, data);
    }
    if (globalThis.ActorVaultPlayerAccess) {
      ActorVaultPlayerAccess.request = (action, data = {}) => bridge.request("player-access", action, data);
    }
  }

  static async reconcileOfflineLedgers() {
    if (!game.user.isGM || !globalThis.ActorVaultLedger) return;
    const ledger = globalThis.ActorVaultLedger;
    let changed = false;
    const store = ledger.store();

    for (const user of game.users) {
      const offline = user.getFlag(AVOP_MODULE_ID, AVOP_FLAG);
      if (!offline || typeof offline !== "object") continue;
      const entry = ledger.ensureEntryInStore(store, user);
      if (!entry) continue;
      if ((Number(offline.updatedAt) || 0) <= (Number(entry.updatedAt) || 0)) {
        await user.unsetFlag(AVOP_MODULE_ID, AVOP_FLAG).catch(() => {});
        continue;
      }
      entry.resources = ledger.normalizeResources(offline.resources || {});
      entry.history = Array.isArray(offline.history) ? foundry.utils.deepClone(offline.history).slice(0, 250) : entry.history;
      entry.loans = offline.loans && typeof offline.loans === "object" ? foundry.utils.deepClone(offline.loans) : entry.loans;
      entry.updatedAt = Number(offline.updatedAt) || Date.now();
      changed = true;
    }

    if (changed) await ledger.write(store);
    for (const user of game.users) {
      const entry = store.entries?.[ledger.keyForUser(user)];
      if (entry) await ledger.mirrorUser(user, entry);
      if (user.getFlag(AVOP_MODULE_ID, AVOP_FLAG)) await user.unsetFlag(AVOP_MODULE_ID, AVOP_FLAG).catch(() => {});
    }
  }

  static async ready() {
    this.installLedgerFallback();
    this.installSocketFallback();
    if (game.user.isGM) await this.reconcileOfflineLedgers();
    console.log("actor-vault | Offline player mode ready");
  }
}

globalThis.ActorVaultOfflinePlayerMode = ActorVaultOfflinePlayerMode;
Hooks.once("ready", () => ActorVaultOfflinePlayerMode.ready().catch(error => console.error("actor-vault | Offline player mode failed", error)));

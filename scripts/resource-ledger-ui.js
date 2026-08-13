const AVLUI_MODULE_ID = "actor-vault";
const AVLUI_SOCKET = `module.${AVLUI_MODULE_ID}-ledger`;
const AVLUI_SCOPE = "world";
const AVLUI_RESOURCE_KEY = "metaResources";
const AVLUI_HISTORY_KEY = "metaResourcesHistory";

class ActorVaultLedgerUI {
  static pending = new Map();
  static syncing = false;

  static root(element, app) {
    return element instanceof HTMLElement ? element : element?.[0] || app?.element || null;
  }

  static primaryGM() {
    return game.users.filter(user => user.active && user.isGM).sort((a, b) => a.id.localeCompare(b.id))[0] || null;
  }

  static async request(action, data = {}) {
    if (game.user.isGM) return this.execute(action, data, game.user.id);
    const gm = this.primaryGM();
    if (!gm) throw new Error("Actor Vault resource operations require an active GM.");
    const requestId = foundry.utils.randomID(20);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("Actor Vault ledger request timed out."));
      }, 20000);
      this.pending.set(requestId, { resolve, reject, timeout });
      game.socket.emit(AVLUI_SOCKET, { kind: "request", requestId, action, data, requesterId: game.user.id });
    });
  }

  static async onSocket(payload) {
    if (!payload || typeof payload !== "object") return;
    if (payload.kind === "response" && payload.targetUserId === game.user.id) {
      const pending = this.pending.get(payload.requestId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(payload.requestId);
      payload.ok ? pending.resolve(payload.result) : pending.reject(new Error(payload.error || "Actor Vault ledger operation failed."));
      return;
    }
    if (payload.kind !== "request") return;
    if (!game.user.isGM || game.user.id !== this.primaryGM()?.id) return;
    let response;
    try {
      response = { ok: true, result: await this.execute(payload.action, payload.data, payload.requesterId) };
    } catch (error) {
      console.error(`${AVLUI_MODULE_ID} | Ledger request failed`, error);
      response = { ok: false, error: error.message };
    }
    game.socket.emit(AVLUI_SOCKET, { kind: "response", requestId: payload.requestId, targetUserId: payload.requesterId, ...response });
  }

  static assertOwnUser(userId, requesterId) {
    const requester = game.users.get(requesterId);
    const target = game.users.get(userId);
    if (!requester || !target) throw new Error("Player not found.");
    if (!requester.isGM && requester.id !== target.id) throw new Error("You may only change your own resources.");
    return { requester, target };
  }

  static async execute(action, data, requesterId) {
    if (!globalThis.ActorVaultLedger) throw new Error("Persistent Resource Ledger is unavailable.");
    if (action === "save") {
      const { requester, target } = this.assertOwnUser(data.userId, requesterId);
      const previous = ActorVaultLedger.getResources(target.id);
      const next = ActorVaultLedger.normalizeResources({ ...previous, ...data.resources });
      await ActorVaultLedger.commitResources(target.id, next, {
        previous,
        editorUserId: requester.id,
        action: "Dashboard update"
      });
      return { message: `${target.name}'s dashboard was saved.` };
    }
    if (action === "housing") {
      const { requester, target } = this.assertOwnUser(data.userId, requesterId);
      const previous = ActorVaultLedger.getResources(target.id);
      const next = { ...previous, housingTier: Math.min(4, Math.max(0, Math.trunc(Number(data.tier) || 0))) };
      await ActorVaultLedger.commitResources(target.id, next, {
        previous,
        editorUserId: requester.id,
        action: `Housing changed to ${["None", "Homestead", "House", "Manor", "Estate"][next.housingTier]}`
      });
      return { message: `${target.name}'s housing was updated.` };
    }
    if (action === "takeLoan") return ActorVaultLedger.takeLoan(data.userId, data.loanId, requesterId);
    if (action === "repayLoan") return ActorVaultLedger.repayLoan(data.userId, data.loanId, requesterId);
    if (action === "deleteArchived") {
      if (!game.users.get(requesterId)?.isGM) throw new Error("Only a GM can delete archived ledger users.");
      for (const key of data.keys || []) await ActorVaultLedger.deleteArchived(key);
      return { message: `${(data.keys || []).length} archived ledger entr${(data.keys || []).length === 1 ? "y" : "ies"} deleted.` };
    }
    throw new Error(`Unknown ledger action: ${action}`);
  }

  static historyKey(entry) {
    return [entry?.timestamp ?? 0, entry?.action ?? "", entry?.actorId ?? "", entry?.editorUserId ?? ""].join("|");
  }

  static async syncFromUser(user) {
    if (!game.user.isGM || this.syncing || !user || user.isGM || !globalThis.ActorVaultLedger) return;
    this.syncing = true;
    try {
      const store = ActorVaultLedger.store();
      const entry = ActorVaultLedger.ensureEntryInStore(store, user);
      const userResources = user.getFlag(AVLUI_SCOPE, AVLUI_RESOURCE_KEY);
      if (userResources && typeof userResources === "object") entry.resources = ActorVaultLedger.normalizeResources(userResources);
      const userHistory = user.getFlag(AVLUI_SCOPE, AVLUI_HISTORY_KEY);
      if (Array.isArray(userHistory) && userHistory.length) {
        const combined = [...userHistory, ...(entry.history || [])];
        const seen = new Set();
        entry.history = combined.filter(item => {
          const key = this.historyKey(item);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }).sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0)).slice(0, 100);
      }
      entry.updatedAt = Date.now();
      await ActorVaultLedger.write(store);
    } finally {
      this.syncing = false;
    }
  }

  static async restoreCurrentUsers() {
    if (!game.user.isGM || !globalThis.ActorVaultLedger) return;
    await ActorVaultLedger.syncCurrentUsers();
    this.syncing = true;
    try {
      for (const user of game.users.filter(u => !u.isGM)) {
        const entry = ActorVaultLedger.getEntry(user.id);
        if (!entry) continue;
        const resources = ActorVaultLedger.normalizeResources(entry.resources);
        const current = ActorVaultLedger.normalizeResources(user.getFlag(AVLUI_SCOPE, AVLUI_RESOURCE_KEY));
        if (JSON.stringify(resources) !== JSON.stringify(current)) await user.setFlag(AVLUI_SCOPE, AVLUI_RESOURCE_KEY, resources);
        const history = Array.isArray(entry.history) ? entry.history.slice(0, 30) : [];
        const currentHistory = user.getFlag(AVLUI_SCOPE, AVLUI_HISTORY_KEY) || [];
        if (JSON.stringify(history) !== JSON.stringify(currentHistory)) await user.setFlag(AVLUI_SCOPE, AVLUI_HISTORY_KEY, history);
      }
    } finally {
      this.syncing = false;
    }
  }

  static loanCards(userId) {
    const defs = ActorVaultLedger.loanDefinitions();
    const loans = ActorVaultLedger.getLoans(userId);
    return Object.values(defs).map(def => {
      const active = Boolean(loans?.[def.id]?.active);
      return `<article class="avd-loan-card" data-avl-loan="${def.id}">
        <div class="avd-loan-card__text">
          <strong>${foundry.utils.escapeHTML(def.name)}</strong>
          <span>Receive: ${foundry.utils.escapeHTML(def.receiveLabel)}</span>
          <span>Repay: ${foundry.utils.escapeHTML(def.repayLabel)}</span>
          <em>${active ? "Active contract" : "No active contract"}</em>
        </div>
        <button type="button" data-avl-${active ? "repay" : "take"}="${def.id}">${active ? "Pay Loan" : "Take Loan"}</button>
      </article>`;
    }).join("");
  }

  static async confirmLoan(userId, loanId, mode) {
    const user = game.users.get(userId);
    const def = ActorVaultLedger.loanDefinitions()[loanId];
    if (!user || !def) return false;
    const taking = mode === "take";
    return foundry.applications.api.DialogV2.confirm({
      window: { title: `${taking ? "Take" : "Pay"} ${def.name}` },
      content: `<p><strong>${foundry.utils.escapeHTML(user.name)}</strong></p><p>${taking ? `Receive <strong>${def.receiveLabel}</strong> now and owe <strong>${def.repayLabel}</strong>.` : `Repay <strong>${def.repayLabel}</strong> now and close this contract.`}</p><p>Limit: 1 active ${foundry.utils.escapeHTML(def.name)} contract per player.</p>`,
      yes: { label: taking ? "Take Loan" : "Pay Loan" },
      no: { label: "Cancel" },
      modal: true
    });
  }

  static bindLoans(app, root) {
    const form = root.querySelector("form[data-resource-form]");
    const userId = form?.dataset.userId;
    if (!userId || !game.users.get(userId)) return;
    let section = root.querySelector("[data-avl-loans]");
    if (!section) {
      section = document.createElement("section");
      section.className = "avd-loans";
      section.dataset.avlLoans = "true";
      form.insertAdjacentElement("afterend", section);
    }
    section.innerHTML = `<div class="avd-storage-heading"><h3>Loan Contracts</h3><span>Each contract may be active once at a time.</span></div><div class="avd-loan-grid">${this.loanCards(userId)}</div>`;
    for (const button of section.querySelectorAll("[data-avl-take],[data-avl-repay]")) {
      button.addEventListener("click", async event => {
        event.preventDefault();
        const loanId = button.dataset.avlTake || button.dataset.avlRepay;
        const mode = button.dataset.avlTake ? "take" : "repay";
        if (!await this.confirmLoan(userId, loanId, mode)) return;
        section.querySelectorAll("button").forEach(b => b.disabled = true);
        try {
          const result = await this.request(mode === "take" ? "takeLoan" : "repayLoan", { userId, loanId });
          ui.notifications.info(result.message);
          await app.render({ force: true });
        } catch (error) {
          ui.notifications.error(error.message);
          section.querySelectorAll("button").forEach(b => b.disabled = false);
        }
      });
    }
  }

  static bindSave(app, root) {
    const form = root.querySelector("form[data-resource-form]");
    const oldButton = form?.querySelector('button[data-action="save-resources"]');
    if (!form || !oldButton || oldButton.dataset.avlLedgerBound === "true") return;
    const button = oldButton.cloneNode(true);
    button.dataset.avlLedgerBound = "true";
    oldButton.replaceWith(button);
    const gold = form.elements.gold;
    if (gold) gold.step = "0.1";
    button.addEventListener("click", async event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      button.disabled = true;
      try {
        const resources = {
          gold: Number(form.elements.gold?.value ?? 0),
          credits: Number(form.elements.credits?.value ?? 0),
          xp: Number(form.elements.xp?.value ?? 0),
          housingTier: Number(root.querySelector("[data-housing-tier]")?.value ?? 0),
          storage: [0, 1, 2, 3].map(i => String(form.elements[`s${i}`]?.value ?? "").trim())
        };
        const result = await this.request("save", { userId: form.dataset.userId, resources });
        ui.notifications.info(result.message);
        await app.render({ force: true });
      } catch (error) {
        ui.notifications.error(error.message);
        button.disabled = false;
      }
    }, true);
  }

  static bindHousing(app, root) {
    const form = root.querySelector("form[data-resource-form]");
    const oldSelect = root.querySelector("[data-housing-tier]");
    if (!form || !oldSelect || oldSelect.dataset.avlLedgerBound === "true") return;
    const select = oldSelect.cloneNode(true);
    select.dataset.avlLedgerBound = "true";
    select.value = String(ActorVaultLedger.getResources(form.dataset.userId).housingTier || 0);
    oldSelect.replaceWith(select);
    select.addEventListener("change", async event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      select.disabled = true;
      try {
        const result = await this.request("housing", { userId: form.dataset.userId, tier: select.value });
        ui.notifications.info(result.message);
        await app.render({ force: true });
      } catch (error) {
        ui.notifications.error(error.message);
        select.disabled = false;
      }
    }, true);
  }

  static historyEntriesForValue(value) {
    if (game.users.get(value)) return { label: game.users.get(value).name, history: ActorVaultLedger.getHistory(value) };
    const entry = ActorVaultLedger.getEntryByKey(value);
    return { label: entry?.name || "Archived User", history: Array.isArray(entry?.history) ? foundry.utils.deepClone(entry.history) : [] };
  }

  static async openHistory(initialUserId) {
    const current = game.user.isGM ? game.users.filter(u => !u.isGM).sort((a, b) => a.name.localeCompare(b.name)) : [game.user];
    const archived = game.user.isGM ? ActorVaultLedger.allEntries().filter(e => e.archived).sort((a, b) => String(a.name).localeCompare(String(b.name))) : [];
    const currentOptions = current.map(user => `<option value="${foundry.utils.escapeHTML(user.id)}" ${user.id === initialUserId ? "selected" : ""}>${foundry.utils.escapeHTML(user.name)}</option>`).join("");
    const archivedOptions = archived.length ? `<optgroup label="Archived">${archived.map(entry => `<option value="${foundry.utils.escapeHTML(entry.key)}">${foundry.utils.escapeHTML(entry.name)} [Archived]</option>`).join("")}</optgroup>` : "";
    const dialog = new foundry.applications.api.DialogV2({
      window: { title: game.user.isGM ? "Resource History" : "My Resource History", resizable: true },
      position: { width: 1180, height: 720 },
      content: `<section class="avd-history"><label>Player<select data-avl-history-user ${game.user.isGM ? "" : "disabled"}>${currentOptions}${archivedOptions}</select></label><div data-avl-history-log></div></section>`,
      buttons: [{ action: "close", label: "Close", default: true }]
    });
    await dialog.render({ force: true });
    const select = dialog.element.querySelector("[data-avl-history-user]");
    const log = dialog.element.querySelector("[data-avl-history-log]");
    const housingName = tier => ["None", "Homestead", "House", "Manor", "Estate"][Math.max(0, Math.min(4, Number(tier) || 0))];
    const draw = () => {
      const { history } = this.historyEntriesForValue(select.value);
      if (!history.length) { log.innerHTML = "<p>No resource history recorded.</p>"; return; }
      log.innerHTML = `<table><thead><tr><th>Date</th><th>Action</th><th>Character</th><th>Editor</th><th>Credits</th><th>Housing</th><th>Gold</th><th>XP</th><th>Storage</th></tr></thead><tbody>${history.map(entry => {
        const state = entry.state || {};
        const storage = Array.isArray(state.storage) ? state.storage.filter(Boolean).join(", ") : "";
        const editor = entry.editorName || game.users.get(entry.editorUserId)?.name || "Unknown";
        return `<tr><td>${new Date(entry.timestamp).toLocaleString()}</td><td>${foundry.utils.escapeHTML(entry.action || "Dashboard update")}</td><td>${foundry.utils.escapeHTML(entry.actorName || "—")}</td><td>${foundry.utils.escapeHTML(editor)}</td><td>${Number(state.credits) || 0}</td><td>${housingName(state.housingTier)}</td><td>${Number(state.gold) || 0}</td><td>${Number(state.xp) || 0}</td><td>${foundry.utils.escapeHTML(storage || "—")}</td></tr>`;
      }).join("")}</tbody></table>`;
    };
    select.addEventListener("change", draw);
    draw();
  }

  static bindHistory(root) {
    const oldButton = root.querySelector("[data-history-button]");
    if (!oldButton || oldButton.dataset.avlLedgerBound === "true") return;
    const button = oldButton.cloneNode(true);
    button.dataset.avlLedgerBound = "true";
    oldButton.replaceWith(button);
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const userId = root.querySelector("form[data-resource-form]")?.dataset.userId || game.user.id;
      this.openHistory(userId).catch(error => ui.notifications.error(error.message));
    }, true);
  }

  static async manageArchived() {
    const archived = ActorVaultLedger.allEntries().filter(entry => entry.archived).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    if (!archived.length) {
      ui.notifications.info("No archived resource-ledger users.");
      return;
    }
    const rows = archived.map((entry, index) => `<label style="display:flex;gap:.5rem;align-items:center;padding:.35rem 0"><input type="checkbox" name="avl-archive" value="${index}"><span><strong>${foundry.utils.escapeHTML(entry.name)}</strong> — ${entry.history?.length || 0} history entries</span></label>`).join("");
    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: "Manage Archived Resource Users" },
      position: { width: 620 },
      content: `<form data-avl-archive-form><p>Archived users remain here even after their Foundry user is removed. Delete them only when you intentionally want to remove their ledger and history.</p><div style="max-height:360px;overflow:auto">${rows}</div><p><strong>Deleting an archived ledger cannot be undone.</strong></p></form>`,
      buttons: [
        { action: "delete", label: "Delete Selected", callback: (event, button, dialog) => ({ action: "delete", indexes: [...dialog.element.querySelectorAll('input[name="avl-archive"]:checked')].map(el => Number(el.value)) }) },
        { action: "close", label: "Close", callback: () => ({ action: "close" }) }
      ],
      modal: true
    });
    if (result?.action !== "delete") return;
    const selected = (result.indexes || []).map(i => archived[i]).filter(Boolean);
    if (!selected.length) return ui.notifications.warn("No archived users selected.");
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Delete Archived Resource Data" },
      content: `<p>Permanently delete the resource ledger and history for <strong>${selected.map(e => foundry.utils.escapeHTML(e.name)).join(", ")}</strong>?</p><p><strong>This cannot be undone.</strong></p>`,
      yes: { label: "Delete Permanently" }, no: { label: "Cancel" }, modal: true
    });
    if (!confirmed) return;
    const response = await this.request("deleteArchived", { keys: selected.map(e => e.key) });
    ui.notifications.info(response.message);
  }

  static bindArchiveManager(root) {
    if (!game.user.isGM || root.querySelector("[data-avl-manage-archived]")) return;
    const toolbar = root.querySelector(".avd-header__actions");
    if (!toolbar) return;
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.avlManageArchived = "true";
    button.innerHTML = '<i class="fas fa-user-clock"></i> Archived Ledgers';
    button.addEventListener("click", () => this.manageArchived().catch(error => ui.notifications.error(error.message)));
    toolbar.append(button);
  }

  static async enhance(app, element) {
    if (app?.id !== "actor-vault-app" || !globalThis.ActorVaultLedger) return;
    const root = this.root(element, app);
    if (!root) return;
    this.bindSave(app, root);
    this.bindHousing(app, root);
    // Loan contracts are handled via Meta Shop UI.
    this.bindHistory(root);
    this.bindArchiveManager(root);
  }
}

globalThis.ActorVaultLedgerUI = ActorVaultLedgerUI;
Hooks.once("ready", async () => {
  game.socket.on(AVLUI_SOCKET, payload => ActorVaultLedgerUI.onSocket(payload));
  if (game.user.isGM) await ActorVaultLedgerUI.restoreCurrentUsers();
});
Hooks.on("updateUser", (user, changes) => {
  if (!game.user.isGM || ActorVaultLedgerUI.syncing) return;
  if (foundry.utils.hasProperty(changes, `flags.${AVLUI_SCOPE}.${AVLUI_RESOURCE_KEY}`) || foundry.utils.hasProperty(changes, `flags.${AVLUI_SCOPE}.${AVLUI_HISTORY_KEY}`)) {
    ActorVaultLedgerUI.syncFromUser(user).catch(error => console.error("actor-vault | Ledger sync failed", error));
  }
});
Hooks.on("createUser", () => { if (game.user.isGM) ActorVaultLedgerUI.restoreCurrentUsers().catch(console.error); });
Hooks.on("deleteUser", () => { if (game.user.isGM) ActorVaultLedger.syncCurrentUsers().catch(console.error); });
Hooks.on("renderApplicationV2", (app, element) => {
  if (app?.id !== "actor-vault-app") return;
  for (const delay of [0, 75, 200]) setTimeout(() => ActorVaultLedgerUI.enhance(app, element), delay);
});

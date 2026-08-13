const AVLUI_MODULE_ID = "actor-vault";
const AVLUI_SOCKET = `module.${AVLUI_MODULE_ID}-ledger`;

class ActorVaultLedgerUI {
  static pending = new Map();

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
      await ActorVaultLedger.transact(target.id, {
        type: "manual",
        action: "Dashboard update",
        set: data.resources,
        editorUserId: requester.id
      });
      return { message: `${target.name}'s dashboard was saved.` };
    }
    if (action === "housing") {
      const { requester, target } = this.assertOwnUser(data.userId, requesterId);
      const tier = Math.min(4, Math.max(0, Math.trunc(Number(data.tier) || 0)));
      await ActorVaultLedger.transact(target.id, {
        type: "manual",
        action: `Housing changed to ${["None", "Homestead", "House", "Manor", "Estate"][tier]}`,
        set: { housingTier: tier },
        editorUserId: requester.id
      });
      return { message: `${target.name}'s housing was updated.` };
    }
    if (action === "deleteArchived") {
      if (!game.users.get(requesterId)?.isGM) throw new Error("Only a GM can delete archived ledger users.");
      for (const key of data.keys || []) await ActorVaultLedger.deleteArchived(key);
      return { message: `${(data.keys || []).length} archived ledger entr${(data.keys || []).length === 1 ? "y" : "ies"} deleted.` };
    }
    throw new Error(`Unknown ledger action: ${action}`);
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

  static formatDelta(delta = {}) {
    const parts = [];
    for (const [key, label] of [["gold", "g"], ["credits", "sc"], ["xp", " XP"]]) {
      const value = Number(delta?.[key]) || 0;
      if (!value) continue;
      parts.push(`${value > 0 ? "+" : ""}${Number(value).toLocaleString()}${label}`);
    }
    return parts.join(" · ") || "—";
  }

  static historyForValue(value) {
    const user = game.users.get(value);
    if (user) return { label: user.name, history: ActorVaultLedger.getHistory(user.id) };
    const entry = ActorVaultLedger.getEntryByKey(value);
    return { label: entry?.name || "Archived User", history: Array.isArray(entry?.history) ? foundry.utils.deepClone(entry.history) : [] };
  }

  static async openHistory(initialValue) {
    const current = game.user.isGM ? [...game.users].sort((a, b) => a.name.localeCompare(b.name)) : [game.user];
    const archived = game.user.isGM ? ActorVaultLedger.allEntries().filter(entry => entry.archived).sort((a, b) => String(a.name).localeCompare(String(b.name))) : [];
    const validInitial = current.some(user => user.id === initialValue) || archived.some(entry => entry.key === initialValue)
      ? initialValue
      : current[0]?.id || archived[0]?.key;
    const currentOptions = current.map(user => `<option value="${foundry.utils.escapeHTML(user.id)}" ${user.id === validInitial ? "selected" : ""}>${foundry.utils.escapeHTML(user.name)}${user.isGM ? " [GM]" : ""}</option>`).join("");
    const archivedOptions = archived.length ? `<optgroup label="Archived">${archived.map(entry => `<option value="${foundry.utils.escapeHTML(entry.key)}" ${entry.key === validInitial ? "selected" : ""}>${foundry.utils.escapeHTML(entry.name)} [Archived]</option>`).join("")}</optgroup>` : "";
    const dialog = new foundry.applications.api.DialogV2({
      window: { title: game.user.isGM ? "Resource History" : "My Resource History", resizable: true },
      position: { width: 1240, height: 720 },
      content: `<section class="avd-history"><label>Player<select data-avl-history-user ${game.user.isGM ? "" : "disabled"}>${currentOptions}${archivedOptions}</select></label><div data-avl-history-log></div></section>`,
      buttons: [{ action: "close", label: "Close", default: true }]
    });
    await dialog.render({ force: true });
    const select = dialog.element.querySelector("[data-avl-history-user]");
    const log = dialog.element.querySelector("[data-avl-history-log]");
    const housingName = tier => ["None", "Homestead", "House", "Manor", "Estate"][Math.max(0, Math.min(4, Number(tier) || 0))];
    const draw = () => {
      const { history } = this.historyForValue(select.value);
      if (!history.length) {
        log.innerHTML = "<p>No resource history recorded.</p>";
        return;
      }
      log.innerHTML = `<table><thead><tr><th>Date</th><th>Type</th><th>Action</th><th>Change</th><th>Character</th><th>Editor</th><th>SC</th><th>Housing</th><th>Gold</th><th>XP</th><th>Storage</th></tr></thead><tbody>${history.map(entry => {
        const state = entry.state || {};
        const storage = Array.isArray(state.storage) ? state.storage.filter(Boolean).join(", ") : "";
        const editor = entry.editorName || game.users.get(entry.editorUserId)?.name || "Unknown";
        return `<tr><td>${new Date(entry.timestamp).toLocaleString()}</td><td>${foundry.utils.escapeHTML(entry.type || "legacy")}</td><td>${foundry.utils.escapeHTML(entry.action || "Resource update")}</td><td>${foundry.utils.escapeHTML(this.formatDelta(entry.delta))}</td><td>${foundry.utils.escapeHTML(entry.actorName || "—")}</td><td>${foundry.utils.escapeHTML(editor)}</td><td>${Number(state.credits) || 0}</td><td>${housingName(state.housingTier)}</td><td>${Number(state.gold) || 0}</td><td>${Number(state.xp) || 0}</td><td>${foundry.utils.escapeHTML(storage || "—")}</td></tr>`;
      }).join("")}</tbody></table>`;
    };
    select.addEventListener("change", draw);
    draw();
  }

  static bindHistory(root) {
    const oldButton = root.querySelector("[data-history-button], .actor-vault-history-open, [data-avp-history], [data-avx-history], [data-avuf-own-history]");
    if (!oldButton || oldButton.dataset.avlLedgerBound === "true") return;
    const button = oldButton.cloneNode(true);
    button.dataset.avlLedgerBound = "true";
    button.innerHTML = `<i class="fas fa-clock-rotate-left"></i> ${game.user.isGM ? "Resource History" : "My Resource History"}`;
    oldButton.replaceWith(button);
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const userId = root.querySelector("form[data-resource-form]")?.dataset.userId || game.user.id;
      this.openHistory(userId).catch(error => ui.notifications.error(error.message));
    }, true);
  }

  static async openArchivedLedgers() {
    const archived = ActorVaultLedger.allEntries().filter(entry => entry.archived).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    if (!archived.length) return ui.notifications.info("No archived resource ledgers.");
    const rows = archived.map((entry, index) => `<div style="display:grid;grid-template-columns:1fr auto auto;gap:.5rem;align-items:center;padding:.4rem 0;border-bottom:1px solid rgba(255,255,255,.08)"><span><strong>${foundry.utils.escapeHTML(entry.name)}</strong><br><small>${entry.history?.length || 0} history entries</small></span><button type="button" data-avl-view-archive="${index}">View History</button><label style="display:flex;gap:.3rem;align-items:center"><input type="checkbox" name="avl-delete-archive" value="${index}"> Delete</label></div>`).join("");
    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: "Archived Resource Ledgers", resizable: true },
      position: { width: 760, height: 600 },
      content: `<form data-avl-archive-form><p>Ledgers are archived automatically when no current Foundry/Forge user matches them.</p><div style="max-height:390px;overflow:auto">${rows}</div><p><strong>Permanent deletion cannot be undone.</strong></p></form>`,
      buttons: [
        { action: "delete", label: "Delete Checked", callback: (event, button, dialog) => ({ action: "delete", indexes: [...dialog.element.querySelectorAll('input[name="avl-delete-archive"]:checked')].map(el => Number(el.value)) }) },
        { action: "close", label: "Close", default: true, callback: () => ({ action: "close" }) }
      ],
      render: (event, dialog) => {
        dialog.element.querySelectorAll("[data-avl-view-archive]").forEach(button => button.addEventListener("click", () => {
          const entry = archived[Number(button.dataset.avlViewArchive)];
          if (entry) this.openHistory(entry.key).catch(error => ui.notifications.error(error.message));
        }));
      },
      modal: true
    });
    if (result?.action !== "delete") return;
    const selected = (result.indexes || []).map(index => archived[index]).filter(Boolean);
    if (!selected.length) return ui.notifications.warn("No archived ledgers selected.");
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Delete Archived Resource Data" },
      content: `<p>Permanently delete the resource ledger and history for <strong>${selected.map(entry => foundry.utils.escapeHTML(entry.name)).join(", ")}</strong>?</p><p><strong>This cannot be undone.</strong></p>`,
      yes: { label: "Delete Permanently" },
      no: { label: "Cancel" },
      modal: true
    });
    if (!confirmed) return;
    const response = await this.request("deleteArchived", { keys: selected.map(entry => entry.key) });
    ui.notifications.info(response.message);
  }

  static exportLedger() {
    if (!game.user.isGM) return;
    const payload = ActorVaultLedger.exportBackup();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `actor-vault-ledger-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    ui.notifications.info("Actor Vault ledger backup exported.");
  }

  static async importLedger(app) {
    if (!game.user.isGM) return;
    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: "Import Resource Ledger Backup" },
      position: { width: 620 },
      content: `<form><p>Select an Actor Vault resource-ledger JSON backup.</p><input type="file" accept="application/json,.json" data-avl-import-file><p><strong>The current ledger is automatically backed up internally before import.</strong></p></form>`,
      buttons: [
        { action: "import", label: "Import Backup", callback: (event, button, dialog) => ({ file: dialog.element.querySelector("[data-avl-import-file]")?.files?.[0] || null }) },
        { action: "close", label: "Cancel", default: true, callback: () => ({ file: null }) }
      ],
      modal: true
    });
    if (!result?.file) return;
    let payload;
    try { payload = JSON.parse(await result.file.text()); }
    catch { throw new Error("The selected file is not valid JSON."); }
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Replace Current Resource Ledger" },
      content: `<p>Replace the current persistent resource ledger with this backup?</p><p><strong>The current ledger will be saved to Actor Vault's automatic internal backups first.</strong></p>`,
      yes: { label: "Import and Replace" }, no: { label: "Cancel" }, modal: true
    });
    if (!confirmed) return;
    await ActorVaultLedger.importBackup(payload);
    ui.notifications.info("Actor Vault resource ledger imported successfully.");
    await app.render({ force: true });
  }

  static bindAdminButtons(app, root) {
    if (!game.user.isGM) return;
    const toolbar = root.querySelector(".avd-header__actions");
    if (!toolbar) return;
    if (!root.querySelector("[data-avl-archived-ledgers]")) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.avlArchivedLedgers = "true";
      button.innerHTML = '<i class="fas fa-box-archive"></i> Archived Ledgers';
      button.addEventListener("click", () => this.openArchivedLedgers().catch(error => ui.notifications.error(error.message)));
      toolbar.append(button);
    }
    if (!root.querySelector("[data-avl-export-ledger]")) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.avlExportLedger = "true";
      button.innerHTML = '<i class="fas fa-file-export"></i> Export Ledger';
      button.addEventListener("click", () => this.exportLedger());
      toolbar.append(button);
    }
    if (!root.querySelector("[data-avl-import-ledger]")) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.avlImportLedger = "true";
      button.innerHTML = '<i class="fas fa-file-import"></i> Import Ledger';
      button.addEventListener("click", () => this.importLedger(app).catch(error => ui.notifications.error(error.message)));
      toolbar.append(button);
    }
  }

  // Consolidated layout cleanup previously supplied by final-layout.js.
  static cleanStored(row) {
    row.classList.add("avfl-stored-row");
    row.querySelectorAll("[data-avp-progression], [data-avs-sync], .avs-skill-reason, .avx-skill-reason, .actor-vault__owner-label").forEach(node => node.remove());
    const identity = row.querySelector(".actor-vault__identity");
    if (!identity) return;
    const meta = identity.querySelector("span:not(.avfl-stored-owner)");
    const owner = meta?.textContent?.split("·").at(-1)?.trim() || "";
    meta?.remove();
    let ownerLine = identity.querySelector(".avfl-stored-owner");
    if (!ownerLine) {
      ownerLine = document.createElement("span");
      ownerLine.className = "avfl-stored-owner";
      identity.append(ownerLine);
    }
    ownerLine.textContent = owner;
  }

  static cleanActive(row) {
    row.classList.add("avfl-active-row");
    row.querySelectorAll(".avs-skill-reason, .avx-skill-reason").forEach(node => node.remove());
    const sync = [...row.querySelectorAll("[data-avs-sync]")];
    sync.slice(1).forEach(node => node.remove());
    const identity = row.querySelector(".actor-vault__identity");
    const meta = identity?.querySelector("span");
    const isNpc = meta?.textContent?.trim().toLowerCase().startsWith("npc");
    row.classList.toggle("avfl-npc-row", Boolean(isNpc));
    if (isNpc) {
      row.querySelectorAll("[data-avp-progression], [data-avs-sync]").forEach(node => node.remove());
      identity?.querySelector(".avl-skill-summary, .avfl-skill-summary")?.remove();
      return;
    }
    const progression = row.querySelector("[data-avp-progression]");
    if (!progression || !identity) return;
    let summary = identity.querySelector(".avfl-skill-summary");
    if (!summary) {
      summary = document.createElement("div");
      summary.className = "avfl-skill-summary";
      identity.append(summary);
    }
    const points = progression.querySelector(".avp-skill-points");
    const breakdown = progression.querySelector(".avp-breakdown");
    if (points) {
      points.innerHTML = points.innerHTML.replace(/\s*\/\s*19/g, "");
      summary.append(points);
    }
    if (breakdown) summary.append(breakdown);
    progression.querySelectorAll(".avl-worldbreaker-label, .avuf-worldbreaker-label, .avfl-worldbreaker-label").forEach(node => node.remove());
    const select = progression.querySelector("select");
    if (select && !progression.querySelector(".avfl-worldbreaker-label")) {
      const label = document.createElement("span");
      label.className = "avfl-worldbreaker-label";
      label.textContent = "Worldbreaker";
      select.before(label);
    }
  }

  static applyLayout(root) {
    root.classList.add("avfl-layout");
    const form = root.querySelector("form[data-resource-form]");
    const grid = form?.querySelector(".actor-vault__resource-grid");
    const actions = form?.querySelector(".actor-vault__resource-actions");
    if (grid && actions && !actions.dataset.avflMoved) {
      actions.dataset.avflMoved = "true";
      grid.append(actions);
    }
    root.querySelectorAll("[data-pack-id]").forEach(row => this.cleanStored(row));
    root.querySelectorAll("[data-actor-id]").forEach(row => this.cleanActive(row));
  }

  static async enhance(app, element) {
    if (app?.id !== "actor-vault-app" || !globalThis.ActorVaultLedger) return;
    const root = this.root(element, app);
    if (!root) return;
    this.applyLayout(root);
    this.bindSave(app, root);
    this.bindHousing(app, root);
    this.bindHistory(root);
    this.bindAdminButtons(app, root);
  }
}

globalThis.ActorVaultLedgerUI = ActorVaultLedgerUI;
Hooks.once("ready", async () => {
  game.socket.on(AVLUI_SOCKET, payload => ActorVaultLedgerUI.onSocket(payload));
});
Hooks.on("createUser", () => { if (game.user.isGM) ActorVaultLedger.syncCurrentUsers().catch(console.error); });
Hooks.on("deleteUser", () => { if (game.user.isGM) ActorVaultLedger.syncCurrentUsers().catch(console.error); });
Hooks.on("renderApplicationV2", (app, element) => {
  if (app?.id !== "actor-vault-app") return;
  for (const delay of [0, 75, 200, 500]) setTimeout(() => ActorVaultLedgerUI.enhance(app, element), delay);
});

const AVX_MODULE_ID = "actor-vault";
const AVX_SOCKET = "module.actor-vault-ux";
const AVX_RESOURCE_SCOPE = "world";
const AVX_RESOURCE_KEY = "metaResources";
const AVX_HISTORY_KEY = "metaResourcesHistory";
const AVX_RECORD_PATH = "flags.actor-vault.record";

class ActorVaultUXPatches {
  static pending = new Map();

  static primaryGM() {
    return game.users.filter(u => u.active && u.isGM).sort((a, b) => a.id.localeCompare(b.id))[0] || null;
  }

  static pack() {
    return game.packs.get(game.settings.get(AVX_MODULE_ID, "packId"));
  }

  static record(actor) {
    return foundry.utils.getProperty(actor, AVX_RECORD_PATH) || {};
  }

  static inferOwner(actor) {
    const record = this.record(actor);
    if (record.mainUserId) return record.mainUserId;
    return game.users.filter(u => !u.isGM && actor.testUserPermission(u, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER, { exact: true }))[0]?.id || null;
  }

  static hasClass(actor) {
    return [...(actor.items || [])].some(i => i.type === "class");
  }

  static async request(action, data) {
    if (game.user.isGM) return this.execute(action, data, game.user.id);
    const gm = this.primaryGM();
    if (!gm) throw new Error("An active GM is required to move actors.");
    const requestId = foundry.utils.randomID(20);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("Actor Vault request timed out."));
      }, 30000);
      this.pending.set(requestId, { resolve, reject, timeout });
      game.socket.emit(AVX_SOCKET, { kind: "request", requestId, requesterId: game.user.id, action, data });
    });
  }

  static async onSocket(payload) {
    if (!payload) return;
    if (payload.kind === "response" && payload.targetUserId === game.user.id) {
      const pending = this.pending.get(payload.requestId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(payload.requestId);
      payload.ok ? pending.resolve(payload.result) : pending.reject(new Error(payload.error || "Operation failed."));
      return;
    }
    if (payload.kind !== "request" || !game.user.isGM || game.user.id !== this.primaryGM()?.id) return;
    try {
      const result = await this.execute(payload.action, payload.data, payload.requesterId);
      game.socket.emit(AVX_SOCKET, { kind: "response", requestId: payload.requestId, targetUserId: payload.requesterId, ok: true, result });
    } catch (error) {
      console.error(`${AVX_MODULE_ID} | Player vault action failed`, error);
      game.socket.emit(AVX_SOCKET, { kind: "response", requestId: payload.requestId, targetUserId: payload.requesterId, ok: false, error: error.message });
    }
  }

  static authorize(actor, requesterId) {
    const requester = game.users.get(requesterId);
    const ownerId = this.inferOwner(actor);
    if (!requester) throw new Error("Requesting user not found.");
    if (!requester.isGM && ownerId !== requester.id) throw new Error("You may only move your own actors.");
    return ownerId;
  }

  static ownership(ownerId) {
    return { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED, [ownerId]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER };
  }

  static async ensurePackFolders(pack, owner) {
    let root = pack.folders.find(f => f.name === "Players" && !f.folder);
    if (!root) root = await Folder.create({ name: "Players", type: "Actor", folder: null }, { pack: pack.collection });
    let folder = pack.folders.find(f => f.name === owner.name && (f.folder?.id || f.folder) === root.id);
    if (!folder) folder = await Folder.create({ name: owner.name, type: "Actor", folder: root.id }, { pack: pack.collection });
    return folder;
  }

  static async removeLinkedTokens(actorId) {
    let removed = 0;
    for (const scene of game.scenes) {
      const ids = [...scene.tokens].filter(t => t.actorLink && t.actorId === actorId).map(t => t.id);
      if (ids.length) {
        await scene.deleteEmbeddedDocuments("Token", ids);
        removed += ids.length;
      }
    }
    return removed;
  }

  static async execute(action, data, requesterId) {
    if (action === "archive") return this.archive(data.actorId, requesterId);
    if (action === "activate") return this.activate(data.packActorId, requesterId);
    throw new Error("Unknown Actor Vault action.");
  }

  static async archive(actorId, requesterId) {
    const actor = game.actors.get(actorId);
    if (!actor) throw new Error("Actor not found.");
    const ownerId = this.authorize(actor, requesterId);
    const owner = game.users.get(ownerId);
    if (!owner || owner.isGM) throw new Error("This actor does not have a valid player owner.");
    const pack = this.pack();
    if (!pack) throw new Error("Actor Vault compendium not found.");

    const old = this.record(actor);
    const record = {
      ...old,
      vaultId: old.vaultId || foundry.utils.randomID(24),
      mainUserId: ownerId,
      originalFolderId: actor.folder?.id || old.originalFolderId || null,
      originalFolderName: actor.folder?.name || old.originalFolderName || null,
      updatedAt: Date.now()
    };
    const index = await pack.getIndex({ fields: ["flags.actor-vault.record.vaultId"] });
    if (index.some(e => foundry.utils.getProperty(e, "flags.actor-vault.record.vaultId") === record.vaultId)) throw new Error("A stored copy already exists.");

    const folder = await this.ensurePackFolders(pack, owner);
    const data = actor.toObject();
    delete data._id;
    data.folder = folder.id;
    data.ownership = this.ownership(ownerId);
    foundry.utils.setProperty(data, AVX_RECORD_PATH, record);
    const [stored] = await Actor.implementation.createDocuments([data], { pack: pack.collection, keepId: false });
    if (!stored) throw new Error("Could not create the vault copy.");

    try {
      const removed = await this.removeLinkedTokens(actor.id);
      for (const combat of game.combats) {
        const ids = [...combat.combatants].filter(c => c.actorId === actor.id).map(c => c.id);
        if (ids.length) await combat.deleteEmbeddedDocuments("Combatant", ids);
      }
      if (owner.character?.id === actor.id) await owner.update({ character: null });
      await actor.delete();
      return { message: `${actor.name} archived.${removed ? ` Removed ${removed} linked scene token${removed === 1 ? "" : "s"}.` : ""}` };
    } catch (error) {
      await stored.delete();
      throw new Error(`Archive was rolled back: ${error.message}`);
    }
  }

  static async activate(packActorId, requesterId) {
    const pack = this.pack();
    if (!pack) throw new Error("Actor Vault compendium not found.");
    const stored = await pack.getDocument(packActorId);
    if (!stored) throw new Error("Stored actor not found.");
    const ownerId = this.authorize(stored, requesterId);
    const owner = game.users.get(ownerId);
    const record = this.record(stored);
    if (!record.vaultId) throw new Error("Stored actor is missing vault metadata.");
    if (game.actors.some(a => this.record(a).vaultId === record.vaultId)) throw new Error("This actor is already active.");

    const original = record.originalFolderId && game.folders.get(record.originalFolderId);
    const data = stored.toObject();
    delete data._id;
    data.folder = original?.type === "Actor" ? original.id : null;
    data.ownership = this.ownership(ownerId);
    foundry.utils.setProperty(data, AVX_RECORD_PATH, { ...record, mainUserId: ownerId, updatedAt: Date.now() });
    const [actor] = await Actor.implementation.createDocuments([data], { keepId: false });
    if (!actor) throw new Error("Could not create the world actor.");
    try {
      await stored.delete();
      if (!owner.character) await owner.update({ character: actor.id });
      return { message: `${actor.name} activated.` };
    } catch (error) {
      await actor.delete();
      throw new Error(`Activation was rolled back: ${error.message}`);
    }
  }

  static async resolveRowActor(row) {
    if (row.dataset.actorId) return game.actors.get(row.dataset.actorId);
    const pack = this.pack();
    return row.dataset.packId && pack ? pack.getDocument(row.dataset.packId) : null;
  }

  static housingName(tier) {
    return ["None", "Homestead", "House", "Manor", "Estate"][Math.max(0, Math.min(4, Number(tier) || 0))];
  }

  static async openHistory(userId) {
    const users = game.user.isGM ? game.users.filter(u => !u.isGM) : [game.user];
    const selected = users.find(u => u.id === userId) || users[0];
    const options = users.map(u => `<option value="${u.id}" ${u.id === selected.id ? "selected" : ""}>${foundry.utils.escapeHTML(u.name)}</option>`).join("");
    const content = `<div class="avx-history"><label>Player <select data-avx-history-user ${game.user.isGM ? "" : "disabled"}>${options}</select></label><div data-avx-history-log></div></div>`;
    const dialog = new foundry.applications.api.DialogV2({ window: { title: "Resource History", resizable: true }, position: { width: 900, height: 650 }, content, buttons: [{ action: "close", label: "Close", default: true }] });
    await dialog.render({ force: true });
    const select = dialog.element.querySelector("[data-avx-history-user]");
    const log = dialog.element.querySelector("[data-avx-history-log]");
    const draw = () => {
      const user = game.users.get(select.value);
      const history = user?.getFlag(AVX_RESOURCE_SCOPE, AVX_HISTORY_KEY) || [];
      if (!history.length) return log.innerHTML = "<p>No resource history recorded.</p>";
      log.innerHTML = `<table><thead><tr><th>Date</th><th>Editor</th><th>Housing</th><th>Gold</th><th>Credits</th><th>XP</th><th>Storage</th></tr></thead><tbody>${history.map(e => { const s = e.state || {}; return `<tr><td>${new Date(e.timestamp).toLocaleString()}</td><td>${foundry.utils.escapeHTML(game.users.get(e.editorUserId)?.name || "Unknown")}</td><td>${this.housingName(s.housingTier)}</td><td>${s.gold ?? 0}</td><td>${s.credits ?? 0}</td><td>${s.xp ?? 0}</td><td>${foundry.utils.escapeHTML((s.storage || []).filter(Boolean).join(", ") || "—")}</td></tr>`; }).join("")}</tbody></table>`;
    };
    select.addEventListener("change", draw);
    draw();
  }

  static async enhance(app, element) {
    const root = element instanceof HTMLElement ? element : element?.[0] || app?.element;
    if (!root) return;

    // Keep exactly one history button and allow players to view their own history.
    root.querySelectorAll("[data-avp-history], .actor-vault-history-open, [data-avx-history]").forEach(b => b.remove());
    const toolbar = root.querySelector(".actor-vault__toolbar");
    if (toolbar) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.avxHistory = "true";
      button.innerHTML = '<i class="fas fa-clock-rotate-left"></i> Resource History';
      button.addEventListener("click", () => this.openHistory(root.querySelector("form[data-resource-form]")?.dataset.userId || game.user.id));
      toolbar.append(button);
    }

    // Housing selector for both players and GMs if the progression script failed to add it.
    const form = root.querySelector("form[data-resource-form]");
    if (form && !form.querySelector("[data-avx-housing]") && !form.querySelector("[data-avp-housing]")) {
      const user = game.users.get(form.dataset.userId);
      const resources = user?.getFlag(AVX_RESOURCE_SCOPE, AVX_RESOURCE_KEY) || {};
      const label = document.createElement("label");
      label.dataset.avxHousing = "true";
      label.innerHTML = `<span>Housing Tier</span><select>${[0,1,2,3,4].map(n => `<option value="${n}" ${Number(resources.housingTier || 0) === n ? "selected" : ""}>${this.housingName(n)}</option>`).join("")}</select>`;
      form.querySelector(".actor-vault__resource-grid")?.append(label);
      label.querySelector("select").addEventListener("change", async e => {
        const current = user.getFlag(AVX_RESOURCE_SCOPE, AVX_RESOURCE_KEY) || {};
        await user.setFlag(AVX_RESOURCE_SCOPE, AVX_RESOURCE_KEY, { ...current, housingTier: Number(e.target.value) });
        app.render({ force: true });
      });
    }

    for (const row of root.querySelectorAll("[data-actor-id], [data-pack-id]")) {
      const actor = await this.resolveRowActor(row);
      if (!actor) continue;
      const classed = this.hasClass(actor);
      if (!classed) {
        row.querySelectorAll("[data-avp-progression], [data-avs-sync]").forEach(e => e.remove());
        continue;
      }
      const ownerId = this.inferOwner(actor);
      if (!game.user.isGM && ownerId !== game.user.id) continue;

      // Ensure player Worldbreaker control exists, including older actors without vault metadata.
      if (!row.querySelector("[data-avp-progression]")) {
        const record = this.record(actor);
        const tier = Math.max(0, Math.min(3, Number(record.worldbreakerTier) || 0));
        const block = document.createElement("label");
        block.className = "avp-progression";
        block.dataset.avpProgression = "true";
        block.innerHTML = `<span>Worldbreaker</span><select>${[0,1,2,3].map(n => `<option value="${n}" ${n === tier ? "selected" : ""}>${n ? `Worldbreaker ${n}` : "None"}</option>`).join("")}</select>`;
        row.insertBefore(block, row.querySelector('button[data-action="archive"], button[data-action="activate"]'));
        block.querySelector("select").addEventListener("change", async e => {
          const next = { ...this.record(actor), mainUserId: ownerId, worldbreakerTier: Number(e.target.value), updatedAt: Date.now() };
          if (!game.user.isGM) {
            const result = await this.request("worldbreaker", { actorId: row.dataset.actorId, packActorId: row.dataset.packId, tier: Number(e.target.value) }).catch(() => null);
            if (!result) await actor.update({ [AVX_RECORD_PATH]: next });
          } else await actor.update({ [AVX_RECORD_PATH]: next });
          app.render({ force: true });
        });
      }

      // Remove the visual cap and expose the reason for red status.
      row.querySelectorAll(".avp-skill-points").forEach(e => e.innerHTML = e.innerHTML.replace(/\s*\/\s*19/g, ""));
      const sync = row.querySelector("[data-avs-sync]");
      if (sync?.classList.contains("avs-skill-sync--error")) {
        let reason = row.querySelector(".avx-skill-reason");
        if (!reason) {
          reason = document.createElement("small");
          reason.className = "avx-skill-reason";
          sync.insertAdjacentElement("afterend", reason);
        }
        reason.textContent = sync.title || "Skill point data needs GM review.";
      }
    }

    // Replace archive/activate handlers so player requests are executed by the active GM.
    for (const button of root.querySelectorAll('button[data-action="archive"], button[data-action="activate"]')) {
      if (button.dataset.avxBound) continue;
      button.dataset.avxBound = "true";
      button.addEventListener("click", async event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        button.disabled = true;
        try {
          const action = button.dataset.action;
          const result = await this.request(action, action === "archive" ? { actorId: button.dataset.id } : { packActorId: button.dataset.id });
          ui.notifications.info(result.message);
          await app.render({ force: true });
        } catch (error) {
          ui.notifications.error(error.message);
          button.disabled = false;
        }
      }, true);
    }
  }
}

Hooks.once("ready", () => game.socket.on(AVX_SOCKET, p => ActorVaultUXPatches.onSocket(p)));
Hooks.on("renderActorVaultApp", (app, element) => ActorVaultUXPatches.enhance(app, element));
Hooks.on("renderApplicationV2", (app, element) => {
  if (app?.id === "actor-vault-app") ActorVaultUXPatches.enhance(app, element);
});

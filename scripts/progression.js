const AVP_MODULE_ID = "actor-vault";
const AVP_SOCKET = "module.actor-vault-progression";
const AVP_RESOURCE_SCOPE = "world";
const AVP_RESOURCE_KEY = "metaResources";
const AVP_HISTORY_KEY = "metaResourcesHistory";
const AVP_RECORD_PATH = "flags.actor-vault.record";

class ActorVaultProgression {
  static pending = new Map();

  static clamp(value, min, max) {
    return Math.min(max, Math.max(min, Math.trunc(Number(value) || 0)));
  }

  static housingName(tier) {
    return ["None", "Homestead", "House", "Manor", "Estate"][this.clamp(tier, 0, 4)];
  }

  static protectionSlots(tier) {
    return Math.max(0, this.clamp(tier, 0, 4) - 1);
  }

  static normalizeResources(stored) {
    const source = stored && typeof stored === "object" ? stored : {};
    const storage = Array.isArray(source.storage) ? source.storage : [];
    return {
      ...source,
      gold: Number(source.gold) || 0,
      credits: Number(source.credits) || 0,
      xp: Number(source.xp) || 0,
      housingTier: this.clamp(source.housingTier, 0, 4),
      storage: [...storage, "", "", "", ""].slice(0, 4).map(value => String(value ?? ""))
    };
  }

  static actorLevel(actor) {
    return Math.max(0, Math.trunc((actor.items || [])
      .filter(item => item.type === "class")
      .reduce((total, item) => total + (Number(item.system?.levels ?? item.system?.level ?? 0) || 0), 0)));
  }

  static skillPoints(level, housing, worldbreaker) {
    return Math.min(this.clamp(level, 0, 999), 12)
      + this.clamp(housing, 0, 4)
      + this.clamp(worldbreaker, 0, 3);
  }

  static primaryGM() {
    return game.users
      .filter(user => user.active && user.isGM)
      .sort((a, b) => a.id.localeCompare(b.id))[0] || null;
  }

  static async request(action, data) {
    if (game.user.isGM) return this.execute(action, data, game.user.id);
    if (!this.primaryGM()) throw new Error("An active GM is required.");

    const requestId = foundry.utils.randomID(20);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("Progression request timed out."));
      }, 20000);

      this.pending.set(requestId, { resolve, reject, timeout });
      game.socket.emit(AVP_SOCKET, {
        kind: "request",
        requestId,
        requesterId: game.user.id,
        action,
        data
      });
    });
  }

  static async onSocket(payload) {
    if (!payload || typeof payload !== "object") return;

    if (payload.kind === "response" && payload.targetUserId === game.user.id) {
      const pending = this.pending.get(payload.requestId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(payload.requestId);
      if (payload.ok) pending.resolve(payload.result);
      else pending.reject(new Error(payload.error || "Progression update failed."));
      return;
    }

    if (payload.kind !== "request") return;
    if (!game.user.isGM || game.user.id !== this.primaryGM()?.id) return;

    let response;
    try {
      response = { ok: true, result: await this.execute(payload.action, payload.data, payload.requesterId) };
    } catch (error) {
      console.error(`${AVP_MODULE_ID} | Progression request failed`, error);
      response = { ok: false, error: error.message };
    }

    game.socket.emit(AVP_SOCKET, {
      kind: "response",
      requestId: payload.requestId,
      targetUserId: payload.requesterId,
      ...response
    });
  }

  static async execute(action, data, requesterId) {
    if (action === "housing") return this.saveHousing(data.userId, data.tier, requesterId);
    if (action === "worldbreaker") {
      return this.saveWorldbreaker(data.actorId, data.packActorId, data.tier, requesterId);
    }
    throw new Error(`Unknown progression action: ${action}`);
  }

  static async saveHousing(userId, tier, requesterId) {
    const requester = game.users.get(requesterId);
    const user = game.users.get(userId);
    if (!requester || !user || user.isGM) throw new Error("Player not found.");
    if (!requester.isGM && requester.id !== user.id) {
      throw new Error("You may only change your own housing tier.");
    }

    const previous = this.normalizeResources(user.getFlag(AVP_RESOURCE_SCOPE, AVP_RESOURCE_KEY));
    const next = { ...previous, housingTier: this.clamp(tier, 0, 4) };
    await user.setFlag(AVP_RESOURCE_SCOPE, AVP_RESOURCE_KEY, next);

    const oldHistory = user.getFlag(AVP_RESOURCE_SCOPE, AVP_HISTORY_KEY);
    const history = Array.isArray(oldHistory) ? [...oldHistory] : [];
    history.unshift({
      timestamp: Date.now(),
      editorUserId: requester.id,
      previous: foundry.utils.deepClone(previous),
      state: foundry.utils.deepClone(next)
    });
    await user.setFlag(AVP_RESOURCE_SCOPE, AVP_HISTORY_KEY, history.slice(0, 30));

    return {
      message: `${user.name}'s housing is now ${this.housingName(next.housingTier)}.`
    };
  }

  static authorizeRecord(record, requesterId) {
    const requester = game.users.get(requesterId);
    if (!requester) throw new Error("Requesting user not found.");
    if (!requester.isGM && record?.mainUserId !== requester.id) {
      throw new Error("You may only change Worldbreaker status for your own actors.");
    }
  }

  static async saveWorldbreaker(actorId, packActorId, tier, requesterId) {
    const nextTier = this.clamp(tier, 0, 3);

    if (actorId) {
      const actor = game.actors.get(actorId);
      if (!actor) throw new Error("Actor not found.");
      const record = foundry.utils.deepClone(foundry.utils.getProperty(actor, AVP_RECORD_PATH) || {});
      this.authorizeRecord(record, requesterId);
      record.worldbreakerTier = nextTier;
      record.level = this.actorLevel(actor);
      record.updatedAt = Date.now();
      await actor.update({ [AVP_RECORD_PATH]: record });
      return { message: `${actor.name}'s Worldbreaker tier was updated.` };
    }

    if (packActorId) {
      const packId = game.settings.get(AVP_MODULE_ID, "packId");
      const pack = game.packs.get(packId);
      if (!pack) throw new Error("Actor Vault compendium not found.");
      const actor = await pack.getDocument(packActorId);
      if (!actor) throw new Error("Stored actor not found.");
      const record = foundry.utils.deepClone(foundry.utils.getProperty(actor, AVP_RECORD_PATH) || {});
      this.authorizeRecord(record, requesterId);
      record.worldbreakerTier = nextTier;
      record.level = this.actorLevel(actor) || record.level || 0;
      record.updatedAt = Date.now();
      await actor.update({ [AVP_RECORD_PATH]: record });
      return { message: `${actor.name}'s Worldbreaker tier was updated.` };
    }

    throw new Error("No actor was supplied.");
  }

  static getRoot(element) {
    if (element instanceof HTMLElement) return element;
    return element?.[0] || null;
  }

  static housingOptions(selected) {
    return [0, 1, 2, 3, 4]
      .map(value => `<option value="${value}" ${value === selected ? "selected" : ""}>${this.housingName(value)}</option>`)
      .join("");
  }

  static worldbreakerOptions(selected) {
    return [0, 1, 2, 3]
      .map(value => `<option value="${value}" ${value === selected ? "selected" : ""}>${value ? `Worldbreaker ${value}` : "None"}</option>`)
      .join("");
  }

  static enhanceResourceForm(app, root) {
    const form = root.querySelector("form[data-resource-form]");
    if (!form || form.querySelector("[data-avp-housing]")) return;

    const userId = form.dataset.userId;
    const user = game.users.get(userId);
    if (!user) return;
    const resources = this.normalizeResources(user.getFlag(AVP_RESOURCE_SCOPE, AVP_RESOURCE_KEY));
    const slots = this.protectionSlots(resources.housingTier);

    const grid = form.querySelector(".actor-vault__resource-grid");
    const label = document.createElement("label");
    label.dataset.avpHousing = "true";
    label.innerHTML = `<span>Housing Tier</span><select>${this.housingOptions(resources.housingTier)}</select>`;
    grid?.append(label);

    const summary = document.createElement("div");
    summary.className = "avp-housing-summary";
    summary.innerHTML = `<strong>${this.housingName(resources.housingTier)}</strong><span>+${resources.housingTier} skill points per character</span><span>${slots} protected item slots</span>`;
    grid?.after(summary);

    const select = label.querySelector("select");
    select.addEventListener("change", async event => {
      event.currentTarget.disabled = true;
      try {
        const result = await this.request("housing", { userId, tier: Number(event.currentTarget.value) });
        ui.notifications.info(result.message);
        await app.render({ force: true });
      } catch (error) {
        ui.notifications.error(error.message);
        event.currentTarget.disabled = false;
      }
    });

    const storageInputs = [...form.querySelectorAll('input[name^="s"]')];
    storageInputs.forEach((input, index) => {
      const field = input.closest("label") || input.parentElement;
      if (index >= 3) {
        field.style.display = "none";
        return;
      }
      const unlocked = index < slots;
      input.disabled = !unlocked;
      field.classList.toggle("avp-slot-locked", !unlocked);
      const caption = field.querySelector("span");
      if (caption) caption.textContent = `Protected Slot ${index + 1}${unlocked ? "" : " (Locked)"}`;
    });
  }

  static async enhanceActorRows(app, root) {
    const packId = game.settings.get(AVP_MODULE_ID, "packId");
    const pack = game.packs.get(packId);
    const rows = [...root.querySelectorAll("[data-actor-id], [data-pack-id]")];

    for (const row of rows) {
      if (row.querySelector("[data-avp-progression]")) continue;
      const actorId = row.dataset.actorId || null;
      const packActorId = row.dataset.packId || null;
      const actor = actorId ? game.actors.get(actorId) : (pack && packActorId ? await pack.getDocument(packActorId) : null);
      if (!actor) continue;

      const record = foundry.utils.getProperty(actor, AVP_RECORD_PATH) || {};
      const ownerId = record.mainUserId || "";
      if (!game.user.isGM && ownerId !== game.user.id) continue;
      const owner = game.users.get(ownerId);
      const resources = this.normalizeResources(owner?.getFlag(AVP_RESOURCE_SCOPE, AVP_RESOURCE_KEY));
      const level = this.actorLevel(actor) || Number(record.level) || 0;
      const worldbreaker = this.clamp(record.worldbreakerTier, 0, 3);
      const points = this.skillPoints(level, resources.housingTier, worldbreaker);

      const block = document.createElement("label");
      block.className = "avp-progression";
      block.dataset.avpProgression = "true";
      block.innerHTML = `
        <span class="avp-skill-points">Skill Points: <strong>${points}</strong> / 19</span>
        <span class="avp-breakdown">Level ${Math.min(level, 12)} + Housing ${resources.housingTier} + WB ${worldbreaker}</span>
        <select>${this.worldbreakerOptions(worldbreaker)}</select>
      `;

      const actionButton = row.querySelector('button[data-action="archive"], button[data-action="activate"]');
      row.insertBefore(block, actionButton || null);

      block.querySelector("select").addEventListener("change", async event => {
        event.currentTarget.disabled = true;
        try {
          const result = await this.request("worldbreaker", {
            actorId,
            packActorId,
            tier: Number(event.currentTarget.value)
          });
          ui.notifications.info(result.message);
          await app.render({ force: true });
        } catch (error) {
          ui.notifications.error(error.message);
          event.currentTarget.disabled = false;
        }
      });
    }
  }

  static addHistoryButton(root) {
    if (!game.user.isGM || root.querySelector("[data-avp-history]")) return;
    const toolbar = root.querySelector(".actor-vault__toolbar");
    if (!toolbar) return;
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.avpHistory = "true";
    button.innerHTML = '<i class="fas fa-clock-rotate-left"></i> Resource History';
    button.addEventListener("click", () => this.openHistory());
    toolbar.append(button);
  }

  static async enhance(app, element) {
    const root = this.getRoot(element) || app?.element;
    if (!root || root.dataset.avpEnhanced === "working") return;
    root.dataset.avpEnhanced = "working";
    try {
      this.enhanceResourceForm(app, root);
      await this.enhanceActorRows(app, root);
      this.addHistoryButton(root);
    } finally {
      root.dataset.avpEnhanced = "done";
    }
  }

  static async openHistory() {
    const players = game.users.filter(user => !user.isGM).sort((a, b) => a.name.localeCompare(b.name));
    if (!players.length) return ui.notifications.warn("No player users found.");

    const content = `
      <div class="avp-history-dialog">
        <label>Player <select data-avp-history-user>${players.map((user, index) => `<option value="${user.id}" ${index === 0 ? "selected" : ""}>${foundry.utils.escapeHTML(user.name)}</option>`).join("")}</select></label>
        <div data-avp-history-log></div>
      </div>`;

    const dialog = new foundry.applications.api.DialogV2({
      window: { title: "Resource Change Log", resizable: true },
      position: { width: 900, height: 700 },
      content,
      buttons: [{ action: "close", label: "Close", default: true }]
    });

    await dialog.render({ force: true });
    const root = dialog.element;
    const select = root.querySelector("[data-avp-history-user]");
    const log = root.querySelector("[data-avp-history-log]");

    const renderLog = () => {
      const user = game.users.get(select.value);
      const history = user?.getFlag(AVP_RESOURCE_SCOPE, AVP_HISTORY_KEY) || [];
      if (!history.length) {
        log.innerHTML = '<p class="avp-history-empty">No history logged for this player.</p>';
        return;
      }
      log.innerHTML = `<table><thead><tr><th>Date</th><th>Editor</th><th>Housing</th><th>Gold</th><th>Credits</th><th>XP</th><th>Protected Items</th></tr></thead><tbody>${history.map(entry => {
        const state = this.normalizeResources(entry.state);
        return `<tr><td>${new Date(entry.timestamp).toLocaleString()}</td><td>${foundry.utils.escapeHTML(game.users.get(entry.editorUserId)?.name || "Unknown")}</td><td>${this.housingName(state.housingTier)}</td><td>${state.gold}</td><td>${state.credits}</td><td>${state.xp}</td><td>${state.storage.slice(0, 3).map(value => foundry.utils.escapeHTML(value.trim() || "—")).join(", ")}</td></tr>`;
      }).join("")}</tbody></table>`;
    };

    select.addEventListener("change", renderLog);
    renderLog();
  }
}

Hooks.once("ready", () => {
  game.socket.on(AVP_SOCKET, payload => ActorVaultProgression.onSocket(payload));
});

Hooks.on("renderActorVaultApp", (app, element) => ActorVaultProgression.enhance(app, element));
Hooks.on("renderApplicationV2", (app, element) => {
  if (app?.constructor?.name === "ActorVaultApp") ActorVaultProgression.enhance(app, element);
});

const AVPA_MODULE_ID = "actor-vault";
const AVPA_SOCKET = `module.${AVPA_MODULE_ID}-player-access`;
const AVPA_LONG_REST_PATH = "flags.actor-vault.longRest";

class ActorVaultPlayerAccess {
  static pending = new Map();

  static primaryGM() {
    return game.users
      .filter(user => user.active && user.isGM)
      .sort((a, b) => a.id.localeCompare(b.id))[0] || null;
  }

  static playersFolder() {
    return game.folders.find(folder =>
      folder.type === "Actor" && folder.name.trim().toLowerCase() === "players"
    ) || null;
  }

  static managedFolderIds() {
    const root = this.playersFolder();
    if (!root) return new Set();
    return new Set([root.id, ...root.getSubfolders(true).map(folder => folder.id)]);
  }

  static managedActors() {
    const ids = this.managedFolderIds();
    if (!ids.size) return [];
    return game.actors.filter(actor => actor.folder && ids.has(actor.folder.id));
  }

  static async grantActorAccess(actor) {
    if (!game.user.isGM || !actor) return;
    const ownership = foundry.utils.deepClone(actor.ownership || {});
    if (ownership.default === CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER) return;
    ownership.default = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
    await actor.update({ ownership });
  }

  static async grantAllActorAccess() {
    if (!game.user.isGM) return;
    for (const actor of this.managedActors()) {
      await this.grantActorAccess(actor);
    }
  }

  static ownerId(actor) {
    const recorded = foundry.utils.getProperty(actor, "flags.actor-vault.record.mainUserId");
    if (recorded && game.users.get(recorded)) return recorded;
    return game.users
      .filter(user => !user.isGM && actor.testUserPermission?.(
        user,
        CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER,
        { exact: true }
      ))
      .sort((a, b) => a.name.localeCompare(b.name))[0]?.id || null;
  }

  static clampRestCost(value, quickRecovery = false) {
    const minimum = quickRecovery ? 0 : 1;
    return Math.max(minimum, Math.min(4, Math.trunc(Number(value) || 0)));
  }

  static restState(actor) {
    const stored = foundry.utils.getProperty(actor, AVPA_LONG_REST_PATH) || {};
    const quickRecovery = Boolean(stored.quickRecovery);
    return {
      cost: Number.isFinite(Number(stored.cost)) ? this.clampRestCost(stored.cost, quickRecovery) : 1,
      quickRecovery
    };
  }

  static async request(action, data = {}) {
    if (game.user.isGM) return this.execute(action, data, game.user.id);
    const gm = this.primaryGM();
    if (!gm) throw new Error("Actor Vault requires an active GM for shared-data updates.");
    const requestId = foundry.utils.randomID(20);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("Actor Vault request timed out."));
      }, 20000);
      this.pending.set(requestId, { resolve, reject, timeout });
      game.socket.emit(AVPA_SOCKET, {
        kind: "request",
        requestId,
        action,
        data,
        requesterId: game.user.id
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
      else pending.reject(new Error(payload.error || "Actor Vault operation failed."));
      return;
    }

    if (payload.kind !== "request") return;
    if (!game.user.isGM || game.user.id !== this.primaryGM()?.id) return;

    let response;
    try {
      response = { ok: true, result: await this.execute(payload.action, payload.data, payload.requesterId) };
    } catch (error) {
      console.error("actor-vault | Player access request failed", error);
      response = { ok: false, error: error.message };
    }

    game.socket.emit(AVPA_SOCKET, {
      kind: "response",
      requestId: payload.requestId,
      targetUserId: payload.requesterId,
      ...response
    });
  }

  static async execute(action, data, requesterId) {
    if (!game.user.isGM) throw new Error("Shared Actor Vault writes must execute through the GM proxy.");
    if (!globalThis.ActorVaultLedger) throw new Error("Persistent Resource Ledger is unavailable.");

    if (action === "saveResources") {
      const user = game.users.get(data.userId);
      if (!user) throw new Error("Player not found.");
      const resources = data.resources && typeof data.resources === "object" ? data.resources : {};
      const previous = ActorVaultLedger.getResources(user.id);
      const next = ActorVaultLedger.normalizeResources({ ...previous, ...resources });
      await ActorVaultLedger.transact(user.id, {
        type: "resource",
        action: "Dashboard resources updated",
        set: next,
        editorUserId: requesterId,
        metadata: { source: "player-access" }
      });
      return { message: `${user.name}'s dashboard was saved.` };
    }

    if (["longRest", "noLongRest", "quickRecovery"].includes(action)) {
      const actor = game.actors.get(data.actorId);
      if (!actor) throw new Error("Actor not found.");
      const ownerId = this.ownerId(actor);
      const owner = game.users.get(ownerId);
      if (!owner) throw new Error("Character owner not found.");
      const previousRest = this.restState(actor);
      let nextRest = foundry.utils.deepClone(previousRest);
      let creditDelta = 0;
      let label = "";

      if (action === "quickRecovery") {
        const enabled = Boolean(data.enabled);
        if (previousRest.quickRecovery === enabled) return { message: `${actor.name}: Quick Recovery unchanged.` };
        nextRest = {
          quickRecovery: enabled,
          cost: this.clampRestCost(previousRest.cost + (enabled ? -1 : 1), enabled)
        };
        label = `Quick Recovery ${enabled ? "enabled" : "disabled"} for ${actor.name} (${previousRest.cost} to ${nextRest.cost})`;
      }

      if (action === "longRest") {
        const resources = ActorVaultLedger.getResources(owner.id);
        const paid = previousRest.cost;
        if (resources.credits < paid) {
          throw new Error(`${actor.name} needs ${paid} Server Credit${paid === 1 ? "" : "s"}.`);
        }
        nextRest = {
          ...previousRest,
          cost: this.clampRestCost(previousRest.cost + 1, previousRest.quickRecovery)
        };
        creditDelta = -paid;
        label = `${actor.name} Long Rest (${paid} credit${paid === 1 ? "" : "s"} paid)`;
      }

      if (action === "noLongRest") {
        nextRest = {
          ...previousRest,
          cost: this.clampRestCost(previousRest.cost - 1, previousRest.quickRecovery)
        };
        label = `${actor.name} Did Not Long Rest (${previousRest.cost} to ${nextRest.cost})`;
      }

      await actor.update({ [AVPA_LONG_REST_PATH]: nextRest });
      try {
        await ActorVaultLedger.transact(owner.id, {
          type: "long-rest",
          action: label,
          delta: { credits: creditDelta },
          editorUserId: requesterId,
          actorId: actor.id,
          actorName: actor.name,
          previousLongRest: previousRest,
          longRest: nextRest,
          metadata: { previousRest, nextRest, source: "player-access" }
        });
      } catch (error) {
        await actor.update({ [AVPA_LONG_REST_PATH]: previousRest }).catch(() => {});
        throw error;
      }

      return { message: action === "longRest" ? `${actor.name} completed a long rest.` : `${actor.name}: long-rest settings updated.` };
    }

    throw new Error(`Unknown player-access action: ${action}`);
  }

  static bindResourceSave(app, root) {
    if (game.user.isGM) return;
    const form = root.querySelector("form[data-resource-form]");
    const oldButton = form?.querySelector('button[data-action="save-resources"]');
    if (!form || !oldButton || oldButton.dataset.avpaBound === "true") return;

    const button = oldButton.cloneNode(true);
    button.dataset.avpaBound = "true";
    button.disabled = false;
    oldButton.replaceWith(button);

    for (const name of ["gold", "credits", "xp"]) {
      if (form.elements[name]) form.elements[name].disabled = false;
    }

    button.addEventListener("click", async event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      button.disabled = true;
      try {
        const storage = [0, 1, 2, 3].map(index => String(form.elements[`s${index}`]?.value ?? "").trim());
        const result = await this.request("saveResources", {
          userId: form.dataset.userId,
          resources: {
            gold: Number(form.elements.gold?.value ?? 0),
            credits: Number(form.elements.credits?.value ?? 0),
            xp: Number(form.elements.xp?.value ?? 0),
            storage
          }
        });
        ui.notifications.info(result.message);
        await app.render({ force: true });
      } catch (error) {
        ui.notifications.error(error.message);
        button.disabled = false;
      }
    }, true);
  }

  static bindRestControls(app, root) {
    if (game.user.isGM) return;
    for (const row of root.querySelectorAll("[data-actor-id]")) {
      const actor = game.actors.get(row.dataset.actorId);
      const slot = row.querySelector("[data-character-rest]");
      if (!actor || !slot) continue;
      const rest = this.restState(actor);
      const minimum = rest.quickRecovery ? 0 : 1;
      slot.innerHTML = `<div class="avlr2-summary">
        <strong>Long Rest Cost: ${rest.cost}</strong>
        <label><input type="checkbox" data-avpa-quick ${rest.quickRecovery ? "checked" : ""}> Quick Recovery</label>
      </div>
      <div class="avlr2-actions">
        <button type="button" data-avpa-rest><i class="fas fa-bed"></i> Long Rest (${rest.cost})</button>
        <button type="button" data-avpa-no-rest ${rest.cost <= minimum ? "disabled" : ""}><i class="fas fa-arrow-down"></i> Did Not Long Rest</button>
      </div>`;

      const disable = () => slot.querySelectorAll("button,input").forEach(control => control.disabled = true);
      const run = async (action, data = {}) => {
        disable();
        try {
          const result = await this.request(action, { actorId: actor.id, ...data });
          ui.notifications.info(result.message);
        } catch (error) {
          ui.notifications.error(error.message);
        }
        await app.render({ force: true });
      };

      slot.querySelector("[data-avpa-quick]")?.addEventListener("change", event => run("quickRecovery", { enabled: event.currentTarget.checked }));
      slot.querySelector("[data-avpa-rest]")?.addEventListener("click", event => { event.preventDefault(); run("longRest"); });
      slot.querySelector("[data-avpa-no-rest]")?.addEventListener("click", event => { event.preventDefault(); run("noLongRest"); });
    }
  }

  static unlockPlayerTools(root) {
    if (game.user.isGM) return;
    for (const selector of [
      "[data-avms-open]",
      "[data-avms-reward]",
      "[data-avms-study]",
      "[data-history-button]"
    ]) {
      root.querySelectorAll(selector).forEach(control => {
        control.disabled = false;
        control.removeAttribute("aria-disabled");
      });
    }
  }

  static enhance(app, element) {
    if (app?.id !== "actor-vault-app") return;
    const root = element instanceof HTMLElement ? element : element?.[0] || app?.element;
    if (!root) return;
    this.bindResourceSave(app, root);
    this.bindRestControls(app, root);
    this.unlockPlayerTools(root);
  }
}

globalThis.ActorVaultPlayerAccess = ActorVaultPlayerAccess;

Hooks.once("ready", async () => {
  game.socket.on(AVPA_SOCKET, payload => ActorVaultPlayerAccess.onSocket(payload));

  if (globalThis.ActorVaultMetaShop) {
    ActorVaultMetaShop.auth = function(userId, requesterId) {
      const requester = game.users.get(requesterId);
      const target = game.users.get(userId);
      if (!requester || !target) throw new Error("Player not found.");
      return { requester, target };
    };
  }

  await ActorVaultPlayerAccess.grantAllActorAccess();
});

Hooks.on("createActor", actor => {
  if (!game.user.isGM) return;
  const ids = ActorVaultPlayerAccess.managedFolderIds();
  if (actor.folder && ids.has(actor.folder.id)) {
    ActorVaultPlayerAccess.grantActorAccess(actor).catch(error => console.error("actor-vault | Could not grant player access", error));
  }
});

Hooks.on("renderApplicationV2", (app, element) => {
  if (app?.id !== "actor-vault-app") return;
  for (const delay of [700, 900, 1200]) {
    setTimeout(() => ActorVaultPlayerAccess.enhance(app, element), delay);
  }
});

const AVH_SOCKET = "module.actor-vault-worldbreaker";
const AVH_RECORD_PATH = "flags.actor-vault.record";

class ActorVaultWorldbreakerHotfix {
  static pending = new Map();
  static primaryGM() { return game.users.filter(u => u.active && u.isGM).sort((a,b) => a.id.localeCompare(b.id))[0] || null; }
  static pack() { return game.packs.get(game.settings.get("actor-vault", "packId")); }
  static ownerId(actor) {
    const record = foundry.utils.getProperty(actor, AVH_RECORD_PATH) || {};
    return record.mainUserId || game.users.filter(u => !u.isGM && actor.testUserPermission(u, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER, { exact: true }))[0]?.id || null;
  }
  static async resolve(data) {
    if (data.actorId) return game.actors.get(data.actorId);
    return data.packActorId ? this.pack()?.getDocument(data.packActorId) : null;
  }
  static async update(data, requesterId) {
    const actor = await this.resolve(data);
    if (!actor) throw new Error("Actor not found.");
    const requester = game.users.get(requesterId);
    const ownerId = this.ownerId(actor);
    if (!requester?.isGM && requester?.id !== ownerId) throw new Error("You may only update your own actor.");
    const record = { ...(foundry.utils.getProperty(actor, AVH_RECORD_PATH) || {}), mainUserId: ownerId, worldbreakerTier: Math.max(0, Math.min(3, Number(data.tier) || 0)), updatedAt: Date.now() };
    await actor.update({ [AVH_RECORD_PATH]: record });
    return { message: `${actor.name}'s Worldbreaker tier was updated.` };
  }
  static request(data) {
    if (game.user.isGM) return this.update(data, game.user.id);
    if (!this.primaryGM()) return Promise.reject(new Error("An active GM is required."));
    const requestId = foundry.utils.randomID(20);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.pending.delete(requestId); reject(new Error("Worldbreaker update timed out.")); }, 20000);
      this.pending.set(requestId, { resolve, reject, timeout });
      game.socket.emit(AVH_SOCKET, { kind: "request", requestId, requesterId: game.user.id, data });
    });
  }
  static async onSocket(payload) {
    if (!payload) return;
    if (payload.kind === "response" && payload.targetUserId === game.user.id) {
      const pending = this.pending.get(payload.requestId);
      if (!pending) return;
      clearTimeout(pending.timeout); this.pending.delete(payload.requestId);
      payload.ok ? pending.resolve(payload.result) : pending.reject(new Error(payload.error || "Update failed."));
      return;
    }
    if (payload.kind !== "request" || !game.user.isGM || game.user.id !== this.primaryGM()?.id) return;
    try {
      const result = await this.update(payload.data, payload.requesterId);
      game.socket.emit(AVH_SOCKET, { kind: "response", requestId: payload.requestId, targetUserId: payload.requesterId, ok: true, result });
    } catch (error) {
      game.socket.emit(AVH_SOCKET, { kind: "response", requestId: payload.requestId, targetUserId: payload.requesterId, ok: false, error: error.message });
    }
  }
  static bind(app, element) {
    const root = element instanceof HTMLElement ? element : element?.[0] || app?.element;
    if (!root) return;
    for (const row of root.querySelectorAll("[data-actor-id], [data-pack-id]")) {
      const select = row.querySelector("[data-avp-progression] select");
      if (!select || select.dataset.avhBound) continue;
      select.dataset.avhBound = "true";
      select.addEventListener("change", async event => {
        event.stopImmediatePropagation();
        event.preventDefault();
        select.disabled = true;
        try {
          const result = await this.request({ actorId: row.dataset.actorId || null, packActorId: row.dataset.packId || null, tier: Number(select.value) });
          ui.notifications.info(result.message);
          await app.render({ force: true });
        } catch (error) {
          ui.notifications.error(error.message);
          select.disabled = false;
        }
      }, true);
    }
  }
}

Hooks.once("ready", () => game.socket.on(AVH_SOCKET, p => ActorVaultWorldbreakerHotfix.onSocket(p)));
Hooks.on("renderActorVaultApp", (app, element) => ActorVaultWorldbreakerHotfix.bind(app, element));
Hooks.on("renderApplicationV2", (app, element) => { if (app?.id === "actor-vault-app") ActorVaultWorldbreakerHotfix.bind(app, element); });

const AVSB_MODULE_ID = "actor-vault";
const AVSB_SOCKET = `module.${AVSB_MODULE_ID}`;

class ActorVaultSocketBridge {
  static pending = new Map();

  static primaryGM() {
    return game.users
      .filter(user => user.active && user.isGM)
      .sort((a, b) => a.id.localeCompare(b.id))[0] || null;
  }

  static async request(scope, action, data = {}) {
    if (game.user.isGM) return this.execute(scope, action, data, game.user.id);

    const gm = this.primaryGM();
    if (!gm) throw new Error("Actor Vault requires an active GM for shared-data updates.");

    const requestId = foundry.utils.randomID(20);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Actor Vault ${scope} request timed out.`));
      }, 20000);

      this.pending.set(requestId, { resolve, reject, timeout });
      game.socket.emit(AVSB_SOCKET, {
        actorVault: true,
        kind: "request",
        scope,
        requestId,
        action,
        data,
        requesterId: game.user.id
      });
    });
  }

  static async execute(scope, action, data, requesterId) {
    if (!game.user.isGM) throw new Error("Actor Vault shared writes must execute on a GM client.");

    if (scope === "meta-shop") {
      if (!globalThis.ActorVaultMetaShop) throw new Error("Meta Shop is unavailable.");
      return ActorVaultMetaShop.execute(action, data, requesterId);
    }

    if (scope === "player-access") {
      if (!globalThis.ActorVaultPlayerAccess) throw new Error("Actor Vault player access is unavailable.");
      return ActorVaultPlayerAccess.execute(action, data, requesterId);
    }

    throw new Error(`Unknown Actor Vault socket scope: ${scope}`);
  }

  static async onSocket(payload) {
    if (!payload?.actorVault) return;

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
      const result = await this.execute(
        payload.scope,
        payload.action,
        payload.data || {},
        payload.requesterId
      );
      response = { ok: true, result };
    } catch (error) {
      console.error("actor-vault | Shared socket request failed", payload, error);
      response = { ok: false, error: error?.message || String(error) };
    }

    game.socket.emit(AVSB_SOCKET, {
      actorVault: true,
      kind: "response",
      scope: payload.scope,
      requestId: payload.requestId,
      targetUserId: payload.requesterId,
      ...response
    });
  }

  static installOverrides() {
    if (globalThis.ActorVaultMetaShop) {
      ActorVaultMetaShop.request = (action, data = {}) =>
        ActorVaultSocketBridge.request("meta-shop", action, data);
    }

    if (globalThis.ActorVaultPlayerAccess) {
      ActorVaultPlayerAccess.request = (action, data = {}) =>
        ActorVaultSocketBridge.request("player-access", action, data);
    }
  }
}

globalThis.ActorVaultSocketBridge = ActorVaultSocketBridge;

Hooks.once("ready", () => {
  game.socket.on(AVSB_SOCKET, payload => ActorVaultSocketBridge.onSocket(payload));
  ActorVaultSocketBridge.installOverrides();
  console.log("actor-vault | Shared player/GM socket bridge ready on", AVSB_SOCKET);
});

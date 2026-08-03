const AVS_MODULE_ID = "actor-vault";
const AVS_SOCKET = "module.actor-vault-skill-sync";
const AVS_RESOURCE_SCOPE = "world";
const AVS_RESOURCE_KEY = "metaResources";
const AVS_RECORD_PATH = "flags.actor-vault.record";
const AVS_SKILL_PATH = "flags.skill-tree";

class ActorVaultSkillSync {
  static pending = new Map();

  static clamp(value, min, max) {
    return Math.min(max, Math.max(min, Math.trunc(Number(value) || 0)));
  }

  static primaryGM() {
    return game.users
      .filter(user => user.active && user.isGM)
      .sort((a, b) => a.id.localeCompare(b.id))[0] || null;
  }

  static actorLevel(actor) {
    return Math.max(0, Math.trunc([...actor.items]
      .filter(item => item.type === "class")
      .reduce((total, item) => total + (Number(item.system?.levels ?? item.system?.level ?? 0) || 0), 0)));
  }

  static housingTier(ownerId) {
    const user = game.users.get(ownerId);
    const resources = user?.getFlag(AVS_RESOURCE_SCOPE, AVS_RESOURCE_KEY) || {};
    return this.clamp(resources.housingTier, 0, 4);
  }

  static async getSpentPoints(skills) {
    let spent = 0;
    let stale = 0;

    for (const entry of skills) {
      if (!entry || typeof entry.uuid !== "string" || !entry.uuid.trim()) {
        stale += 1;
        continue;
      }

      let document = null;
      try {
        document = await fromUuid(entry.uuid);
      } catch (error) {
        console.warn(`${AVS_MODULE_ID} | Could not resolve Skill Tree UUID`, entry.uuid, error);
      }

      if (!document) {
        stale += 1;
        continue;
      }

      spent += Math.max(0, Math.trunc(Number(entry.points) || 1));
    }

    return { spent, stale };
  }

  static async getStatus(actor) {
    const record = foundry.utils.getProperty(actor, AVS_RECORD_PATH) || {};
    const ownerId = record.mainUserId || "";
    const rawLevel = this.actorLevel(actor) || Number(record.level) || 0;

    if (rawLevel <= 0) {
      return {
        state: "ignored",
        reason: "Actors without class levels are not part of the skill-point system.",
        entitlement: 0,
        spent: 0,
        stale: 0,
        current: null,
        expected: null
      };
    }

    const level = Math.min(rawLevel, 12);
    const housing = this.housingTier(ownerId);
    const worldbreaker = this.clamp(record.worldbreakerTier, 0, 3);
    const entitlement = level + housing + worldbreaker;

    const skillData = foundry.utils.getProperty(actor, AVS_SKILL_PATH);
    if (!skillData || !Array.isArray(skillData.skills) || !Number.isFinite(Number(skillData.skillPoints))) {
      return {
        state: "error",
        reason: "Skill Tree data is missing or invalid.",
        entitlement,
        spent: null,
        stale: 0,
        current: null,
        expected: null
      };
    }

    const { spent, stale } = await this.getSpentPoints(skillData.skills);
    const current = Math.trunc(Number(skillData.skillPoints));
    const expected = entitlement - spent;
    const staleNote = stale
      ? ` Ignored ${stale} purchase${stale === 1 ? "" : "s"} from deleted or missing skill-tree pages.`
      : "";

    if (expected < 0) {
      return {
        state: "error",
        reason: `This actor has ${spent} valid spent points but is only entitled to ${entitlement}.${staleNote}`,
        entitlement,
        spent,
        stale,
        current,
        expected
      };
    }

    if (current > expected) {
      return {
        state: "error",
        reason: `Current unspent points (${current}) exceed the correct amount (${expected}).${staleNote}`,
        entitlement,
        spent,
        stale,
        current,
        expected
      };
    }

    if (current === expected) {
      return {
        state: "current",
        reason: `Skill points are already correct.${staleNote}`,
        entitlement,
        spent,
        stale,
        current,
        expected
      };
    }

    return {
      state: "ready",
      reason: `Ready to update unspent points from ${current} to ${expected}.${staleNote}`,
      entitlement,
      spent,
      stale,
      current,
      expected
    };
  }

  static authorize(actor, requesterId) {
    const requester = game.users.get(requesterId);
    const record = foundry.utils.getProperty(actor, AVS_RECORD_PATH) || {};
    if (!requester) throw new Error("Requesting user not found.");
    if (!requester.isGM && record.mainUserId !== requester.id) {
      throw new Error("You may only update your own actors.");
    }
  }

  static async request(data) {
    if (game.user.isGM) return this.update(data, game.user.id);

    const actor = await this.resolveActor(data);
    if (actor && actor.isOwner && !data.packActorId) {
      return this.update(data, game.user.id);
    }

    if (!this.primaryGM()) throw new Error("An active GM is required to update a stored actor.");

    const requestId = foundry.utils.randomID(20);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("Skill point update timed out."));
      }, 20000);

      this.pending.set(requestId, { resolve, reject, timeout });
      game.socket.emit(AVS_SOCKET, {
        kind: "request",
        requestId,
        requesterId: game.user.id,
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
      else pending.reject(new Error(payload.error || "Skill point update failed."));
      return;
    }

    if (payload.kind !== "request") return;
    if (!game.user.isGM || game.user.id !== this.primaryGM()?.id) return;

    try {
      const result = await this.update(payload.data, payload.requesterId);
      game.socket.emit(AVS_SOCKET, {
        kind: "response",
        requestId: payload.requestId,
        targetUserId: payload.requesterId,
        ok: true,
        result
      });
    } catch (error) {
      console.error(`${AVS_MODULE_ID} | Skill sync failed`, error);
      game.socket.emit(AVS_SOCKET, {
        kind: "response",
        requestId: payload.requestId,
        targetUserId: payload.requesterId,
        ok: false,
        error: error.message
      });
    }
  }

  static async resolveActor({ actorId, packActorId }) {
    if (actorId) return game.actors.get(actorId) || null;
    if (!packActorId) return null;
    const packId = game.settings.get(AVS_MODULE_ID, "packId");
    const pack = game.packs.get(packId);
    return pack ? pack.getDocument(packActorId) : null;
  }

  static async update(data, requesterId) {
    const actor = await this.resolveActor(data);
    if (!actor) throw new Error("Actor not found.");
    this.authorize(actor, requesterId);

    const status = await this.getStatus(actor);
    if (status.state !== "ready") throw new Error(status.reason);

    await actor.update({ "flags.skill-tree.skillPoints": status.expected });
    return {
      message: `${actor.name}: unspent skill points updated from ${status.current} to ${status.expected}.${status.stale ? ` Ignored ${status.stale} stale purchase${status.stale === 1 ? "" : "s"}.` : ""}`
    };
  }

  static async enhance(app, element) {
    const root = element instanceof HTMLElement ? element : element?.[0] || app?.element;
    if (!root) return;

    const packId = game.settings.get(AVS_MODULE_ID, "packId");
    const pack = game.packs.get(packId);

    for (const row of root.querySelectorAll("[data-actor-id], [data-pack-id]")) {
      row.querySelectorAll("[data-avs-sync]").forEach((button, index) => {
        if (index > 0) button.remove();
      });
      if (row.querySelector("[data-avs-sync]")) continue;

      const actorId = row.dataset.actorId || null;
      const packActorId = row.dataset.packId || null;
      const actor = actorId ? game.actors.get(actorId) : (packActorId && pack ? await pack.getDocument(packActorId) : null);
      if (!actor) continue;

      const record = foundry.utils.getProperty(actor, AVS_RECORD_PATH) || {};
      if (!game.user.isGM && record.mainUserId !== game.user.id) continue;

      const status = await this.getStatus(actor);
      if (status.state === "ignored") continue;

      const button = document.createElement("button");
      button.type = "button";
      button.dataset.avsSync = "true";
      button.className = `avs-skill-sync avs-skill-sync--${status.state}`;
      button.disabled = status.state !== "ready";
      button.title = status.reason;
      button.innerHTML = status.state === "ready"
        ? `<i class="fas fa-arrow-up"></i> Update ${status.current} → ${status.expected}`
        : status.state === "current"
          ? `<i class="fas fa-check"></i> Skill Points Current`
          : `<i class="fas fa-triangle-exclamation"></i> Review Skill Points`;

      const progression = row.querySelector("[data-avp-progression]");
      const actionButton = row.querySelector('button[data-action="archive"], button[data-action="activate"]');
      if (progression) progression.insertAdjacentElement("afterend", button);
      else row.insertBefore(button, actionButton || null);

      if (status.state === "error") {
        const reason = document.createElement("small");
        reason.className = "avs-skill-reason";
        reason.textContent = status.reason;
        button.insertAdjacentElement("afterend", reason);
      }

      button.addEventListener("click", async () => {
        if (button.disabled) return;
        button.disabled = true;
        try {
          const result = await this.request({ actorId, packActorId });
          ui.notifications.info(result.message);
          await app.render({ force: true });
        } catch (error) {
          ui.notifications.error(error.message);
          button.disabled = false;
        }
      });
    }
  }
}

Hooks.once("ready", () => {
  game.socket.on(AVS_SOCKET, payload => ActorVaultSkillSync.onSocket(payload));
});

Hooks.on("renderApplicationV2", (app, element) => {
  if (app?.id === "actor-vault-app") ActorVaultSkillSync.enhance(app, element);
});

const AVLR2_SCOPE = "world";
const AVLR2_RESOURCE_KEY = "metaResources";
const AVLR2_HISTORY_KEY = "metaResourcesHistory";
const AVLR2_FLAG_PATH = "flags.actor-vault.longRest";

class ActorVaultLongRestV2 {
  static root(element, app) {
    return element instanceof HTMLElement ? element : element?.[0] || app?.element || null;
  }

  static clamp(value) {
    return Math.max(0, Math.min(4, Math.trunc(Number(value) || 0)));
  }

  static clampCost(value, quickRecovery = false) {
    const minimum = quickRecovery ? 0 : 1;
    return Math.max(minimum, Math.min(4, Math.trunc(Number(value) || 0)));
  }

  static actorLevel(actor) {
    return [...actor.items]
      .filter(item => item.type === "class")
      .reduce((total, item) => total + (Number(item.system?.levels ?? item.system?.level ?? 0) || 0), 0);
  }

  static state(actor) {
    const stored = foundry.utils.getProperty(actor, AVLR2_FLAG_PATH) || {};
    const quickRecovery = Boolean(stored.quickRecovery);
    return {
      cost: Number.isFinite(Number(stored.cost)) ? this.clampCost(stored.cost, quickRecovery) : 1,
      quickRecovery
    };
  }

  static ownerId(actor) {
    const recorded = foundry.utils.getProperty(actor, "flags.actor-vault.record.mainUserId");
    if (recorded && game.users.get(recorded)) return recorded;
    return game.users.contents
      .filter(user => actor.testUserPermission?.(user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER, { exact: true }))
      .sort((a, b) => a.name.localeCompare(b.name))[0]?.id || null;
  }

  static authorized(actor) {
    return game.user.isGM || (actor.isOwner && this.ownerId(actor) === game.user.id);
  }

  static resources(user) {
    const value = foundry.utils.deepClone(user.getFlag(AVLR2_SCOPE, AVLR2_RESOURCE_KEY) || {});
    value.credits = Number(value.credits) || 0;
    return value;
  }

  static async history(user, actor, previousResources, nextResources, previousRest, nextRest, action) {
    const entries = [...(user.getFlag(AVLR2_SCOPE, AVLR2_HISTORY_KEY) || [])];
    entries.unshift({
      timestamp: Date.now(),
      editorUserId: game.user.id,
      actorId: actor.id,
      actorName: actor.name,
      action,
      previous: foundry.utils.deepClone(previousResources),
      state: foundry.utils.deepClone(nextResources),
      previousLongRest: foundry.utils.deepClone(previousRest),
      longRest: foundry.utils.deepClone(nextRest)
    });
    await user.setFlag(AVLR2_SCOPE, AVLR2_HISTORY_KEY, entries.slice(0, 30));
  }

  static async commit(actor, user, previousResources, nextResources, previousRest, nextRest, action) {
    await user.setFlag(AVLR2_SCOPE, AVLR2_RESOURCE_KEY, nextResources);
    try {
      await actor.update({ [AVLR2_FLAG_PATH]: nextRest });
    } catch (error) {
      await user.setFlag(AVLR2_SCOPE, AVLR2_RESOURCE_KEY, previousResources).catch(() => {});
      throw error;
    }
    await this.history(user, actor, previousResources, nextResources, previousRest, nextRest, action);
  }

  static async toggleQuickRecovery(actor, enabled) {
    if (!this.authorized(actor)) throw new Error("You may only change your own character.");
    const owner = game.users.get(this.ownerId(actor));
    if (!owner) throw new Error("Character owner not found.");
    const previousResources = this.resources(owner);
    const previousRest = this.state(actor);
    if (previousRest.quickRecovery === enabled) return;
    const nextRest = {
      quickRecovery: enabled,
      cost: this.clampCost(previousRest.cost + (enabled ? -1 : 1), enabled)
    };
    await this.commit(actor, owner, previousResources, previousResources, previousRest, nextRest,
      `Quick Recovery ${enabled ? "enabled" : "disabled"} for ${actor.name} (${previousRest.cost} to ${nextRest.cost})`);
    ui.notifications.info(`${actor.name}: long-rest cost is now ${nextRest.cost}.`);
  }

  static async longRest(actor) {
    if (!this.authorized(actor)) throw new Error("You may only long rest your own character.");
    const owner = game.users.get(this.ownerId(actor));
    if (!owner) throw new Error("Character owner not found.");
    const previousResources = this.resources(owner);
    const previousRest = this.state(actor);
    const paid = previousRest.cost;
    if (previousResources.credits < paid) {
      throw new Error(`${actor.name} needs ${paid} Server Credit${paid === 1 ? "" : "s"}.`);
    }
    const nextResources = { ...previousResources, credits: previousResources.credits - paid };
    const nextRest = {
      ...previousRest,
      cost: this.clampCost(previousRest.cost + 1, previousRest.quickRecovery)
    };
    await this.commit(actor, owner, previousResources, nextResources, previousRest, nextRest,
      `${actor.name} Long Rest (${paid} credit${paid === 1 ? "" : "s"} paid)`);
    ui.notifications.info(`${actor.name} completed a long rest.`);
  }

  static async noLongRest(actor) {
    if (!this.authorized(actor)) throw new Error("You may only update your own character.");
    const owner = game.users.get(this.ownerId(actor));
    if (!owner) throw new Error("Character owner not found.");
    const previousResources = this.resources(owner);
    const previousRest = this.state(actor);
    const nextRest = {
      ...previousRest,
      cost: this.clampCost(previousRest.cost - 1, previousRest.quickRecovery)
    };
    await this.commit(actor, owner, previousResources, previousResources, previousRest, nextRest,
      `${actor.name} Did Not Long Rest (${previousRest.cost} to ${nextRest.cost})`);
    ui.notifications.info(`${actor.name}: long-rest cost reduced to ${nextRest.cost}.`);
  }

  static markup(actor, rest) {
    const disabled = !this.authorized(actor);
    const minimum = rest.quickRecovery ? 0 : 1;
    return `<div class="avlr2-summary">
      <strong>Long Rest Cost: ${rest.cost}</strong>
      <label><input type="checkbox" data-avlr2-quick ${rest.quickRecovery ? "checked" : ""} ${disabled ? "disabled" : ""}> Quick Recovery</label>
    </div>
    <div class="avlr2-actions">
      <button type="button" data-avlr2-rest ${disabled ? "disabled" : ""}><i class="fas fa-bed"></i> Long Rest (${rest.cost})</button>
      <button type="button" data-avlr2-no-rest ${disabled || rest.cost <= minimum ? "disabled" : ""}><i class="fas fa-arrow-down"></i> Did Not Long Rest</button>
    </div>`;
  }

  static bindRow(app, row) {
    const actor = game.actors.get(row.dataset.actorId);
    const slot = row.querySelector("[data-character-rest]");
    if (!actor || !slot || this.actorLevel(actor) <= 0) {
      slot?.remove();
      return;
    }
    slot.innerHTML = this.markup(actor, this.state(actor));
    const disable = () => slot.querySelectorAll("button,input").forEach(control => control.disabled = true);
    const run = async operation => {
      disable();
      try { await operation(); }
      catch (error) { ui.notifications.error(error.message); }
      await app.render({ force: true });
    };
    slot.querySelector("[data-avlr2-quick]")?.addEventListener("change", event => run(() => this.toggleQuickRecovery(actor, event.currentTarget.checked)));
    slot.querySelector("[data-avlr2-rest]")?.addEventListener("click", event => { event.preventDefault(); run(() => this.longRest(actor)); });
    slot.querySelector("[data-avlr2-no-rest]")?.addEventListener("click", event => { event.preventDefault(); run(() => this.noLongRest(actor)); });
  }

  static bind(app, element) {
    const root = this.root(element, app);
    if (!root) return;
    root.querySelectorAll("[data-actor-id]").forEach(row => this.bindRow(app, row));
  }
}

Hooks.on("renderApplicationV2", (app, element) => {
  if (app?.id !== "actor-vault-app") return;
  for (const delay of [0, 100, 300]) setTimeout(() => ActorVaultLongRestV2.bind(app, element), delay);
});

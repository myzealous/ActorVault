const AVD_MODULE_ID = "actor-vault";
const AVD_RESOURCE_SCOPE = "world";
const AVD_RESOURCE_KEY = "metaResources";
const AVD_HISTORY_KEY = "metaResourcesHistory";
const AVD_RECORD_PATH = "flags.actor-vault.record";

class ActorVaultDashboardV3 {
  static clamp(value, min, max) {
    return Math.min(max, Math.max(min, Math.trunc(Number(value) || 0)));
  }

  static root(element, app) {
    return element instanceof HTMLElement ? element : element?.[0] || app?.element || null;
  }

  static pack() {
    return game.packs.get(game.settings.get(AVD_MODULE_ID, "packId"));
  }

  static record(actor) {
    return foundry.utils.getProperty(actor, AVD_RECORD_PATH) || {};
  }

  static ownerId(actor) {
    const record = this.record(actor);
    if (record.mainUserId) return record.mainUserId;
    return game.users
      .filter(user => !user.isGM && actor.testUserPermission?.(
        user,
        CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER,
        { exact: true }
      ))[0]?.id || null;
  }

  static actorLevel(actor) {
    return Math.max(0, Math.trunc([...actor.items]
      .filter(item => item.type === "class")
      .reduce((total, item) => total + (Number(item.system?.levels ?? item.system?.level ?? 0) || 0), 0)));
  }

  static housingTier(userId) {
    const resources = game.users.get(userId)?.getFlag(AVD_RESOURCE_SCOPE, AVD_RESOURCE_KEY) || {};
    return this.clamp(resources.housingTier, 0, 4);
  }

  static housingName(tier) {
    return ["None", "Homestead", "House", "Manor", "Estate"][this.clamp(tier, 0, 4)];
  }

  static protectionSlots(tier) {
    return Math.max(0, this.clamp(tier, 0, 4) - 1);
  }

  static async setHousing(userId, tier, app) {
    const user = game.users.get(userId);
    if (!user || user.isGM) throw new Error("Player not found.");
    if (!game.user.isGM && user.id !== game.user.id) throw new Error("You may only change your own housing tier.");

    const previous = foundry.utils.deepClone(user.getFlag(AVD_RESOURCE_SCOPE, AVD_RESOURCE_KEY) || {});
    const next = { ...previous, housingTier: this.clamp(tier, 0, 4) };
    await user.setFlag(AVD_RESOURCE_SCOPE, AVD_RESOURCE_KEY, next);

    const history = [...(user.getFlag(AVD_RESOURCE_SCOPE, AVD_HISTORY_KEY) || [])];
    history.unshift({ timestamp: Date.now(), editorUserId: game.user.id, previous, state: foundry.utils.deepClone(next) });
    await user.setFlag(AVD_RESOURCE_SCOPE, AVD_HISTORY_KEY, history.slice(0, 30));
    ui.notifications.info(`${user.name}'s housing is now ${this.housingName(next.housingTier)}.`);
    await app.render({ force: true });
  }

  static async setWorldbreaker(actor, tier, app) {
    const ownerId = this.ownerId(actor);
    if (!game.user.isGM && ownerId !== game.user.id) throw new Error("You may only change your own character.");
    if (!actor.isOwner && !game.user.isGM) throw new Error("You do not have permission to update this actor.");

    const record = {
      ...this.record(actor),
      mainUserId: ownerId,
      worldbreakerTier: this.clamp(tier, 0, 3),
      level: this.actorLevel(actor),
      updatedAt: Date.now()
    };
    await actor.update({ [AVD_RECORD_PATH]: record });
    ui.notifications.info(`${actor.name}'s Worldbreaker tier was updated.`);
    await app.render({ force: true });
  }

  static async spentPoints(skills) {
    let spent = 0;
    for (const entry of skills) {
      if (!entry?.uuid) continue;
      let document = null;
      try { document = await fromUuid(entry.uuid); } catch (_) { /* stale entry */ }
      if (document) spent += Math.max(0, Math.trunc(Number(entry.points) || 1));
    }
    return spent;
  }

  static async skillStatus(actor) {
    const level = this.actorLevel(actor);
    if (level <= 0) return null;

    const ownerId = this.ownerId(actor);
    const record = this.record(actor);
    const housing = this.housingTier(ownerId);
    const worldbreaker = this.clamp(record.worldbreakerTier, 0, 3);
    const entitlement = Math.min(level, 12) + housing + worldbreaker;
    const skillData = foundry.utils.getProperty(actor, "flags.skill-tree");

    if (!skillData || !Array.isArray(skillData.skills) || !Number.isFinite(Number(skillData.skillPoints))) {
      return { state: "error", entitlement, current: null, expected: null };
    }

    const spent = await this.spentPoints(skillData.skills);
    const current = Math.trunc(Number(skillData.skillPoints));
    const expected = entitlement - spent;
    if (expected < 0 || current > expected) return { state: "error", entitlement, current, expected };
    if (current === expected) return { state: "current", entitlement, current, expected };
    return { state: "ready", entitlement, current, expected };
  }

  static async updateSkillPoints(actor, app) {
    if (!actor.isOwner && !game.user.isGM) throw new Error("You do not have permission to update this actor.");
    const status = await this.skillStatus(actor);
    if (!status || status.state !== "ready") throw new Error("Skill points are not ready for an update.");
    await actor.update({ "flags.skill-tree.skillPoints": status.expected });
    ui.notifications.info(`${actor.name}: skill points updated from ${status.current} to ${status.expected}.`);
    await app.render({ force: true });
  }

  static async openHistory(userId) {
    const allowedUsers = game.user.isGM
      ? game.users.filter(user => !user.isGM).sort((a, b) => a.name.localeCompare(b.name))
      : [game.user];
    const selected = allowedUsers.find(user => user.id === userId) || allowedUsers[0];
    if (!selected) return;

    const options = allowedUsers.map(user =>
      `<option value="${foundry.utils.escapeHTML(user.id)}" ${user.id === selected.id ? "selected" : ""}>${foundry.utils.escapeHTML(user.name)}</option>`
    ).join("");

    const dialog = new foundry.applications.api.DialogV2({
      window: { title: "Resource History", resizable: true },
      position: { width: 900, height: 650 },
      content: `<section class="avd-history"><label>Player<select data-avd-history-user ${game.user.isGM ? "" : "disabled"}>${options}</select></label><div data-avd-history-log></div></section>`,
      buttons: [{ action: "close", label: "Close", default: true }]
    });
    await dialog.render({ force: true });

    const select = dialog.element.querySelector("[data-avd-history-user]");
    const log = dialog.element.querySelector("[data-avd-history-log]");
    const draw = () => {
      const user = game.users.get(select.value);
      const history = user?.getFlag(AVD_RESOURCE_SCOPE, AVD_HISTORY_KEY) || [];
      if (!history.length) {
        log.innerHTML = "<p>No resource history recorded.</p>";
        return;
      }
      log.innerHTML = `<table><thead><tr><th>Date</th><th>Editor</th><th>Housing</th><th>Gold</th><th>Credits</th><th>XP</th><th>Storage</th></tr></thead><tbody>${history.map(entry => {
        const state = entry.state || {};
        const storage = (state.storage || []).filter(Boolean).join(", ") || "—";
        return `<tr><td>${new Date(entry.timestamp).toLocaleString()}</td><td>${foundry.utils.escapeHTML(game.users.get(entry.editorUserId)?.name || "Unknown")}</td><td>${this.housingName(state.housingTier)}</td><td>${Number(state.gold) || 0}</td><td>${Number(state.credits) || 0}</td><td>${Number(state.xp) || 0}</td><td>${foundry.utils.escapeHTML(storage)}</td></tr>`;
      }).join("")}</tbody></table>`;
    };
    select.addEventListener("change", draw);
    draw();
  }

  static worldbreakerOptions(selected) {
    return [0, 1, 2, 3].map(value =>
      `<option value="${value}" ${value === selected ? "selected" : ""}>${value ? `Tier ${value}` : "None"}</option>`
    ).join("");
  }

  static async buildActiveControls(app, root) {
    for (const row of root.querySelectorAll("[data-actor-id]")) {
      const actor = game.actors.get(row.dataset.actorId);
      if (!actor) continue;
      const level = this.actorLevel(actor);
      if (level <= 0) {
        row.classList.add("avd-row--npc");
        continue;
      }

      const ownerId = this.ownerId(actor);
      if (!game.user.isGM && ownerId !== game.user.id) continue;
      const record = this.record(actor);
      const housing = this.housingTier(ownerId);
      const worldbreaker = this.clamp(record.worldbreakerTier, 0, 3);
      const entitlement = Math.min(level, 12) + housing + worldbreaker;

      const summary = row.querySelector("[data-skill-summary]");
      if (summary) summary.innerHTML = `<strong>Skill Points: ${entitlement}</strong><span>Level ${Math.min(level, 12)} + Housing ${housing} + WB ${worldbreaker}</span>`;

      const progression = row.querySelector("[data-progression-slot]");
      if (progression) {
        progression.innerHTML = `<label><span>Worldbreaker</span><select>${this.worldbreakerOptions(worldbreaker)}</select></label>`;
        const select = progression.querySelector("select");
        select.addEventListener("change", async () => {
          select.disabled = true;
          try { await this.setWorldbreaker(actor, select.value, app); }
          catch (error) { ui.notifications.error(error.message); select.disabled = false; }
        });
      }

      const status = await this.skillStatus(actor);
      const sync = row.querySelector("[data-sync-slot]");
      if (sync && status) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `avd-sync avd-sync--${status.state}`;
        button.disabled = status.state !== "ready";
        button.textContent = status.state === "ready" ? `Update ${status.current} → ${status.expected}` : status.state === "current" ? "Skill Points Current" : "Review Skill Points";
        if (status.state === "ready") button.addEventListener("click", async () => {
          button.disabled = true;
          try { await this.updateSkillPoints(actor, app); }
          catch (error) { ui.notifications.error(error.message); button.disabled = false; }
        });
        sync.replaceChildren(button);
      }
    }
  }

  static bindDashboard(app, root) {
    const form = root.querySelector("form[data-resource-form]");
    const userId = form?.dataset.userId;
    const user = game.users.get(userId);
    const housing = root.querySelector("[data-housing-tier]");
    if (housing && user) {
      housing.value = String(this.housingTier(user.id));
      housing.addEventListener("change", async () => {
        housing.disabled = true;
        try { await this.setHousing(user.id, housing.value, app); }
        catch (error) { ui.notifications.error(error.message); housing.disabled = false; }
      });

      const slots = this.protectionSlots(this.housingTier(user.id));
      root.querySelectorAll("[data-storage-slot]").forEach((field, index) => {
        const input = field.querySelector("input");
        const unlocked = index < slots;
        field.hidden = index >= 3;
        input.disabled = !unlocked;
        field.classList.toggle("is-locked", !unlocked);
        field.querySelector("span").textContent = `Protected Slot ${index + 1}${unlocked ? "" : " (Locked)"}`;
      });
    }

    root.querySelector("[data-history-button]")?.addEventListener("click", () => this.openHistory(userId));
  }

  static async enhance(app, element) {
    const root = this.root(element, app);
    if (!root || root.dataset.avdBound === "true") return;
    root.dataset.avdBound = "true";
    this.bindDashboard(app, root);
    await this.buildActiveControls(app, root);
  }
}

Hooks.on("renderApplicationV2", (app, element) => {
  if (app?.id === "actor-vault-app") ActorVaultDashboardV3.enhance(app, element);
});

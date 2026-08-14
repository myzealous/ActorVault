const AVW_MODULE_ID = "actor-vault";
const AVW_RECORD_PATH = "flags.actor-vault.record";
const AVW_RESOURCE_SCOPE = "world";
const AVW_RESOURCE_KEY = "metaResources";

class ActorVaultWorkflowControlsV3 {
  static root(element, app) {
    return element instanceof HTMLElement ? element : element?.[0] || app?.element || null;
  }

  static record(actor) {
    return foundry.utils.getProperty(actor, AVW_RECORD_PATH) || {};
  }

  static ownerId(actor) {
    const record = this.record(actor);
    if (record.mainUserId) return record.mainUserId;
    return game.users.filter(user => !user.isGM && actor.testUserPermission?.(
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

  static housingTier(ownerId) {
    const resources = game.users.get(ownerId)?.getFlag(AVW_RESOURCE_SCOPE, AVW_RESOURCE_KEY) || {};
    return Math.max(0, Math.min(4, Math.trunc(Number(resources.housingTier) || 0)));
  }

  static async validSpentPoints(actor) {
    const skills = foundry.utils.getProperty(actor, "flags.skill-tree.skills");
    if (!Array.isArray(skills)) return null;
    let spent = 0;
    for (const entry of skills) {
      if (!entry?.uuid) continue;
      let document = null;
      try { document = await fromUuid(entry.uuid); } catch (_) { /* stale tree entry */ }
      if (document) spent += Math.max(0, Math.trunc(Number(entry.points) || 1));
    }
    return spent;
  }

  static async skillStatus(actor) {
    const level = this.actorLevel(actor);
    if (level <= 0) return null;
    const record = this.record(actor);
    const entitlement = Math.min(level, 12)
      + this.housingTier(this.ownerId(actor))
      + Math.max(0, Math.min(3, Math.trunc(Number(record.worldbreakerTier) || 0)));
    const spent = await this.validSpentPoints(actor);
    const currentRaw = foundry.utils.getProperty(actor, "flags.skill-tree.skillPoints");

    if (spent === null || !Number.isFinite(Number(currentRaw))) {
      return {
        state: "error",
        reason: "Skill Tree data is missing or invalid.",
        entitlement,
        spent,
        current: null,
        expected: null
      };
    }

    const current = Math.trunc(Number(currentRaw));
    const expected = entitlement - spent;

    if (expected < 0) {
      return {
        state: "error",
        reason: `Spent skill points (${spent}) exceed entitlement (${entitlement}).`,
        entitlement,
        spent,
        current,
        expected
      };
    }

    if (current > expected) {
      return {
        state: "error",
        reason: `Current unspent points (${current}) exceed the correct amount (${expected}).`,
        entitlement,
        spent,
        current,
        expected
      };
    }

    if (current === expected) {
      return { state: "current", reason: "Skill points are already correct.", entitlement, spent, current, expected };
    }

    return {
      state: "ready",
      reason: `Ready to update unspent points from ${current} to ${expected}.`,
      entitlement,
      spent,
      current,
      expected
    };
  }

  static styleCurrent(button) {
    button.className = "avd-sync avd-sync--current";
    button.disabled = true;
    button.textContent = "Skill Points Current";
  }

  static bindPlayerSkillButtons(root) {
    if (game.user.isGM) return;
    for (const row of root.querySelectorAll("[data-actor-id]")) {
      const button = row.querySelector("[data-sync-slot] button.avd-sync--ready");
      if (!button || button.dataset.avwBound) continue;
      button.dataset.avwBound = "true";
      button.addEventListener("click", async event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        const actor = game.actors.get(row.dataset.actorId);
        if (!actor) return ui.notifications.error("Actor not found.");
        button.disabled = true;
        try {
          const status = await this.skillStatus(actor);
          if (!status || status.state !== "ready") throw new Error(status?.reason || "Skill points no longer need an update.");
          await actor.update({ "flags.skill-tree.skillPoints": status.expected });
          this.styleCurrent(button);
          ui.notifications.info(`${actor.name}: skill points updated from ${status.current} to ${status.expected}.`);
        } catch (error) {
          ui.notifications.error(error.message);
          button.disabled = false;
        }
      }, true);
    }
  }

  static async updateAllSkillPoints(button) {
    const actors = [...document.querySelectorAll("#actor-vault-app [data-actor-id]")]
      .map(row => game.actors.get(row.dataset.actorId))
      .filter(Boolean);
    let updated = 0;
    let current = 0;
    const review = [];
    button.disabled = true;
    try {
      for (const actor of actors) {
        const status = await this.skillStatus(actor);
        if (!status) continue;
        if (status.state === "ready") {
          await actor.update({ "flags.skill-tree.skillPoints": status.expected });
          updated += 1;
        } else if (status.state === "current") {
          current += 1;
        } else {
          review.push({ actor, status });
        }
      }

      ui.notifications.info(`Skill points: ${updated} updated, ${current} already current${review.length ? `, ${review.length} require review: ${review.map(entry => entry.actor.name).join(", ")}` : ""}.`);

      if (review.length) {
        console.warn("Actor Vault | Skill points requiring review");
        console.table(review.map(({ actor, status }) => ({
          actor: actor.name,
          reason: status.reason || "Review required.",
          entitlement: status.entitlement ?? "—",
          spent: status.spent ?? "—",
          current: status.current ?? "—",
          expected: status.expected ?? "—"
        })));

        const rows = review.map(({ actor, status }) => `
          <tr>
            <td><strong>${foundry.utils.escapeHTML(actor.name)}</strong></td>
            <td>${foundry.utils.escapeHTML(status.reason || "Review required.")}</td>
            <td>${status.entitlement ?? "—"}</td>
            <td>${status.spent ?? "—"}</td>
            <td>${status.current ?? "—"}</td>
            <td>${status.expected ?? "—"}</td>
          </tr>
        `).join("");

        await foundry.applications.api.DialogV2.wait({
          window: { title: "Skill Points Requiring Review" },
          position: { width: 820 },
          content: `
            <div style="padding:10px;">
              <p><strong>${review.length} actor${review.length === 1 ? "" : "s"} require review.</strong></p>
              <table style="width:100%;">
                <thead>
                  <tr><th>Actor</th><th>Reason</th><th>Entitlement</th><th>Spent</th><th>Current</th><th>Expected</th></tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          `,
          buttons: [{ action: "close", label: "Close", default: true }]
        });
      }

      const app = foundry.applications.instances.get("actor-vault-app");
      await app?.render({ force: true });
    } catch (error) {
      ui.notifications.error(error.message);
      button.disabled = false;
    }
  }

  static pack() {
    return game.packs.get(game.settings.get(AVW_MODULE_ID, "packId"));
  }

  static ownership(ownerId) {
    return { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED, [ownerId]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER };
  }

  static async ensureVaultFolders(pack, owner) {
    let root = pack.folders.find(folder => folder.name === "Players" && !folder.folder);
    if (!root) root = await Folder.create({ name: "Players", type: "Actor", folder: null }, { pack: pack.collection });
    let ownerFolder = pack.folders.find(folder => folder.name === owner.name && (folder.folder?.id || folder.folder) === root.id);
    if (!ownerFolder) ownerFolder = await Folder.create({ name: owner.name, type: "Actor", folder: root.id }, { pack: pack.collection });
    return ownerFolder;
  }

  static async removeActorReferences(actorId) {
    for (const scene of game.scenes) {
      const ids = [...scene.tokens].filter(token => token.actorLink && token.actorId === actorId).map(token => token.id);
      if (ids.length) await scene.deleteEmbeddedDocuments("Token", ids);
    }
    for (const combat of game.combats) {
      const ids = [...combat.combatants].filter(combatant => combatant.actorId === actorId).map(combatant => combatant.id);
      if (ids.length) await combat.deleteEmbeddedDocuments("Combatant", ids);
    }
  }

  static async exportOne(actor) {
    if (!game.user.isGM) throw new Error("GM only.");
    const pack = this.pack();
    if (!pack) throw new Error("Actor Vault compendium not found.");
    const ownerId = this.ownerId(actor);
    const owner = game.users.get(ownerId);
    if (!owner || owner.isGM) throw new Error(`${actor.name} has no valid player owner.`);
    const oldRecord = this.record(actor);
    const record = {
      ...oldRecord,
      vaultId: oldRecord.vaultId || foundry.utils.randomID(24),
      mainUserId: owner.id,
      originalFolderId: actor.folder?.id || oldRecord.originalFolderId || null,
      originalFolderName: actor.folder?.name || oldRecord.originalFolderName || null,
      checkedOutAt: null,
      updatedAt: Date.now()
    };
    const index = await pack.getIndex({ fields: [AVW_RECORD_PATH] });
    const previous = index.find(entry => foundry.utils.getProperty(entry, AVW_RECORD_PATH)?.vaultId === record.vaultId);
    const folder = await this.ensureVaultFolders(pack, owner);
    const data = actor.toObject();
    delete data._id;
    data.folder = folder.id;
    data.ownership = this.ownership(owner.id);
    foundry.utils.setProperty(data, AVW_RECORD_PATH, record);
    const [replacement] = await Actor.implementation.createDocuments([data], { pack: pack.collection, keepId: false });
    if (!replacement) throw new Error(`Could not create the vault replacement for ${actor.name}.`);
    try {
      await this.removeActorReferences(actor.id);
      if (owner.character?.id === actor.id) await owner.update({ character: null });
      await actor.delete();
      if (previous) await (await pack.getDocument(previous._id))?.delete();
    } catch (error) {
      await replacement.delete().catch(() => {});
      throw error;
    }
    return actor.name;
  }

  static bindIndividualExports(app, root) {
    if (!game.user.isGM) return;
    for (const button of root.querySelectorAll('button[data-action="archive"]')) {
      if (button.dataset.avwExportBound) continue;
      button.dataset.avwExportBound = "true";
      button.innerHTML = '<i class="fas fa-box-archive"></i> Export';
      button.addEventListener("click", async event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        const actor = game.actors.get(button.dataset.id);
        if (!actor) return ui.notifications.error("Actor not found.");
        button.disabled = true;
        try {
          const name = await this.exportOne(actor);
          ui.notifications.info(`${name} exported to the vault.`);
          await app.render({ force: true });
        } catch (error) {
          ui.notifications.error(error.message);
          button.disabled = false;
        }
      }, true);
    }
  }

  static addGMButton(root) {
    if (!game.user.isGM) return;
    const toolbar = root.querySelector(".actor-vault__toolbar");
    if (!toolbar || toolbar.querySelector("[data-avw-update-all]")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.avwUpdateAll = "true";
    button.innerHTML = '<i class="fas fa-arrow-up"></i> Update Skill Points';
    button.addEventListener("click", () => this.updateAllSkillPoints(button));
    const exportAll = toolbar.querySelector("[data-avc-export-all]");
    toolbar.insertBefore(button, exportAll || null);
  }

  static enhance(app, element) {
    const root = this.root(element, app);
    if (!root) return;
    this.bindPlayerSkillButtons(root);
    this.bindIndividualExports(app, root);
    this.addGMButton(root);
    if (game.user.isGM) root.querySelectorAll("[data-sync-slot]").forEach(slot => slot.replaceChildren());
  }
}

Hooks.on("renderApplicationV2", (app, element) => {
  if (app?.id !== "actor-vault-app") return;
  setTimeout(() => ActorVaultWorkflowControlsV3.enhance(app, element), 0);
  setTimeout(() => ActorVaultWorkflowControlsV3.enhance(app, element), 250);
});

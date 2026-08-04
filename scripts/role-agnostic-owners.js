const ARO_MODULE_ID = "actor-vault";
const ARO_RECORD_PATH = "flags.actor-vault.record";

class ActorVaultRoleAgnosticOwners {
  static root(element, app) {
    return element instanceof HTMLElement ? element : element?.[0] || app?.element || null;
  }

  static pack() {
    return game.packs.get(game.settings.get(ARO_MODULE_ID, "packId"));
  }

  static record(document) {
    return foundry.utils.getProperty(document, ARO_RECORD_PATH) || {};
  }

  static ownership(ownerId) {
    return {
      default: CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED,
      [ownerId]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER
    };
  }

  static users() {
    return [...game.users].filter(user => user?.id).sort((a, b) => a.name.localeCompare(b.name));
  }

  static async setOwner(actor, ownerId) {
    if (!game.user.isGM) throw new Error("Only a GM may assign actor ownership.");
    const owner = game.users.get(ownerId);
    if (!owner) throw new Error("Select a valid Foundry user.");

    const previous = this.record(actor);
    const record = {
      ...previous,
      vaultId: previous.vaultId || foundry.utils.randomID(24),
      mainUserId: owner.id,
      originalFolderId: actor.folder?.id || previous.originalFolderId || null,
      originalFolderName: actor.folder?.name || previous.originalFolderName || null,
      managedAt: previous.managedAt || Date.now(),
      updatedAt: Date.now()
    };

    await actor.update({
      ownership: this.ownership(owner.id),
      [ARO_RECORD_PATH]: record
    });
  }

  static bindOwnerSelects(app, root) {
    if (!game.user.isGM) return;

    for (const oldSelect of root.querySelectorAll("select[data-owner-select]")) {
      if (oldSelect.dataset.aroBound === "true") continue;
      const row = oldSelect.closest("[data-actor-id]");
      const actor = game.actors.get(row?.dataset.actorId);
      if (!actor) continue;

      const currentOwnerId = this.record(actor).mainUserId || oldSelect.value || "";
      const select = oldSelect.cloneNode(false);
      select.dataset.ownerSelect = "true";
      select.dataset.actorId = actor.id;
      select.dataset.aroBound = "true";

      const unassigned = document.createElement("option");
      unassigned.value = "";
      unassigned.textContent = "Unassigned";
      select.append(unassigned);

      for (const user of this.users()) {
        const option = document.createElement("option");
        option.value = user.id;
        option.textContent = user.name;
        option.selected = user.id === currentOwnerId;
        select.append(option);
      }

      oldSelect.replaceWith(select);
      select.addEventListener("change", async event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        const ownerId = select.value;
        if (!ownerId) {
          ui.notifications.warn("Select a user account as the actor owner.");
          select.value = currentOwnerId;
          return;
        }

        select.disabled = true;
        try {
          await this.setOwner(actor, ownerId);
          ui.notifications.info(`${actor.name} is now assigned to ${game.users.get(ownerId)?.name}.`);
          await app.render({ force: true });
        } catch (error) {
          console.error(`${ARO_MODULE_ID} | Owner assignment failed`, error);
          ui.notifications.error(error.message);
          select.disabled = false;
        }
      }, true);
    }
  }

  static async ensureVaultFolders(pack, owner) {
    let root = pack.folders.find(folder => folder.name === "Players" && !folder.folder);
    if (!root) root = await Folder.create({ name: "Players", type: "Actor", folder: null }, { pack: pack.collection });

    let ownerFolder = pack.folders.find(folder =>
      folder.name === owner.name && (folder.folder?.id || folder.folder) === root.id
    );
    if (!ownerFolder) ownerFolder = await Folder.create(
      { name: owner.name, type: "Actor", folder: root.id },
      { pack: pack.collection }
    );
    return ownerFolder;
  }

  static async removeActorReferences(actorId) {
    for (const scene of game.scenes) {
      const ids = [...scene.tokens]
        .filter(token => token.actorLink && token.actorId === actorId)
        .map(token => token.id);
      if (ids.length) await scene.deleteEmbeddedDocuments("Token", ids);
    }

    for (const combat of game.combats) {
      const ids = [...combat.combatants]
        .filter(combatant => combatant.actorId === actorId)
        .map(combatant => combatant.id);
      if (ids.length) await combat.deleteEmbeddedDocuments("Combatant", ids);
    }
  }

  static async exportActor(actor) {
    if (!game.user.isGM) throw new Error("GM only.");
    const pack = this.pack();
    if (!pack) throw new Error("Actor Vault compendium not found.");

    const oldRecord = this.record(actor);
    const owner = game.users.get(oldRecord.mainUserId);
    if (!owner) throw new Error(`${actor.name} has no valid user owner.`);

    const record = {
      ...oldRecord,
      vaultId: oldRecord.vaultId || foundry.utils.randomID(24),
      mainUserId: owner.id,
      originalFolderId: actor.folder?.id || oldRecord.originalFolderId || null,
      originalFolderName: actor.folder?.name || oldRecord.originalFolderName || null,
      checkedOutAt: null,
      updatedAt: Date.now()
    };

    const index = await pack.getIndex({ fields: [ARO_RECORD_PATH] });
    const previous = index.find(entry => foundry.utils.getProperty(entry, ARO_RECORD_PATH)?.vaultId === record.vaultId);
    const folder = await this.ensureVaultFolders(pack, owner);
    const data = actor.toObject();
    delete data._id;
    data.folder = folder.id;
    data.ownership = this.ownership(owner.id);
    foundry.utils.setProperty(data, ARO_RECORD_PATH, record);

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

  static bindExports(app, root) {
    if (!game.user.isGM) return;
    for (const row of root.querySelectorAll("[data-actor-id]")) {
      const oldButton = row.querySelector('button[data-action="archive"]');
      if (!oldButton || oldButton.dataset.aroBound === "true") continue;

      const button = oldButton.cloneNode(true);
      button.dataset.aroBound = "true";
      oldButton.replaceWith(button);
      button.addEventListener("click", async event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        const actor = game.actors.get(row.dataset.actorId);
        if (!actor) return ui.notifications.error("Actor not found.");
        button.disabled = true;
        try {
          const name = await this.exportActor(actor);
          ui.notifications.info(`${name} exported to the vault.`);
          await app.render({ force: true });
        } catch (error) {
          console.error(`${ARO_MODULE_ID} | Export failed`, error);
          ui.notifications.error(error.message);
          button.disabled = false;
        }
      }, true);
    }
  }

  static enhance(app, element) {
    const root = this.root(element, app);
    if (!root) return;
    this.bindOwnerSelects(app, root);
    this.bindExports(app, root);
  }
}

Hooks.on("renderApplicationV2", (app, element) => {
  if (app?.id !== "actor-vault-app") return;
  for (const delay of [0, 100, 300]) {
    setTimeout(() => ActorVaultRoleAgnosticOwners.enhance(app, element), delay);
  }
});

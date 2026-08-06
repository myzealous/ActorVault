const AVC_MODULE_ID = "actor-vault";
const AVC_RECORD_PATH = "flags.actor-vault.record";
const AVC_PLAYERS_FOLDER = "Players";

class ActorVaultCheckoutFlow {
  static pack() {
    return game.packs.get(game.settings.get(AVC_MODULE_ID, "packId"));
  }

  static record(document) {
    return foundry.utils.getProperty(document, AVC_RECORD_PATH) || {};
  }

  static ownerId(document) {
    const record = this.record(document);
    if (record.mainUserId && game.users.get(record.mainUserId)) return record.mainUserId;

    const ownerLevel = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
    return game.users
      .filter(user => user?.id && Number(document.ownership?.[user.id]) === ownerLevel)
      .sort((a, b) => a.name.localeCompare(b.name))[0]?.id || null;
  }

  static ownership(ownerId) {
    return {
      default: CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED,
      ...(ownerId ? { [ownerId]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER } : {})
    };
  }

  static playersFolder() {
    return game.folders.find(folder =>
      folder.type === "Actor" && folder.name.trim().toLowerCase() === AVC_PLAYERS_FOLDER.toLowerCase()
    ) || null;
  }

  static managedFolderIds() {
    const root = this.playersFolder();
    if (!root) return new Set();
    return new Set([root.id, ...root.getSubfolders(true).map(folder => folder.id)]);
  }

  static managedActors() {
    const ids = this.managedFolderIds();
    return game.actors.filter(actor => actor.folder && ids.has(actor.folder.id));
  }

  static restoreFolder(record, owner) {
    const original = record.originalFolderId && game.folders.get(record.originalFolderId);
    if (original?.type === "Actor") return original;
    const root = this.playersFolder();
    return root?.getSubfolders(true).find(folder =>
      folder.name.trim().toLowerCase() === owner.name.trim().toLowerCase()
    ) || root || null;
  }

  static activeDuplicate(vaultId) {
    return vaultId ? game.actors.find(actor => this.record(actor).vaultId === vaultId) || null : null;
  }

  static async importStored(packActorId) {
    const pack = this.pack();
    if (!pack) throw new Error("Actor Vault compendium not found.");

    const stored = await pack.getDocument(packActorId);
    if (!stored) throw new Error("Stored actor not found.");

    const record = this.record(stored);
    if (!record.vaultId || !record.mainUserId) throw new Error("Stored actor is missing vault metadata.");

    if (!game.user.isGM && record.mainUserId !== game.user.id) {
      throw new Error("You may only import your own characters.");
    }

    const duplicate = this.activeDuplicate(record.vaultId);
    if (duplicate) throw new Error(`${duplicate.name} is already active in the world.`);

    const owner = game.users.get(record.mainUserId);
    if (!owner) throw new Error("The stored actor's assigned owner no longer exists.");

    const data = stored.toObject();
    delete data._id;
    data.folder = this.restoreFolder(record, owner)?.id || null;
    data.ownership = this.ownership(owner.id);
    foundry.utils.setProperty(data, AVC_RECORD_PATH, {
      ...record,
      mainUserId: owner.id,
      checkedOutAt: Date.now(),
      updatedAt: Date.now()
    });

    let actor;
    try {
      [actor] = await Actor.implementation.createDocuments([data], { keepId: false });
    } catch (error) {
      throw new Error(`Foundry denied the actor import. The user role needs permission to create Actors. ${error.message}`);
    }

    if (!actor) throw new Error("The world actor could not be created.");
    return { message: `${actor.name} imported. The vault copy was retained.` };
  }

  static async removeActorTokens(actorId) {
    for (const scene of game.scenes) {
      const tokenIds = [...scene.tokens]
        .filter(token => token.actorLink && token.actorId === actorId)
        .map(token => token.id);
      if (tokenIds.length) await scene.deleteEmbeddedDocuments("Token", tokenIds);
    }

    for (const combat of game.combats) {
      const combatantIds = [...combat.combatants]
        .filter(combatant => combatant.actorId === actorId)
        .map(combatant => combatant.id);
      if (combatantIds.length) await combat.deleteEmbeddedDocuments("Combatant", combatantIds);
    }
  }

  static async ensureVaultFolders(pack, owner) {
    let root = pack.folders.find(folder => folder.name === AVC_PLAYERS_FOLDER && !folder.folder);
    if (!root) root = await Folder.create(
      { name: AVC_PLAYERS_FOLDER, type: "Actor", folder: null },
      { pack: pack.collection }
    );

    let ownerFolder = pack.folders.find(folder =>
      folder.name === owner.name && (folder.folder?.id || folder.folder) === root.id
    );
    if (!ownerFolder) ownerFolder = await Folder.create(
      { name: owner.name, type: "Actor", folder: root.id },
      { pack: pack.collection }
    );
    return ownerFolder;
  }

  static async exportOne(actor, pack) {
    const ownerId = this.ownerId(actor);
    const owner = game.users.get(ownerId);
    if (!owner) throw new Error(`${actor.name} has no valid user owner.`);

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

    const index = await pack.getIndex({ fields: [AVC_RECORD_PATH] });
    const oldEntry = index.find(entry =>
      foundry.utils.getProperty(entry, AVC_RECORD_PATH)?.vaultId === record.vaultId
    );
    const ownerFolder = await this.ensureVaultFolders(pack, owner);
    const data = actor.toObject();
    delete data._id;
    data.folder = ownerFolder.id;
    data.ownership = this.ownership(owner.id);
    foundry.utils.setProperty(data, AVC_RECORD_PATH, record);

    const [replacement] = await Actor.implementation.createDocuments(
      [data],
      { pack: pack.collection, keepId: false }
    );
    if (!replacement) throw new Error(`Could not create the vault replacement for ${actor.name}.`);

    try {
      await this.removeActorTokens(actor.id);
      if (owner.character?.id === actor.id) await owner.update({ character: null });
      await actor.delete();
      if (oldEntry) {
        const oldDocument = await pack.getDocument(oldEntry._id);
        await oldDocument?.delete();
      }
    } catch (error) {
      await replacement.delete().catch(() => {});
      throw error;
    }

    return actor.name;
  }

  static async exportAll() {
    if (!game.user.isGM) throw new Error("Export All is GM only.");
    const pack = this.pack();
    if (!pack) throw new Error("Actor Vault compendium not found.");
    const actors = this.managedActors();
    if (!actors.length) return { message: "No active actors were found in the Players folder." };

    const exported = [];
    const failed = [];
    for (const actor of actors) {
      try {
        exported.push(await this.exportOne(actor, pack));
      } catch (error) {
        console.error(`${AVC_MODULE_ID} | Export failed for ${actor.name}`, error);
        failed.push(`${actor.name}: ${error.message}`);
      }
    }

    const message = `Exported ${exported.length} actor${exported.length === 1 ? "" : "s"}.` +
      (failed.length ? ` ${failed.length} failed; see console.` : "");
    return { message, failed };
  }

  static async handleActivate(event, button, app) {
    event.preventDefault();
    event.stopImmediatePropagation();
    button.disabled = true;
    try {
      const result = await this.importStored(button.dataset.id);
      ui.notifications.info(result.message);
      await app.render({ force: true });
    } catch (error) {
      console.error(`${AVC_MODULE_ID} | Import failed`, error);
      ui.notifications.error(error.message);
      button.disabled = false;
    }
  }

  static enhance(app, element) {
    const root = element instanceof HTMLElement ? element : element?.[0] || app?.element;
    if (!root) return;

    for (const button of root.querySelectorAll('button[data-action="archive"]')) {
      if (!game.user.isGM) button.remove();
    }

    for (const button of root.querySelectorAll('button[data-action="activate"]')) {
      if (button.dataset.avcCheckoutBound) continue;
      button.dataset.avcCheckoutBound = "true";
      button.innerHTML = '<i class="fas fa-arrow-up-from-bracket"></i> Import';
      const row = button.closest("[data-pack-id]");
      const actorId = row?.dataset.packId;
      const pack = this.pack();
      const indexEntry = pack?.index?.get(actorId);
      const vaultId = indexEntry
        ? foundry.utils.getProperty(indexEntry, AVC_RECORD_PATH)?.vaultId
        : null;
      const duplicate = this.activeDuplicate(vaultId);
      if (duplicate) {
        button.disabled = true;
        button.title = `${duplicate.name} is already active.`;
        button.innerHTML = '<i class="fas fa-check"></i> Already Active';
      }
      button.addEventListener("click", event => this.handleActivate(event, button, app), true);
    }

    if (game.user.isGM) {
      const toolbar = root.querySelector(".actor-vault__toolbar");
      if (toolbar && !toolbar.querySelector("[data-avc-export-all]")) {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.avcExportAll = "true";
        button.innerHTML = '<i class="fas fa-box-archive"></i> Export All Active';
        button.addEventListener("click", async () => {
          button.disabled = true;
          try {
            const result = await this.exportAll();
            ui.notifications.info(result.message);
            await app.render({ force: true });
          } catch (error) {
            ui.notifications.error(error.message);
            button.disabled = false;
          }
        });
        toolbar.append(button);
      }
    }
  }
}

Hooks.on("renderApplicationV2", (app, element) => {
  if (app?.id === "actor-vault-app") {
    queueMicrotask(() => ActorVaultCheckoutFlow.enhance(app, element));
  }
});

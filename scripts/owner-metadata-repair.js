const AVOMR_MODULE_ID = "actor-vault";
const AVOMR_RECORD_PATH = "flags.actor-vault.record";
const AVOMR_PLAYERS_FOLDER = "Players";

class ActorVaultOwnerMetadataRepair {
  static playersFolder() {
    return game.folders.find(folder =>
      folder.type === "Actor" &&
      folder.name.trim().toLowerCase() === AVOMR_PLAYERS_FOLDER.toLowerCase()
    ) || null;
  }

  static managedFolderIds() {
    const root = this.playersFolder();
    if (!root) return new Set();
    return new Set([root.id, ...root.getSubfolders(true).map(folder => folder.id)]);
  }

  static isManagedActor(actor) {
    if (!actor?.folder) return false;
    return this.managedFolderIds().has(actor.folder.id);
  }

  static record(actor) {
    return foundry.utils.getProperty(actor, AVOMR_RECORD_PATH) || {};
  }

  static explicitOwners(actor) {
    const ownerLevel = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
    return [...game.users]
      .filter(user => user?.id && Number(actor.ownership?.[user.id]) === ownerLevel)
      .sort((a, b) => {
        if (a.isGM !== b.isGM) return a.isGM ? 1 : -1;
        return a.name.localeCompare(b.name);
      });
  }

  static resolvedOwner(actor) {
    const record = this.record(actor);
    const recorded = game.users.get(record.mainUserId);
    const explicit = this.explicitOwners(actor);

    if (explicit.length === 1) return explicit[0];
    if (recorded && explicit.some(user => user.id === recorded.id)) return recorded;
    if (!explicit.length && recorded) return recorded;
    return null;
  }

  static needsRepair(actor, owner) {
    if (!owner) return false;
    const record = this.record(actor);
    return !record.vaultId || record.mainUserId !== owner.id;
  }

  static async repairActor(actor, { quiet = true } = {}) {
    if (!game.user.isGM || !actor || !this.isManagedActor(actor)) return false;

    const owner = this.resolvedOwner(actor);
    if (!owner || !this.needsRepair(actor, owner)) return false;

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

    await actor.update({ [AVOMR_RECORD_PATH]: record });
    console.info(`${AVOMR_MODULE_ID} | Repaired owner metadata: ${actor.name} -> ${owner.name}`);
    if (!quiet) ui.notifications.info(`${actor.name}: Actor Vault owner metadata repaired for ${owner.name}.`);
    return true;
  }

  static async repairAll() {
    if (!game.user.isGM) return 0;
    const ids = this.managedFolderIds();
    if (!ids.size) return 0;

    let repaired = 0;
    for (const actor of game.actors) {
      if (!actor.folder || !ids.has(actor.folder.id)) continue;
      try {
        if (await this.repairActor(actor)) repaired += 1;
      } catch (error) {
        console.error(`${AVOMR_MODULE_ID} | Owner metadata repair failed for ${actor.name}`, error);
      }
    }

    if (repaired) {
      console.info(`${AVOMR_MODULE_ID} | Repaired owner metadata for ${repaired} managed actor${repaired === 1 ? "" : "s"}.`);
    }
    return repaired;
  }
}

globalThis.ActorVaultOwnerMetadataRepair = ActorVaultOwnerMetadataRepair;

Hooks.once("ready", async () => {
  await ActorVaultOwnerMetadataRepair.repairAll();
});

Hooks.on("createActor", actor => {
  if (!game.user.isGM) return;
  setTimeout(() => {
    ActorVaultOwnerMetadataRepair.repairActor(actor).catch(error =>
      console.error(`${AVOMR_MODULE_ID} | New actor owner metadata repair failed`, error)
    );
  }, 0);
});

Hooks.on("updateActor", (actor, changes) => {
  if (!game.user.isGM || !Object.prototype.hasOwnProperty.call(changes ?? {}, "ownership")) return;
  ActorVaultOwnerMetadataRepair.repairActor(actor).catch(error =>
    console.error(`${AVOMR_MODULE_ID} | Ownership-change metadata repair failed`, error)
  );
});

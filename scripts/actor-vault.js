const MODULE_ID = "actor-vault";
const SOCKET = `module.${MODULE_ID}`;
const PACK_SETTING = "packId";
const FLAG_KEY = "record";
const PLAYERS_FOLDER_NAME = "Players";
const RESOURCE_SCOPE = "world";
const RESOURCE_KEY = "metaResources";
const RESOURCE_HISTORY_KEY = "metaResourcesHistory";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

class ActorVaultApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "actor-vault-app",
    tag: "div",
    window: { title: "Actor Vault", icon: "fas fa-vault", resizable: true },
    position: { width: 980, height: 760 },
    actions: {
      archive: ActorVaultApp.archiveActor,
      activate: ActorVaultApp.activateActor,
      "save-resources": ActorVaultApp.saveResources
    }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/vault.hbs` }
  };

  selectedResourceUserId = "";

  async _prepareContext() {
    return ActorVault.buildContext(this.selectedResourceUserId);
  }

  _onRender(context, options) {
    super._onRender(context, options);

    const resourceUser = this.element.querySelector("select[data-resource-user]");
    resourceUser?.addEventListener("change", async event => {
      this.selectedResourceUserId = event.currentTarget.value;
      await this.render({ force: true });
    });

    if (!game.user.isGM) return;
    for (const select of this.element.querySelectorAll("select[data-owner-select]")) {
      select.addEventListener("change", async event => {
        const actorId = event.currentTarget.dataset.actorId;
        const ownerId = event.currentTarget.value;
        event.currentTarget.disabled = true;
        try {
          await ActorVault.setOwner(actorId, ownerId);
          ui.notifications.info("Primary owner updated.");
          await this.render({ force: true });
        } catch (error) {
          console.error(`${MODULE_ID} | Owner update failed`, error);
          ui.notifications.error(error.message);
          event.currentTarget.disabled = false;
        }
      });
    }
  }

  static async archiveActor(event, target) {
    const row = target.closest("[data-actor-id]");
    const ownerId = row?.querySelector("select[data-owner-select]")?.value || null;
    target.disabled = true;
    try {
      const result = await ActorVault.request("archive", { actorId: target.dataset.id, ownerId });
      ui.notifications.info(result.message);
      await this.render({ force: true });
    } catch (error) {
      console.error(`${MODULE_ID} | Archive failed`, error);
      ui.notifications.error(error.message);
      target.disabled = false;
    }
  }

  static async activateActor(event, target) {
    target.disabled = true;
    try {
      const result = await ActorVault.request("activate", { packActorId: target.dataset.id });
      ui.notifications.info(result.message);
      await this.render({ force: true });
    } catch (error) {
      console.error(`${MODULE_ID} | Activate failed`, error);
      ui.notifications.error(error.message);
      target.disabled = false;
    }
  }

  static async saveResources(event, target) {
    const form = target.closest("form[data-resource-form]");
    if (!form) return;
    target.disabled = true;
    const storage = [0, 1, 2, 3].map(i => String(form.elements[`s${i}`]?.value ?? "").trim());
    const data = {
      userId: form.dataset.userId,
      resources: {
        gold: Number(form.elements.gold?.value ?? 0),
        credits: Number(form.elements.credits?.value ?? 0),
        xp: Number(form.elements.xp?.value ?? 0),
        storage
      }
    };
    try {
      const result = await ActorVault.request("saveResources", data);
      ui.notifications.info(result.message);
      await this.render({ force: true });
    } catch (error) {
      console.error(`${MODULE_ID} | Resource save failed`, error);
      ui.notifications.error(error.message);
      target.disabled = false;
    }
  }
}

class ActorVault {
  static app;
  static pending = new Map();

  static registerSettings() {
    game.settings.register(MODULE_ID, PACK_SETTING, {
      name: "Actor Vault Pack ID",
      scope: "world",
      config: false,
      type: String,
      default: ""
    });
  }

  static async ready() {
    this.app = new ActorVaultApp();
    game.socket.on(SOCKET, payload => this.onSocket(payload));
    if (game.user.isGM) await this.ensurePack();
  }

  static open() { this.app.render({ force: true }); }

  static normalizeResources(stored) {
    const source = stored && typeof stored === "object" ? stored : {};
    const merged = foundry.utils.mergeObject(
      { gold: 0, credits: 0, xp: 0, storage: ["", "", "", ""] },
      source,
      { inplace: false }
    );
    merged.gold = Number(merged.gold) || 0;
    merged.credits = Number(merged.credits) || 0;
    merged.xp = Number(merged.xp) || 0;
    if (!Array.isArray(merged.storage)) merged.storage = [];
    merged.storage = [...merged.storage, "", "", "", ""]
      .slice(0, 4)
      .map(value => String(value ?? ""));
    return merged;
  }

  static getPack() {
    const collection = game.settings.get(MODULE_ID, PACK_SETTING);
    return collection ? game.packs.get(collection) : null;
  }

  static async ensurePack() {
    let pack = this.getPack();
    if (pack) return pack;
    pack = game.packs.find(candidate =>
      candidate.documentName === "Actor" && candidate.metadata?.label === "Actor Vault"
    );
    if (!pack) {
      pack = await foundry.documents.collections.CompendiumCollection.createCompendium({
        label: "Actor Vault",
        name: "actor-vault",
        type: "Actor",
        package: "world",
        system: game.system.id
      });
    }
    await game.settings.set(MODULE_ID, PACK_SETTING, pack.collection);
    return pack;
  }

  static getPlayersFolder() {
    return game.folders.find(folder =>
      folder.type === "Actor" &&
      folder.name.trim().toLowerCase() === PLAYERS_FOLDER_NAME.toLowerCase()
    ) || null;
  }

  static getManagedWorldFolderIds() {
    const root = this.getPlayersFolder();
    if (!root) return new Set();
    return new Set([root.id, ...root.getSubfolders(true).map(folder => folder.id)]);
  }

  static getManagedWorldActors() {
    const folderIds = this.getManagedWorldFolderIds();
    if (!folderIds.size) return [];
    return game.actors.filter(actor => actor.folder && folderIds.has(actor.folder.id));
  }

  static getRecord(document) { return document.getFlag?.(MODULE_ID, FLAG_KEY) || null; }

  static inferOwner(actor, preferredOwnerId = null) {
    const preferred = game.users.get(preferredOwnerId);
    if (preferred && !preferred.isGM) return preferred.id;
    return game.users
      .filter(user => !user.isGM && actor.testUserPermission(
        user,
        CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER,
        { exact: true }
      ))
      .sort((a, b) => a.name.localeCompare(b.name))[0]?.id || null;
  }

  static makeRecord(actor, ownerId) {
    const old = this.getRecord(actor);
    return {
      vaultId: old?.vaultId || foundry.utils.randomID(24),
      mainUserId: ownerId || old?.mainUserId || null,
      originalFolderId: actor.folder?.id || old?.originalFolderId || null,
      originalFolderName: actor.folder?.name || old?.originalFolderName || null,
      managedAt: old?.managedAt || Date.now(),
      updatedAt: Date.now()
    };
  }

  static ownershipFor(ownerId) {
    const ownership = { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED };
    if (ownerId) ownership[ownerId] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
    return ownership;
  }

  static async setOwner(actorId, ownerId) {
    if (!game.user.isGM) throw new Error("Only a GM can change the primary owner.");
    const actor = game.actors.get(actorId);
    if (!actor) throw new Error("Actor not found.");
    const owner = game.users.get(ownerId);
    if (!owner || owner.isGM) throw new Error("Select a valid player user.");
    const record = this.makeRecord(actor, ownerId);
    await actor.update({
      ownership: this.ownershipFor(ownerId),
      [`flags.${MODULE_ID}.${FLAG_KEY}`]: record
    });
  }

  static describeWorldActor(actor) {
    const existing = this.getRecord(actor);
    const ownerId = existing?.mainUserId || this.inferOwner(actor);
    return {
      id: actor.id,
      name: actor.name,
      img: actor.img || CONST.DEFAULT_TOKEN,
      type: actor.type,
      folderName: actor.folder?.name || PLAYERS_FOLDER_NAME,
      ownerId: ownerId || "",
      ownerName: game.users.get(ownerId)?.name || "Unassigned",
      record: existing || this.makeRecord(actor, ownerId)
    };
  }

  static describePackEntry(entry) {
    const record = foundry.utils.getProperty(entry, `flags.${MODULE_ID}.${FLAG_KEY}`) || null;
    return {
      id: entry._id,
      name: entry.name,
      img: entry.img || CONST.DEFAULT_TOKEN,
      type: entry.type,
      ownerId: record?.mainUserId || "",
      ownerName: game.users.get(record?.mainUserId)?.name || "Unassigned",
      record
    };
  }

  static group(entries, labelFor) {
    const map = new Map();
    for (const entry of entries) {
      const label = labelFor(entry) || "Unassigned";
      if (!map.has(label)) map.set(label, []);
      map.get(label).push(entry);
    }
    return [...map.entries()]
      .map(([name, actors]) => ({ name, actors: actors.sort((a, b) => a.name.localeCompare(b.name)) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  static async buildContext(selectedResourceUserId = "") {
    const userDocs = game.users.filter(user => !user.isGM).sort((a, b) => a.name.localeCompare(b.name));
    const resourceUser = game.user.isGM
      ? (game.users.get(selectedResourceUserId) || userDocs[0] || game.user)
      : game.user;
    const users = userDocs.map(user => ({
      id: user.id,
      name: user.name,
      selected: user.id === resourceUser.id
    }));

    let active = this.getManagedWorldActors().map(actor => this.describeWorldActor(actor));
    if (!game.user.isGM) active = active.filter(entry => entry.ownerId === game.user.id);

    let stored = [];
    const pack = this.getPack();
    if (pack) {
      const index = await pack.getIndex({ fields: ["name", "img", "type", `flags.${MODULE_ID}.${FLAG_KEY}`] });
      stored = index.map(entry => this.describePackEntry(entry)).filter(entry => entry.record?.vaultId);
      if (!game.user.isGM) stored = stored.filter(entry => entry.ownerId === game.user.id);
    }

    return {
      title: game.user.isGM ? "Actor Vault — GM" : "Actor Vault",
      isGM: game.user.isGM,
      playersFolderFound: Boolean(this.getPlayersFolder()),
      users,
      resourceUserId: resourceUser.id,
      resourceUserName: resourceUser.name,
      resources: this.normalizeResources(resourceUser.getFlag(RESOURCE_SCOPE, RESOURCE_KEY)),
      activeGroups: this.group(active, entry => game.user.isGM ? entry.folderName : "My Active Actors"),
      storedGroups: this.group(stored, entry => game.user.isGM ? entry.ownerName : "My Stored Actors"),
      activeCount: active.length,
      storedCount: stored.length
    };
  }

  static primaryGM() {
    return game.users.filter(user => user.active && user.isGM).sort((a, b) => a.id.localeCompare(b.id))[0] || null;
  }

  static async request(action, data) {
    if (game.user.isGM) return this.execute(action, data, game.user.id);
    if (!this.primaryGM()) throw new Error("Actor Vault requires an active GM.");
    const requestId = foundry.utils.randomID(20);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("Actor Vault request timed out."));
      }, 20000);
      this.pending.set(requestId, { resolve, reject, timeout });
      game.socket.emit(SOCKET, { kind: "request", requestId, action, data, requesterId: game.user.id });
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
      console.error(`${MODULE_ID} | Request failed`, error);
      response = { ok: false, error: error.message };
    }
    game.socket.emit(SOCKET, {
      kind: "response",
      requestId: payload.requestId,
      targetUserId: payload.requesterId,
      ...response
    });
  }

  static async execute(action, data, requesterId) {
    if (action === "archive") return this.archive(data.actorId, requesterId, data.ownerId);
    if (action === "activate") return this.activate(data.packActorId, requesterId);
    if (action === "saveResources") return this.saveResources(data.userId, data.resources, requesterId);
    throw new Error(`Unknown Actor Vault action: ${action}`);
  }

  static assertAuthorized(record, requesterId) {
    const requester = game.users.get(requesterId);
    if (!requester) throw new Error("Requesting user no longer exists.");
    if (!requester.isGM && record.mainUserId !== requesterId) {
      throw new Error("You may only move actors assigned to you.");
    }
  }

  static async saveResources(userId, resources, requesterId) {
    const requester = game.users.get(requesterId);
    const target = game.users.get(userId);
    if (!requester || !target) throw new Error("User not found.");
    if (!requester.isGM && requester.id !== target.id) {
      throw new Error("You may only edit your own dashboard resources.");
    }
    const next = this.normalizeResources(resources);
    await target.setFlag(RESOURCE_SCOPE, RESOURCE_KEY, next);
    const existingHistory = target.getFlag(RESOURCE_SCOPE, RESOURCE_HISTORY_KEY);
    const history = Array.isArray(existingHistory) ? [...existingHistory] : [];
    history.unshift({ timestamp: Date.now(), editorUserId: requester.id, state: foundry.utils.deepClone(next) });
    await target.setFlag(RESOURCE_SCOPE, RESOURCE_HISTORY_KEY, history.slice(0, 30));
    return { message: `${target.name}'s dashboard updated.` };
  }

  static async ensureVaultFolders(pack, owner) {
    let root = pack.folders.find(folder => folder.name === PLAYERS_FOLDER_NAME && !folder.folder);
    if (!root) {
      root = await Folder.create({ name: PLAYERS_FOLDER_NAME, type: "Actor", folder: null }, { pack: pack.collection });
    }
    let ownerFolder = pack.folders.find(folder =>
      folder.name === owner.name && (folder.folder?.id || folder.folder) === root.id
    );
    if (!ownerFolder) {
      ownerFolder = await Folder.create(
        { name: owner.name, type: "Actor", folder: root.id },
        { pack: pack.collection }
      );
    }
    return ownerFolder;
  }

  static findRestoreFolder(record, owner) {
    const original = record.originalFolderId && game.folders.get(record.originalFolderId);
    if (original?.type === "Actor") return original;
    const players = this.getPlayersFolder();
    if (!players) return null;
    return players.getSubfolders(true).find(folder =>
      folder.name.trim().toLowerCase() === owner.name.trim().toLowerCase()
    ) || players;
  }

  static async archive(actorId, requesterId, chosenOwnerId = null) {
    const actor = game.actors.get(actorId);
    if (!actor) throw new Error("The world actor no longer exists.");
    const managedIds = this.getManagedWorldFolderIds();
    if (!actor.folder || !managedIds.has(actor.folder.id)) {
      throw new Error(`Only actors inside the ${PLAYERS_FOLDER_NAME} folder can be archived.`);
    }
    const requester = game.users.get(requesterId);
    const ownerId = requester?.isGM
      ? (chosenOwnerId || this.getRecord(actor)?.mainUserId || this.inferOwner(actor))
      : (this.getRecord(actor)?.mainUserId || this.inferOwner(actor));
    const owner = game.users.get(ownerId);
    if (!owner || owner.isGM) throw new Error("Assign a valid player as the primary owner first.");
    const record = this.makeRecord(actor, owner.id);
    this.assertAuthorized(record, requesterId);

    const linked = [];
    for (const scene of game.scenes) {
      for (const token of scene.tokens) {
        if (token.actorLink && token.actorId === actor.id) linked.push(`${scene.name}: ${token.name}`);
      }
    }
    if (linked.length) throw new Error(`Remove linked scene tokens before archiving: ${linked.join(", ")}`);

    const inCombat = [...game.combats].some(combat =>
      [...combat.combatants].some(combatant => combatant.actorId === actor.id)
    );
    if (inCombat) throw new Error("Remove this actor from combat before archiving.");

    const pack = await this.ensurePack();
    const index = await pack.getIndex({ fields: [`flags.${MODULE_ID}.${FLAG_KEY}.vaultId`] });
    if (index.find(entry =>
      foundry.utils.getProperty(entry, `flags.${MODULE_ID}.${FLAG_KEY}.vaultId`) === record.vaultId
    )) throw new Error("A stored copy of this actor already exists.");

    const vaultFolder = await this.ensureVaultFolders(pack, owner);
    const data = actor.toObject();
    delete data._id;
    data.folder = vaultFolder.id;
    data.ownership = this.ownershipFor(owner.id);
    foundry.utils.setProperty(data, `flags.${MODULE_ID}.${FLAG_KEY}`, record);
    const [stored] = await Actor.implementation.createDocuments([data], { pack: pack.collection, keepId: false });
    if (!stored) throw new Error("The compendium copy could not be created. The world actor was not deleted.");
    try {
      if (owner.character?.id === actor.id) await owner.update({ character: null });
      await actor.delete();
    } catch (error) {
      await stored.delete();
      throw new Error("The world actor could not be deleted, so the vault copy was rolled back.");
    }
    return { message: `${actor.name} archived to ${PLAYERS_FOLDER_NAME} → ${owner.name}.` };
  }

  static async activate(packActorId, requesterId) {
    const pack = await this.ensurePack();
    const stored = await pack.getDocument(packActorId);
    if (!stored) throw new Error("The stored actor no longer exists.");
    const record = this.getRecord(stored);
    if (!record?.vaultId || !record.mainUserId) throw new Error("This vault entry is missing ownership metadata.");
    this.assertAuthorized(record, requesterId);
    const duplicate = game.actors.find(actor => this.getRecord(actor)?.vaultId === record.vaultId);
    if (duplicate) throw new Error(`${duplicate.name} is already active in the world.`);
    const owner = game.users.get(record.mainUserId);
    if (!owner || owner.isGM) throw new Error("The stored actor's primary player no longer exists.");

    const data = stored.toObject();
    delete data._id;
    data.folder = this.findRestoreFolder(record, owner)?.id || null;
    data.ownership = this.ownershipFor(owner.id);
    foundry.utils.setProperty(data, `flags.${MODULE_ID}.${FLAG_KEY}`, { ...record, updatedAt: Date.now() });
    const [actor] = await Actor.implementation.createDocuments([data], { keepId: false });
    if (!actor) throw new Error("The world actor could not be created. The vault entry was not deleted.");
    try {
      await stored.delete();
    } catch (error) {
      await actor.delete();
      throw new Error("The vault entry could not be deleted, so the world copy was rolled back.");
    }
    if (!owner.character) await owner.update({ character: actor.id });
    return { message: `${actor.name} activated for ${owner.name}.` };
  }
}

Hooks.once("init", () => ActorVault.registerSettings());
Hooks.once("ready", () => ActorVault.ready());

Hooks.on("renderActorDirectory", (app, html) => {
  const root = html instanceof HTMLElement ? html : html[0];
  if (!root || root.querySelector(".actor-vault-open")) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "actor-vault-open";
  button.innerHTML = '<i class="fas fa-vault"></i><span>Actor Vault</span>';
  button.addEventListener("click", () => ActorVault.open());
  const header = root.querySelector(".directory-header .header-actions") || root.querySelector(".directory-header");
  header?.append(button);
});

for (const hook of ["updateActor", "createActor", "deleteActor", "updateUser"]) {
  Hooks.on(hook, () => ActorVault.app?.rendered && ActorVault.app.render({ force: true }));
}
Hooks.on("updateCompendium", pack => {
  if (pack.collection === ActorVault.getPack()?.collection && ActorVault.app?.rendered) {
    ActorVault.app.render({ force: true });
  }
});
Handlebars.registerHelper("eq", (a, b) => a === b);

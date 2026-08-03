const MODULE_ID = "actor-vault";
const SOCKET = `module.${MODULE_ID}`;
const PACK_SETTING = "packId";
const FLAG_SCOPE = MODULE_ID;
const FLAG_KEY = "record";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

class ActorVaultApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "actor-vault-app",
    tag: "div",
    window: { title: "Actor Vault", icon: "fas fa-vault", resizable: true },
    position: { width: 900, height: 650 },
    actions: {
      archive: ActorVaultApp.#archive,
      activate: ActorVaultApp.#activate,
      "filter-owner": ActorVaultApp.#filterOwner
    }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/vault.hbs` }
  };

  selectedOwner = "";

  async _prepareContext() {
    const pack = ActorVault.getPack();
    const users = game.users
      .filter(u => !u.isGM)
      .map(u => ({ id: u.id, name: u.name, selected: u.id === this.selectedOwner }));

    const canSee = record => game.user.isGM || record?.mainUserId === game.user.id;
    const active = game.actors
      .map(actor => ActorVault.describeWorldActor(actor))
      .filter(entry => canSee(entry.record))
      .filter(entry => !this.selectedOwner || entry.ownerId === this.selectedOwner)
      .sort((a,b) => a.name.localeCompare(b.name));

    let stored = [];
    if (pack) {
      const index = await pack.getIndex({ fields: ["name", "img", "type", `flags.${FLAG_SCOPE}.${FLAG_KEY}`] });
      stored = index.map(entry => ActorVault.describePackEntry(entry))
        .filter(entry => canSee(entry.record))
        .filter(entry => !this.selectedOwner || entry.ownerId === this.selectedOwner)
        .sort((a,b) => a.name.localeCompare(b.name));
    }

    return {
      title: game.user.isGM ? "Actor Vault — GM" : "Actor Vault",
      isGM: game.user.isGM,
      users,
      active,
      stored
    };
  }

  static async #archive(event, target) {
    const actorId = target.dataset.id;
    const ownerSelect = this.element.querySelector(`[data-owner-for="${actorId}"]`);
    await ActorVault.request("archive", { actorId, ownerId: ownerSelect?.value || null });
    await this.render({ force: true });
  }

  static async #activate(event, target) {
    await ActorVault.request("activate", { packActorId: target.dataset.id });
    await this.render({ force: true });
  }

  static async #filterOwner(event, target) {
    this.selectedOwner = target.value;
    await this.render({ force: true });
  }
}

class ActorVault {
  static app;

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
    game.socket.on(SOCKET, (payload, ack) => this.#onSocket(payload, ack));
    if (game.user.isGM) await this.ensurePack();
  }

  static getPack() {
    const id = game.settings.get(MODULE_ID, PACK_SETTING);
    return id ? game.packs.get(id) : null;
  }

  static async ensurePack() {
    let pack = this.getPack();
    if (pack) return pack;

    pack = game.packs.find(p => p.documentName === "Actor" && p.metadata?.label === "Actor Vault");
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
    try {
      await pack.configure({
        ownership: {
          PLAYER: CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED,
          TRUSTED: CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED,
          ASSISTANT: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER,
          GAMEMASTER: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER
        }
      });
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not set pack ownership automatically`, err);
    }
    return pack;
  }

  static open() { this.app.render({ force: true }); }

  static describeWorldActor(actor) {
    const record = this.getRecord(actor) || this.inferRecord(actor);
    return {
      id: actor.id,
      name: actor.name,
      img: actor.img || CONST.DEFAULT_TOKEN,
      type: actor.type,
      record,
      ownerId: record?.mainUserId || "",
      ownerName: game.users.get(record?.mainUserId)?.name || "Unassigned"
    };
  }

  static describePackEntry(entry) {
    const record = foundry.utils.getProperty(entry, `flags.${FLAG_SCOPE}.${FLAG_KEY}`) || null;
    return {
      id: entry._id,
      name: entry.name,
      img: entry.img || CONST.DEFAULT_TOKEN,
      type: entry.type,
      record,
      ownerId: record?.mainUserId || "",
      ownerName: game.users.get(record?.mainUserId)?.name || "Unassigned"
    };
  }

  static getRecord(document) { return document.getFlag?.(FLAG_SCOPE, FLAG_KEY) || null; }

  static inferRecord(actor, preferredOwnerId = null) {
    const ownerId = preferredOwnerId || game.users
      .filter(u => !u.isGM && actor.testUserPermission(u, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER, { exact: true }))
      .sort((a,b) => a.id.localeCompare(b.id))[0]?.id || null;
    return {
      vaultId: foundry.utils.randomID(24),
      mainUserId: ownerId,
      originalFolderName: actor.folder?.name || null,
      managedAt: Date.now()
    };
  }

  static ownershipFor(mainUserId) {
    const ownership = { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED };
    if (mainUserId) ownership[mainUserId] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
    return ownership;
  }

  static async request(action, data) {
    if (game.user.isGM) return this.#execute(action, data, game.user.id);
    const gm = this.primaryGM();
    if (!gm) return ui.notifications.error("Actor Vault requires an active GM.");

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Actor Vault request timed out.")), 15000);
      game.socket.emit(SOCKET, { action, data, requesterId: game.user.id }, response => {
        clearTimeout(timeout);
        if (response?.ok) {
          ui.notifications.info(response.message);
          resolve(response);
        } else {
          const message = response?.error || "Actor Vault request failed.";
          ui.notifications.error(message);
          reject(new Error(message));
        }
      });
    });
  }

  static primaryGM() {
    return game.users.filter(u => u.active && u.isGM).sort((a,b) => a.id.localeCompare(b.id))[0] || null;
  }

  static async #onSocket(payload, ack) {
    if (!game.user.isGM || game.user.id !== this.primaryGM()?.id) return;
    try {
      const result = await this.#execute(payload.action, payload.data, payload.requesterId);
      ack?.({ ok: true, ...result });
    } catch (err) {
      console.error(`${MODULE_ID} | Socket operation failed`, err);
      ack?.({ ok: false, error: err.message });
    }
  }

  static async #execute(action, data, requesterId) {
    if (action === "archive") return this.archive(data.actorId, requesterId, data.ownerId);
    if (action === "activate") return this.activate(data.packActorId, requesterId);
    throw new Error(`Unknown Actor Vault action: ${action}`);
  }

  static assertAuthorized(record, requesterId) {
    const requester = game.users.get(requesterId);
    if (!requester) throw new Error("Requesting user no longer exists.");
    if (!requester.isGM && record?.mainUserId !== requesterId) {
      throw new Error("You may only move actors assigned to you.");
    }
  }

  static async archive(actorId, requesterId, chosenOwnerId = null) {
    const actor = game.actors.get(actorId);
    if (!actor) throw new Error("The world actor no longer exists.");

    let record = this.getRecord(actor) || this.inferRecord(actor, chosenOwnerId);
    if (game.users.get(requesterId)?.isGM && chosenOwnerId) record.mainUserId = chosenOwnerId;
    this.assertAuthorized(record, requesterId);
    if (!record.mainUserId) throw new Error("Assign a primary player owner before archiving this actor.");

    const linked = game.scenes.flatMap(scene => scene.tokens
      .filter(token => token.actorLink && token.actorId === actor.id)
      .map(token => `${scene.name}: ${token.name}`));
    if (linked.length) throw new Error(`Remove linked scene tokens before archiving: ${linked.join(", ")}`);

    const inCombat = game.combats.some(combat => combat.combatants.some(c => c.actorId === actor.id));
    if (inCombat) throw new Error("Remove this actor from combat before archiving.");

    const pack = await this.ensurePack();
    const index = await pack.getIndex({ fields: [`flags.${FLAG_SCOPE}.${FLAG_KEY}.vaultId`] });
    const duplicate = index.find(e => foundry.utils.getProperty(e, `flags.${FLAG_SCOPE}.${FLAG_KEY}.vaultId`) === record.vaultId);
    if (duplicate) throw new Error("A stored copy of this actor already exists.");

    const data = actor.toObject();
    delete data._id;
    data.folder = null;
    data.ownership = this.ownershipFor(record.mainUserId);
    foundry.utils.setProperty(data, `flags.${FLAG_SCOPE}.${FLAG_KEY}`, record);

    const [stored] = await Actor.implementation.createDocuments([data], { pack: pack.collection, keepId: false });
    if (!stored) throw new Error("The compendium copy could not be created; the world actor was not deleted.");

    const owner = game.users.get(record.mainUserId);
    if (owner?.character?.id === actor.id) await owner.update({ character: null });
    await actor.delete();
    ui.notifications.info(`${actor.name} archived to Actor Vault.`);
    return { message: `${actor.name} archived.` };
  }

  static async activate(packActorId, requesterId) {
    const pack = await this.ensurePack();
    const stored = await pack.getDocument(packActorId);
    if (!stored) throw new Error("The stored actor no longer exists.");

    const record = this.getRecord(stored);
    if (!record?.vaultId || !record.mainUserId) throw new Error("This vault entry is missing Actor Vault ownership metadata.");
    this.assertAuthorized(record, requesterId);

    const duplicate = game.actors.find(a => this.getRecord(a)?.vaultId === record.vaultId);
    if (duplicate) throw new Error(`${duplicate.name} is already active in the world.`);

    const data = stored.toObject();
    delete data._id;
    data.folder = null;
    data.ownership = this.ownershipFor(record.mainUserId);
    foundry.utils.setProperty(data, `flags.${FLAG_SCOPE}.${FLAG_KEY}`, record);

    const [actor] = await Actor.implementation.createDocuments([data], { keepId: false });
    if (!actor) throw new Error("The world actor could not be created; the vault entry was not deleted.");

    try {
      await stored.delete();
    } catch (err) {
      await actor.delete();
      throw new Error("Could not delete the vault entry, so the new world copy was rolled back.");
    }

    const owner = game.users.get(record.mainUserId);
    if (owner && !owner.character) await owner.update({ character: actor.id });
    ui.notifications.info(`${actor.name} activated from Actor Vault.`);
    return { message: `${actor.name} activated.` };
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
  button.innerHTML = '<i class="fas fa-vault"></i> Actor Vault';
  button.addEventListener("click", () => ActorVault.open());
  const header = root.querySelector(".directory-header .header-actions") || root.querySelector(".directory-header");
  header?.append(button);
});

Hooks.on("updateActor", () => ActorVault.app?.rendered && ActorVault.app.render({ force: true }));
Hooks.on("createActor", () => ActorVault.app?.rendered && ActorVault.app.render({ force: true }));
Hooks.on("deleteActor", () => ActorVault.app?.rendered && ActorVault.app.render({ force: true }));
Hooks.on("updateCompendium", pack => {
  if (pack.collection === ActorVault.getPack()?.collection && ActorVault.app?.rendered) ActorVault.app.render({ force: true });
});

Handlebars.registerHelper("eq", (a, b) => a === b);

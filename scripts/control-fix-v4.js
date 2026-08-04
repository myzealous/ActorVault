const AVF_MODULE_ID = "actor-vault";
const AVF_RECORD_PATH = "flags.actor-vault.record";
const AVF_SCOPE = "world";
const AVF_RESOURCE_KEY = "metaResources";
const AVF_HISTORY_KEY = "metaResourcesHistory";

class ActorVaultControlFixV4 {
  static root(element, app) {
    return element instanceof HTMLElement ? element : element?.[0] || app?.element || null;
  }

  static pack() {
    return game.packs.get(game.settings.get(AVF_MODULE_ID, "packId"));
  }

  static record(actor) {
    return foundry.utils.getProperty(actor, AVF_RECORD_PATH) || {};
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

  static housingName(tier) {
    return ["None", "Homestead", "House", "Manor", "Estate"][Math.max(0, Math.min(4, Number(tier) || 0))];
  }

  static async openHistory(initialUserId) {
    const users = game.user.isGM
      ? game.users.filter(user => !user.isGM).sort((a, b) => a.name.localeCompare(b.name))
      : [game.user];
    if (!users.length) return ui.notifications.warn("No player users found.");

    const selectedId = users.some(user => user.id === initialUserId) ? initialUserId : users[0].id;
    const options = users.map(user => `<option value="${foundry.utils.escapeHTML(user.id)}" ${user.id === selectedId ? "selected" : ""}>${foundry.utils.escapeHTML(user.name)}</option>`).join("");

    const dialog = new foundry.applications.api.DialogV2({
      window: { title: game.user.isGM ? "Resource History" : "My Resource History", resizable: true },
      position: { width: 920, height: 680 },
      content: `<section class="avd-history"><label>Player<select data-avf-history-user ${game.user.isGM ? "" : "disabled"}>${options}</select></label><div data-avf-history-log></div></section>`,
      buttons: [{ action: "close", label: "Close", default: true }]
    });
    await dialog.render({ force: true });

    const select = dialog.element.querySelector("[data-avf-history-user]");
    const log = dialog.element.querySelector("[data-avf-history-log]");
    const draw = () => {
      const user = game.users.get(select.value);
      const history = user?.getFlag(AVF_SCOPE, AVF_HISTORY_KEY) || [];
      if (!history.length) {
        log.innerHTML = "<p>No resource history recorded.</p>";
        return;
      }
      log.innerHTML = `<table><thead><tr><th>Date</th><th>Editor</th><th>Housing</th><th>Gold</th><th>Credits</th><th>XP</th><th>Storage</th></tr></thead><tbody>${history.map(entry => {
        const state = entry?.state || {};
        const storage = Array.isArray(state.storage) ? state.storage.filter(Boolean).join(", ") : "";
        return `<tr><td>${new Date(entry.timestamp).toLocaleString()}</td><td>${foundry.utils.escapeHTML(game.users.get(entry.editorUserId)?.name || "Unknown")}</td><td>${this.housingName(state.housingTier)}</td><td>${Number(state.gold) || 0}</td><td>${Number(state.credits) || 0}</td><td>${Number(state.xp) || 0}</td><td>${foundry.utils.escapeHTML(storage || "—")}</td></tr>`;
      }).join("")}</tbody></table>`;
    };
    select.addEventListener("change", draw);
    draw();
  }

  static bindHistory(root) {
    const oldButton = root.querySelector("[data-history-button]");
    if (!oldButton || oldButton.dataset.avfBound === "true") return;
    const button = oldButton.cloneNode(true);
    button.dataset.avfBound = "true";
    oldButton.replaceWith(button);
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const userId = root.querySelector("form[data-resource-form]")?.dataset.userId || game.user.id;
      this.openHistory(userId).catch(error => {
        console.error(`${AVF_MODULE_ID} | History failed`, error);
        ui.notifications.error(error.message);
      });
    }, true);
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

    const index = await pack.getIndex({ fields: [AVF_RECORD_PATH] });
    const previous = index.find(entry => foundry.utils.getProperty(entry, AVF_RECORD_PATH)?.vaultId === record.vaultId);
    const folder = await this.ensureVaultFolders(pack, owner);
    const data = actor.toObject();
    delete data._id;
    data.folder = folder.id;
    data.ownership = this.ownership(owner.id);
    foundry.utils.setProperty(data, AVF_RECORD_PATH, record);

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
      let oldButton = row.querySelector('button[data-action="archive"]');
      if (!oldButton) {
        oldButton = document.createElement("button");
        oldButton.type = "button";
        oldButton.className = "avd-primary-action";
        oldButton.dataset.action = "archive";
        oldButton.dataset.id = row.dataset.actorId;
        row.append(oldButton);
      }
      if (oldButton.dataset.avfBound === "true") continue;
      const button = oldButton.cloneNode(false);
      button.type = "button";
      button.className = "avd-primary-action";
      button.dataset.action = "archive";
      button.dataset.id = row.dataset.actorId;
      button.dataset.avfBound = "true";
      button.innerHTML = '<i class="fas fa-box-archive"></i> Export';
      oldButton.replaceWith(button);
      button.addEventListener("click", async event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        const actor = game.actors.get(row.dataset.actorId);
        if (!actor) return ui.notifications.error("Actor not found.");
        button.disabled = true;
        try {
          const name = await this.exportOne(actor);
          ui.notifications.info(`${name} exported to the vault.`);
          await app.render({ force: true });
        } catch (error) {
          console.error(`${AVF_MODULE_ID} | Individual export failed`, error);
          ui.notifications.error(error.message);
          button.disabled = false;
        }
      }, true);
    }
  }

  static enhance(app, element) {
    const root = this.root(element, app);
    if (!root) return;
    this.bindHistory(root);
    this.bindExports(app, root);
  }
}

Hooks.on("renderApplicationV2", (app, element) => {
  if (app?.id !== "actor-vault-app") return;
  for (const delay of [0, 100, 300]) setTimeout(() => ActorVaultControlFixV4.enhance(app, element), delay);
});

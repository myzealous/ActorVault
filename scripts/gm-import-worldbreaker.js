const AVGI_MODULE_ID = "actor-vault";
const AVGI_RECORD_PATH = "flags.actor-vault.record";
const AVGI_PLAYERS_FOLDER = "Players";

class ActorVaultGMImportWorldbreaker {
  static root(element, app) {
    return element instanceof HTMLElement ? element : element?.[0] || app?.element || null;
  }

  static pack() {
    return game.packs.get(game.settings.get(AVGI_MODULE_ID, "packId"));
  }

  static record(document) {
    return foundry.utils.getProperty(document, AVGI_RECORD_PATH) || {};
  }

  static ownership(ownerId) {
    return {
      default: CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED,
      ...(ownerId ? { [ownerId]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER } : {})
    };
  }

  static playersFolder() {
    return game.folders.find(folder =>
      folder.type === "Actor" && folder.name.trim().toLowerCase() === AVGI_PLAYERS_FOLDER.toLowerCase()
    ) || null;
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
    if (!vaultId) return null;
    return game.actors.find(actor => this.record(actor).vaultId === vaultId) || null;
  }

  static async importStored(pack, packActorId) {
    const stored = await pack.getDocument(packActorId);
    if (!stored) throw new Error("Stored actor not found.");

    const record = this.record(stored);
    if (!record.vaultId || !record.mainUserId) throw new Error(`${stored.name} is missing vault metadata.`);
    if (this.activeDuplicate(record.vaultId)) return { skipped: true, name: stored.name };

    const owner = game.users.get(record.mainUserId);
    if (!owner) throw new Error(`${stored.name}'s assigned owner no longer exists.`);

    const data = stored.toObject();
    delete data._id;
    data.folder = this.restoreFolder(record, owner)?.id || null;
    data.ownership = this.ownership(owner.id);
    foundry.utils.setProperty(data, AVGI_RECORD_PATH, {
      ...record,
      checkedOutAt: Date.now(),
      updatedAt: Date.now()
    });

    const [actor] = await Actor.implementation.createDocuments([data], { keepId: false });
    if (!actor) throw new Error(`${stored.name} could not be imported.`);
    return { skipped: false, name: actor.name };
  }

  static async importAll(button, app) {
    if (!game.user.isGM) return;
    const pack = this.pack();
    if (!pack) throw new Error("Actor Vault compendium not found.");

    button.disabled = true;
    let imported = 0;
    let skipped = 0;
    const failed = [];

    try {
      const index = await pack.getIndex({ fields: ["name", AVGI_RECORD_PATH] });
      const entries = index.filter(entry => foundry.utils.getProperty(entry, AVGI_RECORD_PATH)?.vaultId);

      for (const entry of entries) {
        try {
          const result = await this.importStored(pack, entry._id);
          if (result.skipped) skipped += 1;
          else imported += 1;
        } catch (error) {
          console.error(`${AVGI_MODULE_ID} | Import All failed for ${entry.name}`, error);
          failed.push(entry.name);
        }
      }

      ui.notifications.info(
        `Import All: ${imported} imported, ${skipped} already active${failed.length ? `, ${failed.length} failed` : ""}.`
      );
      await app.render({ force: true });
    } catch (error) {
      ui.notifications.error(error.message);
      button.disabled = false;
    }
  }

  static actorLevel(actor) {
    return [...actor.items]
      .filter(item => item.type === "class")
      .reduce((total, item) => total + (Number(item.system?.levels ?? item.system?.level ?? 0) || 0), 0);
  }

  static worldbreakerOptions(selected) {
    return [0, 1, 2, 3].map(value =>
      `<option value="${value}" ${value === selected ? "selected" : ""}>${value ? `Tier ${value}` : "None"}</option>`
    ).join("");
  }

  static bindWorldbreaker(root) {
    if (!game.user.isGM) return;
    for (const row of root.querySelectorAll("[data-actor-id]")) {
      const actor = game.actors.get(row.dataset.actorId);
      const slot = row.querySelector("[data-progression-slot]");
      if (!actor || !slot || this.actorLevel(actor) <= 0) continue;

      const record = this.record(actor);
      const selected = Math.max(0, Math.min(3, Math.trunc(Number(record.worldbreakerTier) || 0)));
      slot.innerHTML = `<label><span>Worldbreaker</span><select data-avgi-worldbreaker>${this.worldbreakerOptions(selected)}</select></label>`;
      const select = slot.querySelector("select[data-avgi-worldbreaker]");
      select.addEventListener("change", async () => {
        select.disabled = true;
        try {
          const tier = Math.max(0, Math.min(3, Math.trunc(Number(select.value) || 0)));
          await actor.update({
            [AVGI_RECORD_PATH]: {
              ...this.record(actor),
              worldbreakerTier: tier,
              level: this.actorLevel(actor),
              updatedAt: Date.now()
            }
          });
          ui.notifications.info(`${actor.name}'s Worldbreaker tier is now ${tier || "None"}.`);
          select.disabled = false;
        } catch (error) {
          ui.notifications.error(error.message);
          select.value = String(selected);
          select.disabled = false;
        }
      });
    }
  }

  static addImportAll(app, root) {
    if (!game.user.isGM) return;
    const toolbar = root.querySelector(".actor-vault__toolbar");
    if (!toolbar || toolbar.querySelector("[data-avgi-import-all]")) return;

    const button = document.createElement("button");
    button.type = "button";
    button.dataset.avgiImportAll = "true";
    button.innerHTML = '<i class="fas fa-arrow-up-from-bracket"></i> Import All Stored';
    button.addEventListener("click", () => this.importAll(button, app));

    const exportAll = toolbar.querySelector("[data-avc-export-all]");
    toolbar.insertBefore(button, exportAll || null);
  }

  static enhance(app, element) {
    const root = this.root(element, app);
    if (!root) return;
    this.addImportAll(app, root);
    this.bindWorldbreaker(root);
  }
}

Hooks.on("renderApplicationV2", (app, element) => {
  if (app?.id !== "actor-vault-app") return;
  for (const delay of [0, 100, 300]) {
    setTimeout(() => ActorVaultGMImportWorldbreaker.enhance(app, element), delay);
  }
});

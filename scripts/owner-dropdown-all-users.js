const AVOD_MODULE_ID = "actor-vault";
const AVOD_RECORD_PATH = "flags.actor-vault.record";

class ActorVaultOwnerDropdownAllUsers {
  static observer = null;
  static repairQueued = false;

  static users() {
    return [...game.users]
      .filter(user => user?.id)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  static record(actor) {
    return foundry.utils.getProperty(actor, AVOD_RECORD_PATH) || {};
  }

  static ownership(ownerId) {
    return {
      default: CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED,
      [ownerId]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER
    };
  }

  static async assign(actor, ownerId) {
    if (!game.user.isGM) throw new Error("Only a GM may assign actor ownership.");

    const owner = game.users.get(ownerId);
    if (!owner) throw new Error("The selected Foundry user no longer exists.");

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
      [AVOD_RECORD_PATH]: record
    });
  }

  static hasAllUsers(select) {
    const optionIds = new Set([...select.options].map(option => option.value));
    return this.users().every(user => optionIds.has(user.id));
  }

  static rebuildSelect(select, actor) {
    const currentOwnerId = this.record(actor).mainUserId || select.value || "";
    const replacement = select.cloneNode(false);

    for (const attribute of select.attributes) {
      replacement.setAttribute(attribute.name, attribute.value);
    }

    replacement.dataset.ownerSelect = "true";
    replacement.dataset.actorId = actor.id;
    replacement.dataset.avodBound = "true";

    const unassigned = document.createElement("option");
    unassigned.value = "";
    unassigned.textContent = "Unassigned";
    replacement.append(unassigned);

    for (const user of this.users()) {
      const option = document.createElement("option");
      option.value = user.id;
      option.textContent = user.name;
      option.selected = user.id === currentOwnerId;
      replacement.append(option);
    }

    select.replaceWith(replacement);

    replacement.addEventListener("change", async event => {
      event.preventDefault();
      event.stopImmediatePropagation();

      const ownerId = replacement.value;
      if (!ownerId) {
        ui.notifications.warn("Select a Foundry user as the actor owner.");
        replacement.value = currentOwnerId;
        return;
      }

      replacement.disabled = true;
      try {
        await this.assign(actor, ownerId);
        ui.notifications.info(`${actor.name} is now assigned to ${game.users.get(ownerId)?.name}.`);
        const app = foundry.applications.instances.get("actor-vault-app");
        await app?.render({ force: true });
      } catch (error) {
        console.error(`${AVOD_MODULE_ID} | Owner assignment failed`, error);
        ui.notifications.error(error.message);
        replacement.value = currentOwnerId;
        replacement.disabled = false;
      }
    }, true);
  }

  static repair() {
    if (!game.user.isGM) return;

    const root = document.querySelector("#actor-vault-app");
    if (!root) return;

    for (const select of root.querySelectorAll("select[data-owner-select]")) {
      if (this.hasAllUsers(select) && select.dataset.avodBound === "true") continue;

      const row = select.closest("[data-actor-id]");
      const actorId = select.dataset.actorId || row?.dataset.actorId;
      const actor = game.actors.get(actorId);
      if (!actor) continue;

      this.rebuildSelect(select, actor);
    }
  }

  static queueRepair() {
    if (this.repairQueued) return;
    this.repairQueued = true;
    queueMicrotask(() => {
      this.repairQueued = false;
      this.repair();
    });
  }

  static watch() {
    if (!game.user.isGM) return;

    this.observer?.disconnect();
    this.observer = new MutationObserver(() => this.queueRepair());
    this.observer.observe(document.body, { childList: true, subtree: true });

    for (const delay of [0, 50, 150, 350, 750, 1500]) {
      setTimeout(() => this.repair(), delay);
    }
  }
}

Hooks.once("ready", () => ActorVaultOwnerDropdownAllUsers.watch());

Hooks.on("renderApplicationV2", app => {
  if (app?.id !== "actor-vault-app") return;
  ActorVaultOwnerDropdownAllUsers.queueRepair();
  for (const delay of [50, 150, 350, 750]) {
    setTimeout(() => ActorVaultOwnerDropdownAllUsers.repair(), delay);
  }
});

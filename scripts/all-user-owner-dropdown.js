const AVU_MODULE_ID = "actor-vault";
const AVU_RECORD_PATH = "flags.actor-vault.record";

class ActorVaultAllUserOwnerDropdown {
  static root(element, app) {
    return element instanceof HTMLElement ? element : element?.[0] || app?.element || null;
  }

  static users() {
    return [...game.users]
      .filter(user => user?.id)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  static record(actor) {
    return foundry.utils.getProperty(actor, AVU_RECORD_PATH) || {};
  }

  static ownership(ownerId) {
    return {
      default: CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED,
      [ownerId]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER
    };
  }

  static async assign(actor, ownerId) {
    if (!game.user.isGM) throw new Error("Only a GM may change the primary owner.");

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
      [AVU_RECORD_PATH]: record
    });
  }

  static enhance(app, element) {
    if (!game.user.isGM) return;

    const root = this.root(element, app);
    if (!root) return;

    for (const oldSelect of root.querySelectorAll("select[data-owner-select]")) {
      if (oldSelect.dataset.avuBound === "true") continue;

      const row = oldSelect.closest("[data-actor-id]");
      const actor = game.actors.get(row?.dataset.actorId);
      if (!actor) continue;

      const currentOwnerId = this.record(actor).mainUserId || oldSelect.value || "";
      const select = document.createElement("select");
      select.dataset.ownerSelect = "true";
      select.dataset.actorId = actor.id;
      select.dataset.avuBound = "true";
      select.className = oldSelect.className;

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
          await this.assign(actor, ownerId);
          ui.notifications.info(`${actor.name} is now assigned to ${game.users.get(ownerId)?.name}.`);
          await app.render({ force: true });
        } catch (error) {
          console.error(`${AVU_MODULE_ID} | Owner assignment failed`, error);
          ui.notifications.error(error.message);
          select.value = currentOwnerId;
          select.disabled = false;
        }
      }, true);
    }
  }
}

Hooks.on("renderApplicationV2", (app, element) => {
  if (app?.id !== "actor-vault-app") return;
  for (const delay of [0, 50, 150, 350]) {
    setTimeout(() => ActorVaultAllUserOwnerDropdown.enhance(app, element), delay);
  }
});

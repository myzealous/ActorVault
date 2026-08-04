const AVF_SCOPE = "world";
const AVF_RESOURCE_KEY = "metaResources";
const AVF_RECORD_PATH = "flags.actor-vault.record";

class ActorVaultOwnerHousingFix {
  static root(element, app) {
    return element instanceof HTMLElement ? element : element?.[0] || app?.element || null;
  }

  static isEligibleOwner(user) {
    return Boolean(user?.id) && user.role !== CONST.USER_ROLES.GAMEMASTER;
  }

  static eligibleOwners() {
    return game.users.filter(user => this.isEligibleOwner(user)).sort((a, b) => a.name.localeCompare(b.name));
  }

  static fillOwnerSelect(select) {
    const actor = game.actors.get(select.dataset.actorId);
    const record = foundry.utils.getProperty(actor, AVF_RECORD_PATH) || {};
    const selectedId = select.value || record.mainUserId || "";
    select.replaceChildren();
    const unassigned = document.createElement("option");
    unassigned.value = "";
    unassigned.textContent = "Unassigned";
    select.append(unassigned);
    for (const user of this.eligibleOwners()) {
      const option = document.createElement("option");
      option.value = user.id;
      option.textContent = user.name;
      option.selected = user.id === selectedId;
      select.append(option);
    }
  }

  static bindOwnerSelect(select, app) {
    this.fillOwnerSelect(select);
    if (select.dataset.avfOwnerBound) return;
    select.dataset.avfOwnerBound = "true";
    select.addEventListener("change", async event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const actor = game.actors.get(select.dataset.actorId);
      const owner = game.users.get(select.value);
      if (!actor) return ui.notifications.error("Actor not found.");
      if (!owner || !this.isEligibleOwner(owner)) return ui.notifications.error("Select a valid player or Assistant GM account.");
      select.disabled = true;
      try {
        const old = foundry.utils.getProperty(actor, AVF_RECORD_PATH) || {};
        const record = {
          ...old,
          vaultId: old.vaultId || foundry.utils.randomID(24),
          mainUserId: owner.id,
          originalFolderId: actor.folder?.id || old.originalFolderId || null,
          originalFolderName: actor.folder?.name || old.originalFolderName || null,
          updatedAt: Date.now()
        };
        await actor.update({
          ownership: {
            default: CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED,
            [owner.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER
          },
          [AVF_RECORD_PATH]: record
        });
        ui.notifications.info(`${actor.name} is now assigned to ${owner.name}.`);
        await app.render({ force: true });
      } catch (error) {
        ui.notifications.error(error.message);
        select.disabled = false;
      }
    }, true);
  }

  static applySlots(root, tier) {
    const slots = Math.max(0, Math.min(3, Math.trunc(Number(tier) || 0) - 1));
    root.querySelectorAll("[data-storage-slot]").forEach((field, index) => {
      if (index >= 3) {
        field.hidden = true;
        return;
      }
      const input = field.querySelector("input");
      const unlocked = index < slots;
      field.hidden = false;
      field.classList.toggle("is-locked", !unlocked);
      if (input) input.disabled = !unlocked;
      const label = field.querySelector("span");
      if (label) label.textContent = `Protected Slot ${index + 1}${unlocked ? "" : " (Locked)"}`;
    });
  }

  static bindHousing(root) {
    const form = root.querySelector("form[data-resource-form]");
    const select = root.querySelector("[data-housing-tier]");
    const user = game.users.get(form?.dataset.userId);
    if (!form || !select || !user) return;
    const resources = user.getFlag(AVF_SCOPE, AVF_RESOURCE_KEY) || {};
    const tier = Math.max(0, Math.min(4, Math.trunc(Number(resources.housingTier) || 0)));
    select.value = String(tier);
    this.applySlots(root, tier);
    if (select.dataset.avfSlotsBound) return;
    select.dataset.avfSlotsBound = "true";
    select.addEventListener("change", () => this.applySlots(root, select.value));
  }

  static enhance(app, element) {
    const root = this.root(element, app);
    if (!root) return;
    root.querySelectorAll("select[data-owner-select]").forEach(select => this.bindOwnerSelect(select, app));
    this.bindHousing(root);
  }
}

Hooks.on("renderApplicationV2", (app, element) => {
  if (app?.id !== "actor-vault-app") return;
  setTimeout(() => ActorVaultOwnerHousingFix.enhance(app, element), 0);
  setTimeout(() => ActorVaultOwnerHousingFix.enhance(app, element), 250);
});

const AVDU_SCOPE = "world";
const AVDU_RESOURCE_KEY = "metaResources";
const AVDU_HISTORY_KEY = "metaResourcesHistory";

class ActorVaultDashboardAllUsers {
  static root(element, app) {
    return element instanceof HTMLElement ? element : element?.[0] || app?.element || null;
  }

  static users() {
    return [...game.users]
      .filter(user => user?.id)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  static clamp(value, min, max) {
    return Math.min(max, Math.max(min, Math.trunc(Number(value) || 0)));
  }

  static housingName(tier) {
    return ["None", "Homestead", "House", "Manor", "Estate"][this.clamp(tier, 0, 4)];
  }

  static rebuildUserSelect(app, root) {
    if (!game.user.isGM) return;
    const oldSelect = root.querySelector("select[data-resource-user]");
    if (!oldSelect || oldSelect.dataset.avduBound === "true") return;

    const currentUserId = root.querySelector("form[data-resource-form]")?.dataset.userId || oldSelect.value || game.user.id;
    const select = oldSelect.cloneNode(false);
    select.dataset.resourceUser = "true";
    select.dataset.avduBound = "true";

    for (const user of this.users()) {
      const option = document.createElement("option");
      option.value = user.id;
      option.textContent = user.name;
      option.selected = user.id === currentUserId;
      select.append(option);
    }

    oldSelect.replaceWith(select);
    select.addEventListener("change", async event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      app.selectedResourceUserId = select.value;
      select.disabled = true;
      await app.render({ force: true });
    }, true);
  }

  static rebuildHousing(app, root) {
    if (!game.user.isGM) return;
    const form = root.querySelector("form[data-resource-form]");
    const user = game.users.get(form?.dataset.userId);
    const oldSelect = root.querySelector("[data-housing-tier]");
    if (!user || !oldSelect || oldSelect.dataset.avduBound === "true") return;

    const select = oldSelect.cloneNode(true);
    select.dataset.avduBound = "true";
    oldSelect.replaceWith(select);

    select.addEventListener("change", async event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      select.disabled = true;
      try {
        const previous = foundry.utils.deepClone(user.getFlag(AVDU_SCOPE, AVDU_RESOURCE_KEY) || {});
        const next = { ...previous, housingTier: this.clamp(select.value, 0, 4) };
        await user.setFlag(AVDU_SCOPE, AVDU_RESOURCE_KEY, next);

        const history = [...(user.getFlag(AVDU_SCOPE, AVDU_HISTORY_KEY) || [])];
        history.unshift({
          timestamp: Date.now(),
          editorUserId: game.user.id,
          previous,
          state: foundry.utils.deepClone(next)
        });
        await user.setFlag(AVDU_SCOPE, AVDU_HISTORY_KEY, history.slice(0, 30));
        ui.notifications.info(`${user.name}'s housing is now ${this.housingName(next.housingTier)}.`);
        await app.render({ force: true });
      } catch (error) {
        console.error("actor-vault | Dashboard housing update failed", error);
        ui.notifications.error(error.message);
        select.disabled = false;
      }
    }, true);
  }

  static enhance(app, element) {
    if (app?.id !== "actor-vault-app" || !game.user.isGM) return;
    const root = this.root(element, app);
    if (!root) return;
    this.rebuildUserSelect(app, root);
    this.rebuildHousing(app, root);
  }
}

Hooks.on("renderApplicationV2", (app, element) => {
  if (app?.id !== "actor-vault-app") return;
  for (const delay of [0, 50, 150]) {
    setTimeout(() => ActorVaultDashboardAllUsers.enhance(app, element), delay);
  }
});

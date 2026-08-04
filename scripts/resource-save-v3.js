const AVR_SCOPE = "world";
const AVR_KEY = "metaResources";
const AVR_HISTORY = "metaResourcesHistory";

Hooks.on("renderApplicationV2", (app, element) => {
  if (app?.id !== "actor-vault-app") return;
  const root = element instanceof HTMLElement ? element : element?.[0] || app.element;
  const form = root?.querySelector("form[data-resource-form]");
  const button = form?.querySelector('button[data-action="save-resources"]');
  if (!form || !button || button.dataset.avrBound) return;
  button.dataset.avrBound = "true";

  button.addEventListener("click", async event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    button.disabled = true;
    try {
      const user = game.users.get(form.dataset.userId);
      if (!user) throw new Error("Player not found.");
      if (!game.user.isGM && user.id !== game.user.id) throw new Error("You may only save your own dashboard.");

      const previous = foundry.utils.deepClone(user.getFlag(AVR_SCOPE, AVR_KEY) || {});
      const storage = [0, 1, 2, 3].map(index => String(form.elements[`s${index}`]?.value ?? "").trim());
      const next = {
        ...previous,
        gold: Number(form.elements.gold?.value ?? 0),
        credits: Number(form.elements.credits?.value ?? 0),
        xp: Number(form.elements.xp?.value ?? 0),
        housingTier: Math.min(4, Math.max(0, Number(root.querySelector("[data-housing-tier]")?.value) || 0)),
        storage
      };

      await user.setFlag(AVR_SCOPE, AVR_KEY, next);
      const history = [...(user.getFlag(AVR_SCOPE, AVR_HISTORY) || [])];
      history.unshift({ timestamp: Date.now(), editorUserId: game.user.id, previous, state: foundry.utils.deepClone(next) });
      await user.setFlag(AVR_SCOPE, AVR_HISTORY, history.slice(0, 30));
      ui.notifications.info(`${user.name}'s dashboard was saved.`);
      await app.render({ force: true });
    } catch (error) {
      ui.notifications.error(error.message);
      button.disabled = false;
    }
  }, true);
});

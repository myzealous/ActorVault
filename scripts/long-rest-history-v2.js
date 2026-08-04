const AVLRH_SCOPE = "world";
const AVLRH_HISTORY_KEY = "metaResourcesHistory";

class ActorVaultLongRestHistoryV2 {
  static root(element, app) {
    return element instanceof HTMLElement ? element : element?.[0] || app?.element || null;
  }

  static housingName(tier) {
    return ["None", "Homestead", "House", "Manor", "Estate"][Math.max(0, Math.min(4, Number(tier) || 0))];
  }

  static async open(initialUserId) {
    const users = game.user.isGM
      ? game.users.contents.slice().sort((a, b) => a.name.localeCompare(b.name))
      : [game.user];
    if (!users.length) return;
    const selectedId = users.some(user => user.id === initialUserId) ? initialUserId : users[0].id;
    const options = users.map(user =>
      `<option value="${foundry.utils.escapeHTML(user.id)}" ${user.id === selectedId ? "selected" : ""}>${foundry.utils.escapeHTML(user.name)}</option>`
    ).join("");

    const dialog = new foundry.applications.api.DialogV2({
      window: { title: game.user.isGM ? "Resource History" : "My Resource History", resizable: true },
      position: { width: 1180, height: 720 },
      content: `<section class="avd-history"><label>Player<select data-avlrh-user ${game.user.isGM ? "" : "disabled"}>${options}</select></label><div data-avlrh-log></div></section>`,
      buttons: [{ action: "close", label: "Close", default: true }]
    });
    await dialog.render({ force: true });

    const select = dialog.element.querySelector("[data-avlrh-user]");
    const log = dialog.element.querySelector("[data-avlrh-log]");
    const draw = () => {
      const user = game.users.get(select.value);
      const history = user?.getFlag(AVLRH_SCOPE, AVLRH_HISTORY_KEY) || [];
      if (!history.length) {
        log.innerHTML = "<p>No resource history recorded.</p>";
        return;
      }
      log.innerHTML = `<table><thead><tr><th>Date</th><th>Action</th><th>Character</th><th>Editor</th><th>Credits</th><th>Rest Cost</th><th>Quick Recovery</th><th>Housing</th><th>Gold</th><th>XP</th><th>Storage</th></tr></thead><tbody>${history.map(entry => {
        const state = entry.state || {};
        const rest = entry.longRest || {};
        const storage = Array.isArray(state.storage) ? state.storage.filter(Boolean).join(", ") : "";
        const restCost = Number.isFinite(Number(rest.cost)) ? Number(rest.cost) : "—";
        const quick = rest.quickRecovery === undefined ? "—" : rest.quickRecovery ? "Yes" : "No";
        return `<tr><td>${new Date(entry.timestamp).toLocaleString()}</td><td>${foundry.utils.escapeHTML(entry.action || "Dashboard update")}</td><td>${foundry.utils.escapeHTML(entry.actorName || "—")}</td><td>${foundry.utils.escapeHTML(game.users.get(entry.editorUserId)?.name || "Unknown")}</td><td>${Number(state.credits) || 0}</td><td>${restCost}</td><td>${quick}</td><td>${this.housingName(state.housingTier)}</td><td>${Number(state.gold) || 0}</td><td>${Number(state.xp) || 0}</td><td>${foundry.utils.escapeHTML(storage || "—")}</td></tr>`;
      }).join("")}</tbody></table>`;
    };
    select.addEventListener("change", draw);
    draw();
  }

  static bind(app, element) {
    const root = this.root(element, app);
    const oldButton = root?.querySelector("[data-history-button]");
    if (!oldButton || oldButton.dataset.avlrhBound) return;
    const button = oldButton.cloneNode(true);
    button.dataset.avlrhBound = "true";
    oldButton.replaceWith(button);
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const userId = root.querySelector("form[data-resource-form]")?.dataset.userId || game.user.id;
      this.open(userId).catch(error => ui.notifications.error(error.message));
    }, true);
  }
}

Hooks.on("renderApplicationV2", (app, element) => {
  if (app?.id !== "actor-vault-app") return;
  for (const delay of [0, 150, 350]) setTimeout(() => ActorVaultLongRestHistoryV2.bind(app, element), delay);
});

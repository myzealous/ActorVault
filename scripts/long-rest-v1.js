const AVLR_SCOPE = "world";
const AVLR_KEY = "metaResources";
const AVLR_HISTORY = "metaResourcesHistory";

class ActorVaultLongRestV1 {
  static root(element, app) {
    return element instanceof HTMLElement ? element : element?.[0] || app?.element || null;
  }

  static clampCost(value) {
    return Math.max(1, Math.min(4, Math.trunc(Number(value) || 1)));
  }

  static normalize(stored) {
    const source = stored && typeof stored === "object" ? foundry.utils.deepClone(stored) : {};
    source.credits = Number(source.credits) || 0;
    source.longRestCost = this.clampCost(source.longRestCost);
    source.quickRecovery = Boolean(source.quickRecovery);
    return source;
  }

  static effectiveCost(resources) {
    return Math.max(0, this.clampCost(resources.longRestCost) - (resources.quickRecovery ? 1 : 0));
  }

  static async writeHistory(user, previous, next, action) {
    const history = [...(user.getFlag(AVLR_SCOPE, AVLR_HISTORY) || [])];
    history.unshift({
      timestamp: Date.now(),
      editorUserId: game.user.id,
      action,
      previous: foundry.utils.deepClone(previous),
      state: foundry.utils.deepClone(next)
    });
    await user.setFlag(AVLR_SCOPE, AVLR_HISTORY, history.slice(0, 30));
  }

  static authorized(user) {
    return Boolean(user && (game.user.isGM || user.id === game.user.id));
  }

  static paint(root, resources) {
    const cost = this.clampCost(resources.longRestCost);
    const effective = this.effectiveCost(resources);
    const costNode = root.querySelector("[data-long-rest-cost]");
    const effectiveNode = root.querySelector("[data-long-rest-effective]");
    const quick = root.querySelector("[data-quick-recovery]");
    const restButton = root.querySelector("[data-long-rest]");
    const noRestButton = root.querySelector("[data-no-long-rest]");
    if (costNode) costNode.textContent = String(cost);
    if (effectiveNode) effectiveNode.textContent = String(effective);
    if (quick) quick.checked = Boolean(resources.quickRecovery);
    if (restButton) {
      restButton.innerHTML = `<i class="fas fa-bed"></i> Long Rest (${effective} Credit${effective === 1 ? "" : "s"})`;
      restButton.disabled = resources.credits < effective;
      restButton.title = resources.credits < effective ? "Not enough Server Credits." : "";
    }
    if (noRestButton) noRestButton.disabled = cost <= 1;
  }

  static async saveQuickRecovery(user, checked, app, root) {
    if (!this.authorized(user)) throw new Error("You may only change your own recovery setting.");
    const previous = this.normalize(user.getFlag(AVLR_SCOPE, AVLR_KEY));
    const next = { ...previous, quickRecovery: Boolean(checked) };
    await user.setFlag(AVLR_SCOPE, AVLR_KEY, next);
    await this.writeHistory(user, previous, next, checked ? "Quick Recovery enabled" : "Quick Recovery disabled");
    this.paint(root, next);
    ui.notifications.info(`Quick Recovery ${checked ? "enabled" : "disabled"}.`);
    await app.render({ force: true });
  }

  static async takeLongRest(user, app, root) {
    if (!this.authorized(user)) throw new Error("You may only spend your own Server Credits.");
    const previous = this.normalize(user.getFlag(AVLR_SCOPE, AVLR_KEY));
    const paid = this.effectiveCost(previous);
    if (previous.credits < paid) throw new Error(`You need ${paid} Server Credit${paid === 1 ? "" : "s"} to long rest.`);
    const next = {
      ...previous,
      credits: previous.credits - paid,
      longRestCost: Math.min(4, previous.longRestCost + 1)
    };
    await user.setFlag(AVLR_SCOPE, AVLR_KEY, next);
    await this.writeHistory(user, previous, next, `Long Rest (${paid} credit${paid === 1 ? "" : "s"} paid)`);
    this.paint(root, next);
    ui.notifications.info(`Long rest completed. ${paid} Server Credit${paid === 1 ? "" : "s"} spent.`);
    await app.render({ force: true });
  }

  static async didNotLongRest(user, app, root) {
    if (!this.authorized(user)) throw new Error("You may only update your own long-rest cost.");
    const previous = this.normalize(user.getFlag(AVLR_SCOPE, AVLR_KEY));
    const next = { ...previous, longRestCost: Math.max(1, previous.longRestCost - 1) };
    await user.setFlag(AVLR_SCOPE, AVLR_KEY, next);
    await this.writeHistory(user, previous, next, "Did Not Long Rest");
    this.paint(root, next);
    ui.notifications.info(`Long-rest cost reduced to ${next.longRestCost}.`);
    await app.render({ force: true });
  }

  static historyName(tier) {
    return ["None", "Homestead", "House", "Manor", "Estate"][Math.max(0, Math.min(4, Number(tier) || 0))];
  }

  static async openHistory(initialUserId) {
    const users = game.user.isGM
      ? game.users.contents.slice().sort((a, b) => a.name.localeCompare(b.name))
      : [game.user];
    if (!users.length) return;
    const selectedId = users.some(user => user.id === initialUserId) ? initialUserId : users[0].id;
    const options = users.map(user => `<option value="${foundry.utils.escapeHTML(user.id)}" ${user.id === selectedId ? "selected" : ""}>${foundry.utils.escapeHTML(user.name)}</option>`).join("");
    const dialog = new foundry.applications.api.DialogV2({
      window: { title: game.user.isGM ? "Resource History" : "My Resource History", resizable: true },
      position: { width: 1100, height: 700 },
      content: `<section class="avd-history"><label>Player<select data-avlr-history-user ${game.user.isGM ? "" : "disabled"}>${options}</select></label><div data-avlr-history-log></div></section>`,
      buttons: [{ action: "close", label: "Close", default: true }]
    });
    await dialog.render({ force: true });
    const select = dialog.element.querySelector("[data-avlr-history-user]");
    const log = dialog.element.querySelector("[data-avlr-history-log]");
    const draw = () => {
      const user = game.users.get(select.value);
      const history = user?.getFlag(AVLR_SCOPE, AVLR_HISTORY) || [];
      if (!history.length) {
        log.innerHTML = "<p>No resource history recorded.</p>";
        return;
      }
      log.innerHTML = `<table><thead><tr><th>Date</th><th>Action</th><th>Editor</th><th>Credits</th><th>Rest Cost</th><th>Quick Recovery</th><th>Housing</th><th>Gold</th><th>XP</th><th>Storage</th></tr></thead><tbody>${history.map(entry => {
        const state = this.normalize(entry.state || {});
        const storage = Array.isArray(state.storage) ? state.storage.filter(Boolean).join(", ") : "";
        return `<tr><td>${new Date(entry.timestamp).toLocaleString()}</td><td>${foundry.utils.escapeHTML(entry.action || "Dashboard update")}</td><td>${foundry.utils.escapeHTML(game.users.get(entry.editorUserId)?.name || "Unknown")}</td><td>${state.credits}</td><td>${state.longRestCost}</td><td>${state.quickRecovery ? "Yes" : "No"}</td><td>${this.historyName(state.housingTier)}</td><td>${Number(state.gold) || 0}</td><td>${Number(state.xp) || 0}</td><td>${foundry.utils.escapeHTML(storage || "—")}</td></tr>`;
      }).join("")}</tbody></table>`;
    };
    select.addEventListener("change", draw);
    draw();
  }

  static bindHistory(root) {
    const oldButton = root.querySelector("[data-history-button]");
    if (!oldButton || oldButton.dataset.avlrBound) return;
    const button = oldButton.cloneNode(true);
    button.dataset.avlrBound = "true";
    oldButton.replaceWith(button);
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const userId = root.querySelector("form[data-resource-form]")?.dataset.userId || game.user.id;
      this.openHistory(userId).catch(error => ui.notifications.error(error.message));
    }, true);
  }

  static bind(app, element) {
    const root = this.root(element, app);
    const form = root?.querySelector("form[data-resource-form]");
    if (!root || !form) return;
    const user = game.users.get(form.dataset.userId);
    if (!user) return;
    const resources = this.normalize(user.getFlag(AVLR_SCOPE, AVLR_KEY));
    this.paint(root, resources);
    this.bindHistory(root);

    const quick = root.querySelector("[data-quick-recovery]");
    if (quick && !quick.dataset.avlrBound) {
      quick.dataset.avlrBound = "true";
      quick.addEventListener("change", async () => {
        quick.disabled = true;
        try { await this.saveQuickRecovery(user, quick.checked, app, root); }
        catch (error) { ui.notifications.error(error.message); quick.disabled = false; }
      });
    }

    const rest = root.querySelector("[data-long-rest]");
    if (rest && !rest.dataset.avlrBound) {
      rest.dataset.avlrBound = "true";
      rest.addEventListener("click", async event => {
        event.preventDefault();
        rest.disabled = true;
        try { await this.takeLongRest(user, app, root); }
        catch (error) { ui.notifications.error(error.message); this.paint(root, this.normalize(user.getFlag(AVLR_SCOPE, AVLR_KEY))); }
      });
    }

    const noRest = root.querySelector("[data-no-long-rest]");
    if (noRest && !noRest.dataset.avlrBound) {
      noRest.dataset.avlrBound = "true";
      noRest.addEventListener("click", async event => {
        event.preventDefault();
        noRest.disabled = true;
        try { await this.didNotLongRest(user, app, root); }
        catch (error) { ui.notifications.error(error.message); this.paint(root, this.normalize(user.getFlag(AVLR_SCOPE, AVLR_KEY))); }
      });
    }
  }
}

Hooks.on("renderApplicationV2", (app, element) => {
  if (app?.id !== "actor-vault-app") return;
  for (const delay of [0, 100, 300]) setTimeout(() => ActorVaultLongRestV1.bind(app, element), delay);
});

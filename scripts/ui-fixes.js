const AVUF_SCOPE = "world";
const AVUF_RESOURCE_KEY = "metaResources";
const AVUF_HISTORY_KEY = "metaResourcesHistory";

function avufRoot(element, app) {
  return element instanceof HTMLElement ? element : element?.[0] || app?.element || null;
}

function avufEsc(value) {
  return foundry.utils.escapeHTML(String(value ?? ""));
}

function avufOpenOwnHistory() {
  const user = game.user;
  const history = user.getFlag(AVUF_SCOPE, AVUF_HISTORY_KEY) || [];
  const rows = history.map(entry => {
    const state = entry?.state || {};
    const storage = Array.isArray(state.storage) ? state.storage : [];
    return `<tr><td>${new Date(entry.timestamp).toLocaleString()}</td><td>${Number(state.gold)||0}</td><td>${Number(state.credits)||0}</td><td>${Number(state.xp)||0}</td><td>${["None","Homestead","House","Manor","Estate"][Number(state.housingTier)||0] || "None"}</td><td>${storage.slice(0,3).map(v => avufEsc(String(v||"").trim() || "—")).join("<br>")}</td></tr>`;
  }).join("");
  new foundry.applications.api.DialogV2({
    window: { title: `${user.name} — Resource History`, resizable: true },
    position: { width: 850, height: 650 },
    content: history.length ? `<div class="actor-vault-history__log"><table class="actor-vault-history__table"><thead><tr><th>Date</th><th>Gold</th><th>Credits</th><th>XP</th><th>Housing</th><th>Protected Items</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p>No resource history has been logged.</p>`,
    buttons: [{ action: "close", label: "Close", default: true }]
  }).render({ force: true });
}

async function avufSaveOwnHousing(select, app) {
  const form = select.closest("form[data-resource-form]");
  const userId = form?.dataset.userId;
  const user = game.users.get(userId);
  if (!user) throw new Error("Player not found.");
  if (!game.user.isGM && user.id !== game.user.id) throw new Error("You may only change your own housing tier.");

  const previous = foundry.utils.deepClone(user.getFlag(AVUF_SCOPE, AVUF_RESOURCE_KEY) || {});
  const next = { ...previous, housingTier: Math.min(4, Math.max(0, Number(select.value) || 0)) };
  await user.setFlag(AVUF_SCOPE, AVUF_RESOURCE_KEY, next);
  const history = [...(user.getFlag(AVUF_SCOPE, AVUF_HISTORY_KEY) || [])];
  history.unshift({ timestamp: Date.now(), editorUserId: game.user.id, previous, state: foundry.utils.deepClone(next) });
  await user.setFlag(AVUF_SCOPE, AVUF_HISTORY_KEY, history.slice(0, 30));
  ui.notifications.info(`${user.name}'s housing tier was updated.`);
  await app.render({ force: true });
}

function avufClean(app, element) {
  const root = avufRoot(element, app);
  if (!root) return;

  // Keep exactly one history button. Players receive a button for their own ledger.
  const historyButtons = [...root.querySelectorAll(".actor-vault-history-open, [data-avp-history]")];
  if (game.user.isGM) historyButtons.slice(1).forEach(button => button.remove());
  else {
    historyButtons.forEach(button => button.remove());
    const toolbar = root.querySelector(".actor-vault__toolbar");
    if (toolbar && !toolbar.querySelector("[data-avuf-own-history]")) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.avufOwnHistory = "true";
      button.innerHTML = '<i class="fas fa-clock-rotate-left"></i> My Resource History';
      button.addEventListener("click", avufOpenOwnHistory);
      toolbar.append(button);
    }
  }

  for (const row of root.querySelectorAll("[data-actor-id], [data-pack-id]")) {
    const progression = row.querySelector("[data-avp-progression]");
    if (!progression) continue;

    const actorId = row.dataset.actorId;
    const actor = actorId ? game.actors.get(actorId) : null;
    if (actor && !actor.items.some(item => item.type === "class")) {
      progression.remove();
      row.querySelectorAll("[data-avs-sync], .avs-skill-reason").forEach(node => node.remove());
      continue;
    }

    const points = progression.querySelector(".avp-skill-points");
    if (points) points.innerHTML = points.innerHTML.replace(/\s*\/\s*19/g, "");

    const select = progression.querySelector("select");
    if (select && !progression.querySelector(".avuf-worldbreaker-label")) {
      const label = document.createElement("span");
      label.className = "avuf-worldbreaker-label";
      label.textContent = "Worldbreaker";
      select.before(label);
    }

    const syncButtons = [...row.querySelectorAll("[data-avs-sync]")];
    syncButtons.slice(1).forEach(button => button.remove());
    const reasons = [...row.querySelectorAll(".avs-skill-reason")];
    reasons.slice(1).forEach(reason => reason.remove());
  }

  // Direct self-service housing update; prevent the older GM-socket listener from firing.
  const housing = root.querySelector("[data-avp-housing] select");
  if (housing && !housing.dataset.avufBound) {
    housing.dataset.avufBound = "true";
    housing.addEventListener("change", async event => {
      event.stopImmediatePropagation();
      event.preventDefault();
      event.currentTarget.disabled = true;
      try { await avufSaveOwnHousing(event.currentTarget, app); }
      catch (error) { ui.notifications.error(error.message); event.currentTarget.disabled = false; }
    }, true);
  }
}

Hooks.on("renderApplicationV2", (app, element) => {
  if (app?.id === "actor-vault-app") queueMicrotask(() => avufClean(app, element));
});

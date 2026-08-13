const AVFL_APP_ID = "actor-vault-app";

class ActorVaultFinalLayout {
  static root(app, element) {
    return element instanceof HTMLElement ? element : element?.[0] || app?.element || null;
  }

  static renameRewards(root) {
    const button = root?.querySelector("[data-avms-reward]");
    if (button) button.textContent = "Claim Session Rewards";
  }

  static installHistoryOverride() {
    if (!globalThis.ActorVaultLedgerUI || !globalThis.ActorVaultLedger) return;

    ActorVaultLedgerUI.openHistory = async function(initialUserId) {
      const current = game.user.isGM
        ? game.users.filter(user => !ActorVaultLedger.getEntry(user.id)?.archived).sort((a, b) => a.name.localeCompare(b.name))
        : [game.user];
      const archived = game.user.isGM
        ? ActorVaultLedger.allEntries().filter(entry => entry.archived).sort((a, b) => String(a.name).localeCompare(String(b.name)))
        : [];

      const currentOptions = current.map(user => `<option value="${foundry.utils.escapeHTML(user.id)}" ${user.id === initialUserId ? "selected" : ""}>${foundry.utils.escapeHTML(user.name)}${user.isGM ? " [GM]" : ""}</option>`).join("");
      const archivedOptions = archived.length
        ? `<optgroup label="Archived">${archived.map(entry => `<option value="${foundry.utils.escapeHTML(entry.key)}">${foundry.utils.escapeHTML(entry.name)} [Archived]</option>`).join("")}</optgroup>`
        : "";

      const dialog = new foundry.applications.api.DialogV2({
        window: { title: game.user.isGM ? "Resource History" : "My Resource History", resizable: true },
        position: { width: 1180, height: 720 },
        content: `<section class="avd-history"><label>Player<select data-avl-history-user ${game.user.isGM ? "" : "disabled"}>${currentOptions}${archivedOptions}</select></label><div data-avl-history-log></div></section>`,
        buttons: [{ action: "close", label: "Close", default: true }]
      });

      await dialog.render({ force: true });
      const select = dialog.element.querySelector("[data-avl-history-user]");
      const log = dialog.element.querySelector("[data-avl-history-log]");
      const housingName = tier => ["None", "Homestead", "House", "Manor", "Estate"][Math.max(0, Math.min(4, Number(tier) || 0))];

      const draw = () => {
        const history = game.users.get(select.value)
          ? ActorVaultLedger.getHistory(select.value)
          : (ActorVaultLedger.getEntryByKey(select.value)?.history || []);
        if (!history.length) {
          log.innerHTML = "<p>No resource history recorded.</p>";
          return;
        }
        log.innerHTML = `<table><thead><tr><th>Date</th><th>Action</th><th>Character</th><th>Editor</th><th>Credits</th><th>Housing</th><th>Gold</th><th>XP</th><th>Storage</th></tr></thead><tbody>${history.map(entry => {
          const state = entry.state || {};
          const storage = Array.isArray(state.storage) ? state.storage.filter(Boolean).join(", ") : "";
          const editor = entry.editorName || game.users.get(entry.editorUserId)?.name || "Unknown";
          return `<tr><td>${new Date(entry.timestamp).toLocaleString()}</td><td>${foundry.utils.escapeHTML(entry.action || "Dashboard update")}</td><td>${foundry.utils.escapeHTML(entry.actorName || "—")}</td><td>${foundry.utils.escapeHTML(editor)}</td><td>${Number(state.credits) || 0}</td><td>${housingName(state.housingTier)}</td><td>${Number(state.gold) || 0}</td><td>${Number(state.xp) || 0}</td><td>${foundry.utils.escapeHTML(storage || "—")}</td></tr>`;
        }).join("")}</tbody></table>`;
      };

      select.addEventListener("change", draw);
      draw();
    };
  }

  static bindArchiveToggle(app, root) {
    if (!game.user.isGM || !globalThis.ActorVaultLedger || root.querySelector("[data-avfl-archive-ledger]")) return;
    const toolbar = root.querySelector(".avd-header__actions");
    const form = root.querySelector("form[data-resource-form]");
    const user = game.users.get(form?.dataset.userId);
    if (!toolbar || !user) return;

    const entry = ActorVaultLedger.getEntry(user.id);
    const archived = Boolean(entry?.archived);
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.avflArchiveLedger = "true";
    button.innerHTML = archived
      ? '<i class="fas fa-box-open"></i> Restore Ledger'
      : '<i class="fas fa-box-archive"></i> Archive Ledger';

    button.addEventListener("click", async () => {
      try {
        if (archived) {
          await ActorVaultLedger.restoreArchived(ActorVaultLedger.keyForUser(user));
          ui.notifications.info(`${user.name}'s resource ledger was restored.`);
        } else {
          const confirmed = await foundry.applications.api.DialogV2.confirm({
            window: { title: `Archive ${user.name}'s Resource Ledger` },
            content: `<p>Archive <strong>${foundry.utils.escapeHTML(user.name)}</strong>'s resource ledger and history?</p><p>The data is preserved and remains available under Resource History and Archived Ledgers.</p>`,
            yes: { label: "Archive Ledger" },
            no: { label: "Cancel" },
            modal: true
          });
          if (!confirmed) return;
          await ActorVaultLedger.archiveUser(user.id);
          ui.notifications.info(`${user.name}'s resource ledger was archived.`);
        }
        await app.render({ force: true });
      } catch (error) {
        ui.notifications.error(error.message);
      }
    });

    toolbar.append(button);
  }

  static run(app, element) {
    const root = this.root(app, element);
    if (!root) return;
    for (const delay of [250, 450, 700]) {
      setTimeout(() => {
        if (!root?.isConnected) return;
        this.renameRewards(root);
        this.bindArchiveToggle(app, root);
      }, delay);
    }
  }
}

Hooks.once("ready", () => ActorVaultFinalLayout.installHistoryOverride());
Hooks.on("renderApplicationV2", (app, element) => {
  if (app?.id === AVFL_APP_ID) ActorVaultFinalLayout.run(app, element);
});

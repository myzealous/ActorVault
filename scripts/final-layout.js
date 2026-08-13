const AVFL_APP_ID = "actor-vault-app";

class ActorVaultFinalLayout {
  static root(app, element) {
    return element instanceof HTMLElement ? element : element?.[0] || app?.element || null;
  }

  static renameRewards(root) {
    const button = root?.querySelector("[data-avms-reward]");
    if (button) button.textContent = "Claim Session Rewards";
  }

  static installMetaShopDescriptions() {
    if (!globalThis.ActorVaultMetaShop || ActorVaultMetaShop.__avflDescriptionsInstalled) return;

    const descriptions = {
      balancing: "Each degree of balancing gives the weapon +1 attack / -1 damage or -1 attack / +1 damage. May be purchased any number of times.",
      spellRestore: "Restore all of your spell slots.",
      rejuvenate: "Regain all of your Hit Dice.",
      inspiring: "Gain a special 1d8 Bardic Inspiration die that lasts until the end of the next mission.",
      temporaryTraining: "Gain proficiency in one skill or tool until the end of the next mission.",
      aria: "Gain a bonus against monstrosities until the end of the next mission.",
      comedy: "Gain a bonus against constructs until the end of the next mission."
    };

    const originalLine = ActorVaultMetaShop.line.bind(ActorVaultMetaShop);
    ActorVaultMetaShop.line = function(itemId, userId) {
      const html = originalLine(itemId, userId);
      const description = descriptions[itemId];
      if (!description) return html;
      return html.replace(
        "</span><button",
        `<small class="avms-description">${this.esc(description)}</small></span><button`
      );
    };

    ActorVaultMetaShop.__avflDescriptionsInstalled = true;
  }

  static installHistoryOverride() {
    if (!globalThis.ActorVaultLedgerUI || !globalThis.ActorVaultLedger) return;

    ActorVaultLedgerUI.openHistory = async function(initialValue) {
      const current = game.user.isGM
        ? game.users.filter(user => !ActorVaultLedger.getEntry(user.id)?.archived).sort((a, b) => a.name.localeCompare(b.name))
        : [game.user];
      const archived = game.user.isGM
        ? ActorVaultLedger.allEntries().filter(entry => entry.archived).sort((a, b) => String(a.name).localeCompare(String(b.name)))
        : [];

      const initial = initialValue || game.user.id;
      const currentOptions = current.map(user => `<option value="${foundry.utils.escapeHTML(user.id)}" ${user.id === initial ? "selected" : ""}>${foundry.utils.escapeHTML(user.name)}${user.isGM ? " [GM]" : ""}</option>`).join("");
      const archivedOptions = archived.length
        ? `<optgroup label="Archived">${archived.map(entry => `<option value="${foundry.utils.escapeHTML(entry.key)}" ${entry.key === initial ? "selected" : ""}>${foundry.utils.escapeHTML(entry.name)} [Archived]</option>`).join("")}</optgroup>`
        : "";

      const dialog = new foundry.applications.api.DialogV2({
        window: { title: game.user.isGM ? "Resource History" : "My Resource History", resizable: true },
        position: { width: 1180, height: 720 },
        content: `<section class="avd-history"><label>Player<select data-avl-history-user ${game.user.isGM ? "" : "disabled"}>${currentOptions}${archivedOptions}</select></label><div data-avl-history-log></div><div data-avfl-archived-actions></div></section>`,
        buttons: [{ action: "close", label: "Close", default:true }]
      });

      await dialog.render({ force:true });
      const select = dialog.element.querySelector("[data-avl-history-user]");
      const log = dialog.element.querySelector("[data-avl-history-log]");
      const actions = dialog.element.querySelector("[data-avfl-archived-actions]");
      const housingName = tier => ["None", "Homestead", "House", "Manor", "Estate"][Math.max(0, Math.min(4, Number(tier) || 0))];

      const draw = () => {
        const user = game.users.get(select.value);
        const archivedEntry = user ? null : ActorVaultLedger.getEntryByKey(select.value);
        const history = user ? ActorVaultLedger.getHistory(select.value) : (archivedEntry?.history || []);

        if (!history.length) {
          log.innerHTML = "<p>No resource history recorded.</p>";
        } else {
          log.innerHTML = `<table><thead><tr><th>Date</th><th>Action</th><th>Character</th><th>Editor</th><th>Credits</th><th>Housing</th><th>Gold</th><th>XP</th><th>Storage</th></tr></thead><tbody>${history.map(entry => {
            const state = entry.state || {};
            const storage = Array.isArray(state.storage) ? state.storage.filter(Boolean).join(", ") : "";
            const editor = entry.editorName || game.users.get(entry.editorUserId)?.name || "Unknown";
            return `<tr><td>${new Date(entry.timestamp).toLocaleString()}</td><td>${foundry.utils.escapeHTML(entry.action || "Dashboard update")}</td><td>${foundry.utils.escapeHTML(entry.actorName || "—")}</td><td>${foundry.utils.escapeHTML(editor)}</td><td>${Number(state.credits) || 0}</td><td>${housingName(state.housingTier)}</td><td>${Number(state.gold) || 0}</td><td>${Number(state.xp) || 0}</td><td>${foundry.utils.escapeHTML(storage || "—")}</td></tr>`;
          }).join("")}</tbody></table>`;
        }

        actions.innerHTML = "";
        if (game.user.isGM && archivedEntry?.archived) {
          const button = document.createElement("button");
          button.type = "button";
          button.innerHTML = '<i class="fas fa-trash"></i> Delete Archived Ledger';
          button.addEventListener("click", async () => {
            const confirmed = await foundry.applications.api.DialogV2.confirm({
              window: { title: "Delete Archived Resource Data" },
              content: `<p>Permanently delete the resource ledger and history for <strong>${foundry.utils.escapeHTML(archivedEntry.name || "Archived User")}</strong>?</p><p><strong>This cannot be undone.</strong></p>`,
              yes: { label: "Delete Permanently" },
              no: { label: "Cancel" },
              modal: true
            });
            if (!confirmed) return;
            await ActorVaultLedger.deleteArchived(archivedEntry.key);
            ui.notifications.info(`${archivedEntry.name || "Archived user"}'s ledger was permanently deleted.`);
            await dialog.close();
          });
          actions.append(button);
        }
      };

      select.addEventListener("change", draw);
      draw();
    };
  }

  static bindArchivedViewer(root) {
    if (!game.user.isGM || !globalThis.ActorVaultLedgerUI) return;

    root.querySelector("[data-avfl-archive-ledger]")?.remove();
    root.querySelector("[data-avl-manage-archived]")?.remove();

    const toolbar = root.querySelector(".avd-header__actions");
    if (!toolbar || root.querySelector("[data-avfl-view-archived]")) return;

    const button = document.createElement("button");
    button.type = "button";
    button.dataset.avflViewArchived = "true";
    button.innerHTML = '<i class="fas fa-box-archive"></i> Archived Ledgers';
    button.addEventListener("click", () => {
      const archived = ActorVaultLedger.allEntries().filter(entry => entry.archived).sort((a, b) => String(a.name).localeCompare(String(b.name)));
      if (!archived.length) return ui.notifications.info("No archived resource ledgers.");
      ActorVaultLedgerUI.openHistory(archived[0].key).catch(error => ui.notifications.error(error.message));
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
        this.bindArchivedViewer(root);
      }, delay);
    }
  }
}

Hooks.once("ready", () => {
  ActorVaultFinalLayout.installMetaShopDescriptions();
  ActorVaultFinalLayout.installHistoryOverride();
});
Hooks.on("renderApplicationV2", (app, element) => {
  if (app?.id === AVFL_APP_ID) ActorVaultFinalLayout.run(app, element);
});

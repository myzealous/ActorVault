const AVFL_APP_ID = "actor-vault-app";

class ActorVaultFinalLayout {
  static root(app, element) {
    return element instanceof HTMLElement ? element : element?.[0] || app?.element || null;
  }

  static keepOneHistoryButton(root) {
    const buttons = [...root.querySelectorAll(
      ".actor-vault-history-open, [data-avp-history], [data-avx-history], [data-avuf-own-history]"
    )];
    if (!buttons.length) return;
    const keep = buttons[0];
    for (const button of buttons.slice(1)) button.remove();
    keep.innerHTML = `<i class="fas fa-clock-rotate-left"></i> ${game.user.isGM ? "Resource History" : "My Resource History"}`;
  }

  static cleanStored(row) {
    row.classList.add("avfl-stored-row");
    row.querySelectorAll(
      "[data-avp-progression], [data-avs-sync], .avs-skill-reason, .avx-skill-reason, .actor-vault__owner-label"
    ).forEach(node => node.remove());

    const identity = row.querySelector(".actor-vault__identity");
    if (!identity) return;
    const meta = identity.querySelector("span:not(.avfl-stored-owner)");
    const owner = meta?.textContent?.split("·").at(-1)?.trim() || "";
    meta?.remove();
    let ownerLine = identity.querySelector(".avfl-stored-owner");
    if (!ownerLine) {
      ownerLine = document.createElement("span");
      ownerLine.className = "avfl-stored-owner";
      identity.append(ownerLine);
    }
    ownerLine.textContent = owner;
  }

  static cleanActive(row) {
    row.classList.add("avfl-active-row");
    row.querySelectorAll(".avs-skill-reason, .avx-skill-reason").forEach(node => node.remove());
    const sync = [...row.querySelectorAll("[data-avs-sync]")];
    sync.slice(1).forEach(node => node.remove());

    const identity = row.querySelector(".actor-vault__identity");
    const meta = identity?.querySelector("span");
    const isNpc = meta?.textContent?.trim().toLowerCase().startsWith("npc");
    row.classList.toggle("avfl-npc-row", Boolean(isNpc));

    if (isNpc) {
      row.querySelectorAll("[data-avp-progression], [data-avs-sync]").forEach(node => node.remove());
      identity?.querySelector(".avl-skill-summary, .avfl-skill-summary")?.remove();
      return;
    }

    const progression = row.querySelector("[data-avp-progression]");
    if (!progression || !identity) return;

    let summary = identity.querySelector(".avfl-skill-summary");
    if (!summary) {
      summary = document.createElement("div");
      summary.className = "avfl-skill-summary";
      identity.append(summary);
    }

    const points = progression.querySelector(".avp-skill-points");
    const breakdown = progression.querySelector(".avp-breakdown");
    if (points) {
      points.innerHTML = points.innerHTML.replace(/\s*\/\s*19/g, "");
      summary.append(points);
    }
    if (breakdown) summary.append(breakdown);

    progression.querySelectorAll(".avl-worldbreaker-label, .avuf-worldbreaker-label, .avfl-worldbreaker-label")
      .forEach(node => node.remove());
    const select = progression.querySelector("select");
    if (select) {
      const label = document.createElement("span");
      label.className = "avfl-worldbreaker-label";
      label.textContent = "Worldbreaker";
      select.before(label);
    }
  }

  static moveSaveButton(root) {
    const form = root.querySelector("form[data-resource-form]");
    const grid = form?.querySelector(".actor-vault__resource-grid");
    const actions = form?.querySelector(".actor-vault__resource-actions");
    if (!grid || !actions || actions.dataset.avflMoved) return;
    actions.dataset.avflMoved = "true";
    grid.append(actions);
  }

  static clean(app, root) {
    if (!root?.isConnected) return;
    root.classList.add("avfl-layout");
    this.keepOneHistoryButton(root);
    this.moveSaveButton(root);
    root.querySelectorAll("[data-pack-id]").forEach(row => this.cleanStored(row));
    root.querySelectorAll("[data-actor-id]").forEach(row => this.cleanActive(row));
  }

  static run(app, element) {
    const root = this.root(app, element);
    if (!root) return;
    for (const delay of [0, 75, 250, 750]) {
      setTimeout(() => this.clean(app, root), delay);
    }
  }
}

Hooks.on("renderApplicationV2", (app, element) => {
  if (app?.id === AVFL_APP_ID) ActorVaultFinalLayout.run(app, element);
});

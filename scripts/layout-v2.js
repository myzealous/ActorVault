const AVL_MODULE_ID = "actor-vault";

class ActorVaultLayoutV2 {
  static observer = null;
  static cleaning = false;

  static root(element, app) {
    return element instanceof HTMLElement ? element : element?.[0] || app?.element || null;
  }

  static historyButton(root) {
    const buttons = [...root.querySelectorAll(
      ".actor-vault-history-open, [data-avp-history], [data-avx-history], [data-avuf-own-history]"
    )];
    if (!buttons.length) return;
    const keep = buttons.at(-1);
    for (const button of buttons) if (button !== keep) button.remove();
    keep.classList.add("avl-history-button");
    keep.innerHTML = `<i class="fas fa-clock-rotate-left"></i> ${game.user.isGM ? "Resource History" : "My Resource History"}`;
  }

  static compactStored(row) {
    row.classList.add("avl-stored-row");
    row.querySelectorAll("[data-avp-progression], [data-avs-sync], .avs-skill-reason, .avx-skill-reason, .actor-vault__owner-label")
      .forEach(node => node.remove());

    const identity = row.querySelector(".actor-vault__identity");
    if (identity) {
      const ownerName = identity.querySelector("span")?.textContent?.split("·").at(-1)?.trim() || "";
      let owner = row.querySelector(".avl-stored-owner");
      if (!owner) {
        owner = document.createElement("span");
        owner.className = "avl-stored-owner";
        identity.append(owner);
      }
      owner.textContent = ownerName;
      const old = identity.querySelector("span:not(.avl-stored-owner)");
      old?.remove();
    }
  }

  static cleanActive(row) {
    row.classList.add("avl-active-row");

    const syncButtons = [...row.querySelectorAll("[data-avs-sync]")];
    syncButtons.slice(1).forEach(node => node.remove());
    row.querySelectorAll(".avs-skill-reason, .avx-skill-reason").forEach(node => node.remove());

    const progression = row.querySelector("[data-avp-progression]");
    if (progression) {
      const select = progression.querySelector("select");
      if (select && !progression.querySelector(".avl-worldbreaker-label")) {
        const label = document.createElement("span");
        label.className = "avl-worldbreaker-label";
        label.textContent = "Worldbreaker";
        select.before(label);
      }
      const points = progression.querySelector(".avp-skill-points");
      if (points) points.innerHTML = points.innerHTML.replace(/\s*\/\s*19/g, "");
    }

    const identity = row.querySelector(".actor-vault__identity");
    const isNpc = identity?.querySelector("span")?.textContent?.trim().toLowerCase().startsWith("npc");
    row.classList.toggle("avl-npc-row", Boolean(isNpc));
    if (isNpc) {
      row.querySelectorAll("[data-avp-progression], [data-avs-sync], .avs-skill-reason, .avx-skill-reason")
        .forEach(node => node.remove());
    }
  }

  static clean(app, element) {
    const root = this.root(element, app);
    if (!root || this.cleaning) return;
    this.cleaning = true;
    try {
      root.classList.add("avl-layout-v2");
      this.historyButton(root);

      for (const row of root.querySelectorAll("[data-pack-id]")) this.compactStored(row);
      for (const row of root.querySelectorAll("[data-actor-id]")) this.cleanActive(row);

      if (app?.position?.width < 1180) app.setPosition?.({ width: 1240, height: Math.max(800, app.position?.height || 0) });

      if (!root.dataset.avlObserved) {
        root.dataset.avlObserved = "true";
        const observer = new MutationObserver(() => queueMicrotask(() => this.clean(app, root)));
        observer.observe(root, { childList: true, subtree: true });
      }
    } finally {
      this.cleaning = false;
    }
  }
}

Hooks.on("renderApplicationV2", (app, element) => {
  if (app?.id === "actor-vault-app") queueMicrotask(() => ActorVaultLayoutV2.clean(app, element));
});

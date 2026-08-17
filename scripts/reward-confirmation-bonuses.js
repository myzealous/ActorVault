const AVRB_MODULE_ID = "actor-vault";

class ActorVaultRewardBonuses {
  static installed = false;
  static originalExecute = null;
  static originalEnhance = null;

  static esc(value) {
    return foundry.utils.escapeHTML(String(value ?? ""));
  }

  static rewardAmounts(reward, bonuses = {}) {
    const study = Boolean(bonuses.study);
    const fortuneSeeker = Boolean(bonuses.fortuneSeeker);
    const fastLearner = Boolean(bonuses.fastLearner);
    const xpMultiplier = 1 + (study ? 0.10 : 0) + (fastLearner ? 0.05 : 0);
    const goldMultiplier = 1 + (fortuneSeeker ? 0.10 : 0);
    return {
      xp: Math.round(reward.xp * xpMultiplier),
      gold: Math.round(reward.gold * goldMultiplier),
      credits: reward.credits,
      study,
      fortuneSeeker,
      fastLearner,
      xpMultiplier,
      goldMultiplier
    };
  }

  static bonusLabels(amounts) {
    const labels = [];
    if (amounts.study) labels.push("The Study +10% XP");
    if (amounts.fastLearner) labels.push("Fast Learner +5% XP");
    if (amounts.fortuneSeeker) labels.push("Fortune Seeker +10% GP");
    return labels;
  }

  static async prompt(level, reward, current) {
    const DialogV2 = foundry.applications.api.DialogV2;
    let renderDialog = null;

    const result = await DialogV2.wait({
      window: { title: `Claim Level ${level} Session Rewards` },
      modal: true,
      content: `
        <form class="avrb-reward-form">
          <p>Choose any mission reward bonuses that apply to this claim.</p>
          <div style="display:grid;gap:10px;margin:12px 0;">
            <label style="display:flex;gap:10px;align-items:flex-start;">
              <input type="checkbox" name="study">
              <span><strong>The Study</strong><br><small>Gain a 10% bonus to experience points (XP) earned from missions.</small></span>
            </label>
            <label style="display:flex;gap:10px;align-items:flex-start;">
              <input type="checkbox" name="fortuneSeeker">
              <span><strong>Fortune Seeker</strong><br><small>Gain a 10% bonus to gold pieces (GP) earned from missions.</small></span>
            </label>
            <label style="display:flex;gap:10px;align-items:flex-start;">
              <input type="checkbox" name="fastLearner">
              <span><strong>Fast Learner</strong><br><small>Gain a 5% bonus to experience points (XP) earned from missions.</small></span>
            </label>
          </div>
          <hr>
          <div style="display:grid;gap:8px;margin-top:12px;">
            <div><strong>Reward:</strong> <span data-avrb-reward-xp></span> XP · <span data-avrb-reward-gold></span>g · <span data-avrb-reward-credits></span>sc</div>
            <div data-avrb-bonuses style="min-height:1.2em;"></div>
            <div><strong>Current:</strong> ${this.esc(ActorVaultMetaShop.balanceLabel(current))}</div>
            <div><strong>After Claim:</strong> <span data-avrb-after></span></div>
          </div>
        </form>`,
      render: (_event, dialog) => {
        renderDialog = dialog;
        const root = dialog.element;
        const form = root.querySelector(".avrb-reward-form");
        if (!form) return;

        const xpEl = root.querySelector("[data-avrb-reward-xp]");
        const goldEl = root.querySelector("[data-avrb-reward-gold]");
        const creditsEl = root.querySelector("[data-avrb-reward-credits]");
        const bonusEl = root.querySelector("[data-avrb-bonuses]");
        const afterEl = root.querySelector("[data-avrb-after]");

        const update = () => {
          const bonuses = {
            study: Boolean(form.elements.study?.checked),
            fortuneSeeker: Boolean(form.elements.fortuneSeeker?.checked),
            fastLearner: Boolean(form.elements.fastLearner?.checked)
          };
          const amounts = this.rewardAmounts(reward, bonuses);
          const after = {
            ...current,
            xp: (Number(current.xp) || 0) + amounts.xp,
            gold: (Number(current.gold) || 0) + amounts.gold,
            credits: (Number(current.credits) || 0) + amounts.credits
          };
          const labels = this.bonusLabels(amounts);

          if (xpEl) xpEl.textContent = amounts.xp.toLocaleString();
          if (goldEl) goldEl.textContent = amounts.gold.toLocaleString();
          if (creditsEl) creditsEl.textContent = amounts.credits.toLocaleString();
          if (bonusEl) bonusEl.textContent = labels.length ? labels.join(" · ") : "No bonus selected";
          if (afterEl) afterEl.textContent = ActorVaultMetaShop.balanceLabel(after);
        };

        for (const input of form.querySelectorAll('input[type="checkbox"]')) {
          input.addEventListener("input", update);
          input.addEventListener("change", update);
        }
        update();
      },
      buttons: [
        {
          action: "claim",
          label: "Claim Session Rewards",
          default: true,
          callback: () => {
            const form = renderDialog?.element?.querySelector(".avrb-reward-form");
            return {
              study: Boolean(form?.elements?.study?.checked),
              fortuneSeeker: Boolean(form?.elements?.fortuneSeeker?.checked),
              fastLearner: Boolean(form?.elements?.fastLearner?.checked)
            };
          }
        },
        { action: "cancel", label: "Cancel" }
      ]
    });

    return result && result !== "cancel" ? result : null;
  }

  static install() {
    if (this.installed || !globalThis.ActorVaultMetaShop) return;
    this.installed = true;

    const shop = globalThis.ActorVaultMetaShop;
    this.originalExecute = shop.execute.bind(shop);
    this.originalEnhance = shop.enhance.bind(shop);

    shop.execute = async (action, data, requesterId) => {
      if (action !== "reward") return this.originalExecute(action, data, requesterId);
      if (!globalThis.ActorVaultLedger) throw new Error("Persistent Resource Ledger is unavailable.");

      const { requester, target } = shop.auth(data.userId, requesterId);
      const level = Math.trunc(Number(data.level) || 0);
      const reward = shop.rewards[level];
      if (!reward) throw new Error("Select a valid reward level.");

      const amounts = this.rewardAmounts(reward, data.bonuses || {});
      const labels = this.bonusLabels(amounts);
      await ActorVaultLedger.transact(target.id, {
        type: "reward",
        action: `Session Rewards — Level ${level}: +${amounts.xp} XP, +${amounts.gold}g, +${amounts.credits}sc${labels.length ? ` (${labels.join(", ")})` : ""}`,
        delta: { xp: amounts.xp, gold: amounts.gold, credits: amounts.credits },
        editorUserId: requester.id,
        metadata: {
          level,
          baseXp: reward.xp,
          baseGold: reward.gold,
          baseCredits: reward.credits,
          bonuses: {
            study: amounts.study,
            fortuneSeeker: amounts.fortuneSeeker,
            fastLearner: amounts.fastLearner
          },
          finalXp: amounts.xp,
          finalGold: amounts.gold
        }
      });
      return { message: `Level ${level} session rewards added to ${target.name}.` };
    };

    shop.enhance = (app, element) => {
      this.originalEnhance(app, element);
      if (app?.id !== "actor-vault-app" || !globalThis.ActorVaultLedger) return;
      const root = element instanceof HTMLElement ? element : element?.[0] || app.element;
      const form = root?.querySelector("form[data-resource-form]");
      const tools = root?.querySelector("[data-avms-tools]");
      if (!root || !form || !tools) return;

      tools.querySelector(".avms-study")?.remove();
      const oldButton = tools.querySelector("[data-avms-reward]");
      if (!oldButton) return;

      const button = oldButton.cloneNode(true);
      oldButton.replaceWith(button);
      button.addEventListener("click", async () => {
        const level = Number(tools.querySelector("[data-avms-level]")?.value || 1);
        const reward = shop.rewards[level];
        const userId = form.dataset.userId;
        const current = ActorVaultLedger.getResources(userId);
        const bonuses = await this.prompt(level, reward, current);
        if (!bonuses) return;

        button.disabled = true;
        try {
          const result = await shop.request("reward", { userId, level, bonuses });
          ui.notifications.info(result.message);
          await app.render({ force: true });
        } catch (error) {
          console.error(`${AVRB_MODULE_ID} | Reward claim failed`, error);
          ui.notifications.error(error.message);
          button.disabled = false;
        }
      });
    };
  }
}

globalThis.ActorVaultRewardBonuses = ActorVaultRewardBonuses;
Hooks.once("ready", () => ActorVaultRewardBonuses.install());

const AVAB_MODULE_ID = "actor-vault";

class ActorVaultApplyBonuses {
  static install() {
    const bonusesApi = globalThis.ActorVaultRewardBonuses;
    const shop = globalThis.ActorVaultMetaShop;
    if (!bonusesApi || !shop || bonusesApi._applyButtonInstalled) return;
    bonusesApi._applyButtonInstalled = true;

    bonusesApi.prompt = async function(level, reward, current) {
      const DialogV2 = foundry.applications.api.DialogV2;
      let applied = { study: false, fortuneSeeker: false, fastLearner: false };

      while (true) {
        const amounts = this.rewardAmounts(reward, applied);
        const after = {
          xp: (Number(current.xp) || 0) + amounts.xp,
          gold: (Number(current.gold) || 0) + amounts.gold,
          credits: (Number(current.credits) || 0) + amounts.credits
        };
        const labels = this.bonusLabels(amounts);

        const checked = key => applied[key] ? " checked" : "";
        const content = `
          <form class="avrb-reward-form">
            <p>Choose any mission reward bonuses that apply to this claim.</p>
            <div style="display:grid;gap:10px;margin:12px 0;">
              <label style="display:flex;gap:10px;align-items:flex-start;">
                <input type="checkbox" name="study"${checked("study")}>
                <span><strong>The Study</strong><br><small>Gain a 10% bonus to experience points (XP) earned from missions.</small></span>
              </label>
              <label style="display:flex;gap:10px;align-items:flex-start;">
                <input type="checkbox" name="fortuneSeeker"${checked("fortuneSeeker")}>
                <span><strong>Fortune Seeker</strong><br><small>Gain a 10% bonus to gold pieces (GP) earned from missions.</small></span>
              </label>
              <label style="display:flex;gap:10px;align-items:flex-start;">
                <input type="checkbox" name="fastLearner"${checked("fastLearner")}>
                <span><strong>Fast Learner</strong><br><small>Gain a 5% bonus to experience points (XP) earned from missions.</small></span>
              </label>
            </div>
            <hr>
            <div style="display:grid;gap:8px;margin-top:12px;">
              <div><strong>Reward:</strong> ${amounts.xp.toLocaleString()} XP · ${amounts.gold.toLocaleString()}g · ${amounts.credits.toLocaleString()}sc</div>
              <div><strong>Applied:</strong> ${labels.length ? this.esc(labels.join(" · ")) : "No bonuses"}</div>
              <div><strong>Current:</strong> ${this.esc(shop.balanceLabel(current))}</div>
              <div><strong>After Claim:</strong> ${this.esc(shop.balanceLabel(after))}</div>
            </div>
          </form>`;

        const result = await DialogV2.wait({
          window: { title: `Claim Level ${level} Session Rewards` },
          modal: true,
          content,
          buttons: [
            {
              action: "apply",
              label: "Apply Bonuses",
              callback: (_event, _button, dialog) => {
                const root = dialog?.element;
                const form = root?.querySelector?.(".avrb-reward-form");
                return {
                  kind: "apply",
                  bonuses: {
                    study: Boolean(form?.querySelector('[name="study"]')?.checked),
                    fortuneSeeker: Boolean(form?.querySelector('[name="fortuneSeeker"]')?.checked),
                    fastLearner: Boolean(form?.querySelector('[name="fastLearner"]')?.checked)
                  }
                };
              }
            },
            {
              action: "claim",
              label: "Claim Session Rewards",
              default: true,
              callback: () => ({ kind: "claim", bonuses: { ...applied } })
            },
            { action: "cancel", label: "Cancel" }
          ]
        });

        if (!result || result === "cancel") return null;

        if (result.kind === "apply") {
          applied = result.bonuses;
          continue;
        }

        if (result.kind === "claim") return result.bonuses;
      }
    };

    console.log(`${AVAB_MODULE_ID} | Native Apply Bonuses reward flow ready`);
  }
}

Hooks.once("ready", () => ActorVaultApplyBonuses.install());

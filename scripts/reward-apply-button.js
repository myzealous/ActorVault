const AVAB_MODULE_ID = "actor-vault";

class ActorVaultApplyBonuses {
  static install() {
    const bonusesApi = globalThis.ActorVaultRewardBonuses;
    const shop = globalThis.ActorVaultMetaShop;
    if (!bonusesApi || !shop || bonusesApi._applyButtonInstalled) return;
    bonusesApi._applyButtonInstalled = true;

    bonusesApi.prompt = async function(level, reward, current) {
      const DialogV2 = foundry.applications.api.DialogV2;
      const baseAmounts = this.rewardAmounts(reward, {});
      const baseAfter = {
        xp: (Number(current.xp) || 0) + baseAmounts.xp,
        gold: (Number(current.gold) || 0) + baseAmounts.gold,
        credits: (Number(current.credits) || 0) + baseAmounts.credits
      };

      // Foundry v13 DialogV2 requires an HTMLElement content root with NO attributes.
      // Keep the wrapper completely bare and put classes/data on its child form.
      const content = document.createElement("div");
      const form = document.createElement("form");
      form.className = "avrb-reward-form";
      form.innerHTML = `
        <p>Choose any mission reward bonuses that apply to this claim.</p>
        <div style="display:grid;gap:10px;margin:12px 0;">
          <label style="display:flex;gap:10px;align-items:flex-start;"><input type="checkbox" name="study"><span><strong>The Study</strong><br><small>Gain a 10% bonus to experience points (XP) earned from missions.</small></span></label>
          <label style="display:flex;gap:10px;align-items:flex-start;"><input type="checkbox" name="fortuneSeeker"><span><strong>Fortune Seeker</strong><br><small>Gain a 10% bonus to gold pieces (GP) earned from missions.</small></span></label>
          <label style="display:flex;gap:10px;align-items:flex-start;"><input type="checkbox" name="fastLearner"><span><strong>Fast Learner</strong><br><small>Gain a 5% bonus to experience points (XP) earned from missions.</small></span></label>
        </div>
        <div style="display:flex;justify-content:flex-end;margin:10px 0 14px;"><button type="button" data-avab-apply style="min-width:150px;">Apply Bonuses</button></div>
        <hr>
        <div style="display:grid;gap:8px;margin-top:12px;">
          <div><strong>Reward:</strong> <span data-avab-xp>${baseAmounts.xp.toLocaleString()}</span> XP · <span data-avab-gold>${baseAmounts.gold.toLocaleString()}</span>g · <span data-avab-credits>${baseAmounts.credits.toLocaleString()}</span>sc</div>
          <div data-avab-label>Applied: No bonuses</div>
          <div><strong>Current:</strong> ${this.esc(shop.balanceLabel(current))}</div>
          <div><strong>After Claim:</strong> <span data-avab-after>${this.esc(shop.balanceLabel(baseAfter))}</span></div>
        </div>`;
      content.append(form);

      let applied = { study:false, fortuneSeeker:false, fastLearner:false };
      const applyButton = form.querySelector("[data-avab-apply]");
      applyButton.addEventListener("click", () => {
        applied = {
          study: Boolean(form.querySelector('[name="study"]')?.checked),
          fortuneSeeker: Boolean(form.querySelector('[name="fortuneSeeker"]')?.checked),
          fastLearner: Boolean(form.querySelector('[name="fastLearner"]')?.checked)
        };
        const amounts = this.rewardAmounts(reward, applied);
        const after = {
          xp: (Number(current.xp) || 0) + amounts.xp,
          gold: (Number(current.gold) || 0) + amounts.gold,
          credits: (Number(current.credits) || 0) + amounts.credits
        };
        const labels = this.bonusLabels(amounts);
        form.querySelector("[data-avab-xp]").textContent = amounts.xp.toLocaleString();
        form.querySelector("[data-avab-gold]").textContent = amounts.gold.toLocaleString();
        form.querySelector("[data-avab-credits]").textContent = amounts.credits.toLocaleString();
        form.querySelector("[data-avab-label]").textContent = labels.length ? `Applied: ${labels.join(" · ")}` : "Applied: No bonuses";
        form.querySelector("[data-avab-after]").textContent = shop.balanceLabel(after);
        applyButton.textContent = "Bonuses Applied";
        setTimeout(() => { if (applyButton.isConnected) applyButton.textContent = "Apply Bonuses"; }, 900);
      });

      const result = await DialogV2.wait({
        window:{ title:`Claim Level ${level} Session Rewards` },
        modal:true,
        content,
        buttons:[
          { action:"claim", label:"Claim Session Rewards", default:true, callback:() => ({ ...applied }) },
          { action:"cancel", label:"Cancel" }
        ]
      });
      return result && result !== "cancel" ? result : null;
    };

    console.log(`${AVAB_MODULE_ID} | Apply Bonuses reward flow ready`);
  }
}

Hooks.once("ready", () => ActorVaultApplyBonuses.install());

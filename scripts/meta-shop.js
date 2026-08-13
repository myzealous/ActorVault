const AVMS_MODULE_ID = "actor-vault";
const AVMS_SOCKET = `module.${AVMS_MODULE_ID}-meta-shop`;

class ActorVaultMetaShop {
  static pending = new Map();

  static rewards = {
    1:{xp:500,gold:70,credits:4},2:{xp:1000,gold:130,credits:4},3:{xp:1500,gold:230,credits:4},4:{xp:1600,gold:370,credits:4},5:{xp:1700,gold:550,credits:5},
    6:{xp:1800,gold:770,credits:5},7:{xp:1900,gold:1030,credits:5},8:{xp:2000,gold:1330,credits:5},9:{xp:2200,gold:1670,credits:5},10:{xp:2200,gold:2050,credits:6},
    11:{xp:2200,gold:2470,credits:6},12:{xp:2200,gold:2930,credits:6},13:{xp:2200,gold:3430,credits:6},14:{xp:2300,gold:3970,credits:6},15:{xp:2300,gold:4550,credits:7},
    16:{xp:2300,gold:5170,credits:7},17:{xp:2400,gold:5830,credits:7},18:{xp:2400,gold:6530,credits:7},19:{xp:2500,gold:7270,credits:8},20:{xp:2500,gold:8050,credits:8}
  };

  static items = {
    scrollCantrip:{group:"Purchase Spell Scrolls",name:"Cantrip Scroll",gold:15,credits:1},
    scroll1:{group:"Purchase Spell Scrolls",name:"1st-Level Scroll",gold:25,credits:1},
    scroll2:{group:"Purchase Spell Scrolls",name:"2nd-Level Scroll",gold:100,credits:3},
    scroll3:{group:"Purchase Spell Scrolls",name:"3rd-Level Scroll",gold:150,credits:5},
    magicUncommon:{group:"Craft Magic Items",name:"Uncommon Magic Item",gold:500,credits:10},
    magicRare:{group:"Craft Magic Items",name:"Rare Magic Item",gold:5000,credits:50},
    magicVeryRare:{group:"Craft Magic Items",name:"Very Rare Magic Item",gold:50000,credits:125},
    magicLegendary:{group:"Craft Magic Items",name:"Legendary Magic Item",gold:250000,credits:250},
    potionCommon:{group:"Craft Potions",name:"Common Potion",gold:25,credits:0},
    potionUncommon:{group:"Craft Potions",name:"Uncommon Potion",gold:100,credits:0},
    potionRare:{group:"Craft Potions",name:"Rare Potion",gold:500,credits:0},
    potionVeryRare:{group:"Craft Potions",name:"Very Rare Potion",gold:1000,credits:0},
    balancing:{group:"Forge",name:"Weapon Balancing",gold:100,credits:2,description:"Each degree gives a weapon +1 attack / -1 damage or -1 attack / +1 damage. May be purchased any number of times."},
    scry:{group:"Arcanum",name:"Scry a Hex",gold:50,credits:1,description:"Scry one hex."},
    spellRestore:{group:"Arcanum",name:"Spell Restoration",gold:0,credits:3,description:"Restore all of your spell slots."},
    rejuvenate:{group:"Sanctum",name:"Rejuvenate",gold:0,credits:2,description:"Regain all of your Hit Dice."},
    horse:{group:"Bulwark",name:"Horse",gold:10,credits:1},
    warhorse:{group:"Bulwark",name:"Warhorse",gold:100,credits:3},
    inspiring:{group:"Theater",name:"Inspiring Performance",gold:15,credits:1,description:"Gain a special 1d8 Bardic Inspiration die that may be held until the end of the next mission."},
    temporaryTraining:{group:"Theater",name:"Temporary Training",gold:30,credits:1,description:"Gain proficiency in one skill or tool until the end of the next mission."},
    aria:{group:"Theater",name:"Aria of the Axebeak",gold:50,credits:2,description:"Gain a bonus against monstrosities until the end of the next mission."},
    comedy:{group:"Theater",name:"Comedy of Constructs",gold:50,credits:2,description:"Gain a bonus against constructs until the end of the next mission."},
    mirrorProficiency:{group:"The Mirror",name:"Proficiency Swap",gold:0,credits:5,requiresHousing:2},
    mirrorFeature:{group:"The Mirror",name:"Feature Swap",gold:0,credits:10,requiresHousing:2},
    mirrorFeat:{group:"The Mirror",name:"Feat Swap",gold:0,credits:20,requiresHousing:2},
    mirrorRespec:{group:"The Mirror",name:"Skill Tree Respec",dynamic:"respec",requiresHousing:2,description:"5sc for the first respec, then +10sc for each additional respec."}
  };

  static housing = {
    1:{name:"Homestead",gold:250,credits:5},
    2:{name:"House",gold:1000,credits:15},
    3:{name:"Manor",gold:4000,credits:40},
    4:{name:"Estate",gold:10000,credits:80}
  };

  static esc(value) { return foundry.utils.escapeHTML(String(value ?? "")); }
  static primaryGM() { return game.users.filter(user => user.active && user.isGM).sort((a,b) => a.id.localeCompare(b.id))[0] || null; }

  static async request(action, data = {}) {
    if (game.user.isGM) return this.execute(action, data, game.user.id);
    if (!this.primaryGM()) throw new Error("Meta Shop requires an active GM.");
    const requestId = foundry.utils.randomID(20);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("Meta Shop request timed out."));
      }, 20000);
      this.pending.set(requestId, { resolve, reject, timeout });
      game.socket.emit(AVMS_SOCKET, { kind:"request", requestId, action, data, requesterId:game.user.id });
    });
  }

  static async onSocket(payload) {
    if (!payload || typeof payload !== "object") return;
    if (payload.kind === "response" && payload.targetUserId === game.user.id) {
      const pending = this.pending.get(payload.requestId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(payload.requestId);
      payload.ok ? pending.resolve(payload.result) : pending.reject(new Error(payload.error || "Meta Shop operation failed."));
      return;
    }
    if (payload.kind !== "request") return;
    if (!game.user.isGM || game.user.id !== this.primaryGM()?.id) return;
    let response;
    try { response = { ok:true, result:await this.execute(payload.action, payload.data, payload.requesterId) }; }
    catch (error) { console.error("actor-vault | Meta Shop request failed", error); response = { ok:false, error:error.message }; }
    game.socket.emit(AVMS_SOCKET, { kind:"response", requestId:payload.requestId, targetUserId:payload.requesterId, ...response });
  }

  static auth(userId, requesterId) {
    const requester = game.users.get(requesterId);
    const target = game.users.get(userId);
    if (!requester || !target) throw new Error("Player not found.");
    if (!requester.isGM && requester.id !== target.id) throw new Error("You may only use the Meta Shop for yourself.");
    return { requester, target };
  }

  static costFor(def, resources) {
    const count = Math.max(0, Math.trunc(Number(resources.skillTreeRespecCount) || 0));
    return def.dynamic === "respec" ? { gold:0, credits:5+(10*count), xp:0 } : { gold:def.gold||0, credits:def.credits||0, xp:def.xp||0 };
  }

  static costLabel(cost) {
    const parts = [];
    if (cost.gold) parts.push(`${Number(cost.gold).toLocaleString()}g`);
    if (cost.credits) parts.push(`${Number(cost.credits).toLocaleString()}sc`);
    if (cost.xp) parts.push(`${Number(cost.xp).toLocaleString()} XP`);
    return parts.join(" + ") || "Free";
  }

  static balanceLabel(resources) {
    return `${Number(resources.gold || 0).toLocaleString()}g · ${Number(resources.credits || 0).toLocaleString()}sc · ${Number(resources.xp || 0).toLocaleString()} XP`;
  }

  static remaining(resources, cost) {
    return {
      gold:(Number(resources.gold)||0)-(Number(cost.gold)||0),
      credits:(Number(resources.credits)||0)-(Number(cost.credits)||0),
      xp:(Number(resources.xp)||0)-(Number(cost.xp)||0)
    };
  }

  static async execute(action, data, requesterId) {
    if (!globalThis.ActorVaultLedger) throw new Error("Persistent Resource Ledger is unavailable.");

    if (action === "purchase") {
      const def = this.items[data.itemId];
      if (!def) throw new Error("Unknown Meta Shop purchase.");
      const { requester, target } = this.auth(data.userId, requesterId);
      const resources = ActorVaultLedger.getResources(target.id);
      if (def.requiresHousing && resources.housingTier < def.requiresHousing) throw new Error(`${def.name} requires House or better.`);
      const cost = this.costFor(def, resources);
      const set = def.dynamic === "respec" ? { skillTreeRespecCount: resources.skillTreeRespecCount + 1 } : {};
      await ActorVaultLedger.transact(target.id, {
        type:"shop",
        action:`Meta Shop — ${def.name} (${this.costLabel(cost)})`,
        delta:{ gold:-cost.gold, credits:-cost.credits, xp:-cost.xp },
        set,
        editorUserId:requester.id,
        metadata:{ itemId:data.itemId, group:def.group, cost }
      });
      return { message:`${target.name} purchased ${def.name}.` };
    }

    if (action === "housingUpgrade") {
      const { requester, target } = this.auth(data.userId, requesterId);
      const tier = Math.trunc(Number(data.tier) || 0);
      const def = this.housing[tier];
      if (!def) throw new Error("Unknown housing tier.");
      const resources = ActorVaultLedger.getResources(target.id);
      if (tier !== resources.housingTier + 1) throw new Error("Housing must be upgraded one tier at a time.");
      await ActorVaultLedger.transact(target.id, {
        type:"housing",
        action:`Meta Shop — Housing Upgrade: ${def.name} (${this.costLabel(def)})`,
        delta:{ gold:-def.gold, credits:-def.credits },
        set:{ housingTier:tier },
        editorUserId:requester.id,
        metadata:{ tier, name:def.name, cost:{gold:def.gold,credits:def.credits} }
      });
      return { message:`${target.name} upgraded housing to ${def.name}.` };
    }

    if (action === "study") {
      const { requester, target } = this.auth(data.userId, requesterId);
      const enabled = Boolean(data.enabled);
      await ActorVaultLedger.transact(target.id, {
        type:"toggle",
        action:`The Study ${enabled ? "enabled" : "disabled"}`,
        set:{ studyBonus:enabled },
        editorUserId:requester.id,
        metadata:{ feature:"study", enabled }
      });
      return { message:`The Study bonus is ${enabled ? "enabled" : "disabled"}.` };
    }

    if (action === "reward") {
      const { requester, target } = this.auth(data.userId, requesterId);
      const level = Math.trunc(Number(data.level) || 0);
      const reward = this.rewards[level];
      if (!reward) throw new Error("Select a valid reward level.");
      const resources = ActorVaultLedger.getResources(target.id);
      const xp = resources.studyBonus ? Math.round(reward.xp * 1.10) : reward.xp;
      await ActorVaultLedger.transact(target.id, {
        type:"reward",
        action:`Session Rewards — Level ${level}: +${xp} XP, +${reward.gold}g, +${reward.credits}sc${resources.studyBonus ? " (Study +10% XP)" : ""}`,
        delta:{ xp, gold:reward.gold, credits:reward.credits },
        editorUserId:requester.id,
        metadata:{ level, studyBonus:resources.studyBonus, baseXp:reward.xp }
      });
      return { message:`Level ${level} session rewards added to ${target.name}.` };
    }

    if (action === "loan") {
      return data.mode === "take"
        ? ActorVaultLedger.takeLoan(data.userId, data.loanId, requesterId)
        : ActorVaultLedger.repayLoan(data.userId, data.loanId, requesterId);
    }
    throw new Error(`Unknown Meta Shop action: ${action}`);
  }

  static line(itemId, userId) {
    const def = this.items[itemId];
    const resources = ActorVaultLedger.getResources(userId);
    const cost = this.costFor(def, resources);
    const locked = Boolean(def.requiresHousing && resources.housingTier < def.requiresHousing);
    return `<div class="avms-line"><span><strong>${this.esc(def.name)}</strong><small>${this.esc(this.costLabel(cost))}${locked ? " — Requires House or better" : ""}</small>${def.description ? `<small class="avms-description">${this.esc(def.description)}</small>` : ""}</span><button type="button" data-avms-buy="${itemId}" ${locked ? "disabled" : ""}>Buy</button></div>`;
  }

  static shopMarkup(userId) {
    const groups = ["Purchase Spell Scrolls","Craft Magic Items","Craft Potions","Forge","Arcanum","Sanctum","Bulwark","Theater","The Mirror"];
    const resources = ActorVaultLedger.getResources(userId);
    const loans = ActorVaultLedger.getLoans(userId);
    const sections = groups.map(group => `<section class="avms-group"><h3>${this.esc(group)}</h3>${Object.entries(this.items).filter(([,def]) => def.group === group).map(([id]) => this.line(id,userId)).join("")}</section>`).join("");
    const defs = ActorVaultLedger.loanDefinitions();
    const loanCard = id => {
      const def = defs[id];
      const active = Boolean(loans?.[id]?.active);
      return `<div class="avms-line"><span><strong>${this.esc(def.name)}</strong><small>Receive ${this.esc(def.receiveLabel)} · Repay ${this.esc(def.repayLabel)} · Limit 1 active</small></span><button type="button" data-avms-loan="${id}" data-mode="${active ? "repay" : "take"}">${active ? "Pay Loan" : "Take Loan"}</button></div>`;
    };
    const housingRows = Object.entries(this.housing).map(([tier,def]) => {
      const value = Number(tier);
      const allowed = value === resources.housingTier + 1;
      const done = value <= resources.housingTier;
      return `<div class="avms-line"><span><strong>${def.name}</strong><small>${this.costLabel(def)}</small></span><button type="button" data-avms-housing="${value}" ${allowed ? "" : "disabled"}>${done ? "Owned" : allowed ? "Upgrade" : "Locked"}</button></div>`;
    }).join("");
    return `<div class="avms-shop"><section class="avms-group"><h3>Guildhall</h3>${loanCard("ironContract")}${loanCard("trainingGrounds")}</section>${sections}<section class="avms-group"><h3>Housing Upgrade</h3><p>Housing must progress one tier at a time.</p>${housingRows}</section></div>`;
  }

  static async confirmPurchase(userId, def) {
    const resources = ActorVaultLedger.getResources(userId);
    const cost = this.costFor(def, resources);
    const after = this.remaining(resources, cost);
    return foundry.applications.api.DialogV2.confirm({
      window:{title:`Purchase ${def.name}`},
      content:`<p><strong>${this.esc(def.name)}</strong></p>${def.description ? `<p>${this.esc(def.description)}</p>` : ""}<p>Cost: <strong>${this.esc(this.costLabel(cost))}</strong></p><p>Current: ${this.esc(this.balanceLabel(resources))}<br>After purchase: <strong>${this.esc(this.balanceLabel(after))}</strong></p>`,
      yes:{label:"Purchase"}, no:{label:"Cancel"}, modal:true
    });
  }

  static async confirmHousing(userId, tier) {
    const def = this.housing[tier];
    const resources = ActorVaultLedger.getResources(userId);
    const after = this.remaining(resources, def);
    return foundry.applications.api.DialogV2.confirm({
      window:{title:`Upgrade to ${def.name}`},
      content:`<p>Upgrade housing to <strong>${this.esc(def.name)}</strong>?</p><p>Cost: <strong>${this.esc(this.costLabel(def))}</strong></p><p>Current: ${this.esc(this.balanceLabel(resources))}<br>After purchase: <strong>${this.esc(this.balanceLabel(after))}</strong></p>`,
      yes:{label:"Upgrade"}, no:{label:"Cancel"}, modal:true
    });
  }

  static async openShop(userId, app) {
    const user = game.users.get(userId);
    if (!user) return;
    const dialog = new foundry.applications.api.DialogV2({
      window:{ title:`Meta Shop — ${user.name}`, resizable:true },
      position:{ width:950, height:760 },
      content:this.shopMarkup(userId),
      buttons:[{ action:"close", label:"Close", default:true }]
    });
    await dialog.render({ force:true });
    const root = dialog.element;
    const run = async (action,data) => {
      root.querySelectorAll("button").forEach(button => button.disabled = true);
      try {
        const result = await this.request(action,{ userId,...data });
        ui.notifications.info(result.message);
        await dialog.close();
        await app.render({ force:true });
      } catch (error) {
        ui.notifications.error(error.message);
        root.querySelectorAll("button").forEach(button => button.disabled = false);
      }
    };
    root.querySelectorAll("[data-avms-buy]").forEach(button => button.addEventListener("click", async () => {
      const def = this.items[button.dataset.avmsBuy];
      if (await this.confirmPurchase(userId, def)) run("purchase",{ itemId:button.dataset.avmsBuy });
    }));
    root.querySelectorAll("[data-avms-housing]").forEach(button => button.addEventListener("click", async () => {
      const tier = Number(button.dataset.avmsHousing);
      if (await this.confirmHousing(userId, tier)) run("housingUpgrade",{ tier });
    }));
    root.querySelectorAll("[data-avms-loan]").forEach(button => button.addEventListener("click", async () => {
      const mode = button.dataset.mode;
      const def = ActorVaultLedger.loanDefinitions()[button.dataset.avmsLoan];
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        window:{title:mode === "take" ? `Take ${def.name}` : `Pay ${def.name}`},
        content:`<p>${mode === "take" ? `Receive <strong>${this.esc(def.receiveLabel)}</strong> and owe <strong>${this.esc(def.repayLabel)}</strong>.` : `Repay <strong>${this.esc(def.repayLabel)}</strong> and close this contract.`}</p>`,
        yes:{label:mode === "take" ? "Take Loan" : "Pay Loan"}, no:{label:"Cancel"}, modal:true
      });
      if (confirmed) run("loan",{ loanId:button.dataset.avmsLoan, mode });
    }));
  }

  static enhance(app, element) {
    if (app?.id !== "actor-vault-app" || !globalThis.ActorVaultLedger) return;
    const root = element instanceof HTMLElement ? element : element?.[0] || app.element;
    const form = root?.querySelector("form[data-resource-form]");
    if (!root || !form) return;

    root.querySelector("[data-avl-loans]")?.remove();
    const userId = form.dataset.userId;
    const resources = ActorVaultLedger.getResources(userId);
    const housing = root.querySelector("[data-housing-tier]");
    if (housing && !game.user.isGM) { housing.disabled = true; housing.title = "Upgrade housing through the Meta Shop."; }

    let tools = root.querySelector("[data-avms-tools]");
    if (!tools) {
      tools = document.createElement("section");
      tools.dataset.avmsTools = "true";
      tools.className = "avms-tools";
      root.querySelector(".avd-storage-heading")?.insertAdjacentElement("beforebegin", tools);
    }
    const options = Object.entries(this.rewards).map(([level,reward]) => `<option value="${level}">Level ${level} — ${reward.xp} XP / ${reward.gold}g / ${reward.credits}sc</option>`).join("");
    tools.innerHTML = `<div class="avms-tools__row"><button type="button" data-avms-open><i class="fas fa-store"></i> Meta Shop</button><label class="avms-study"><input type="checkbox" data-avms-study ${resources.studyBonus ? "checked" : ""}><span><strong>The Study</strong><small>+10% bonus XP on session rewards while enabled.</small></span></label></div><div class="avms-rewards"><label><span>Rewards</span><select data-avms-level>${options}</select></label><button type="button" data-avms-reward>Claim Session Rewards</button></div>`;

    tools.querySelector("[data-avms-open]")?.addEventListener("click", () => this.openShop(userId,app).catch(error => ui.notifications.error(error.message)));
    tools.querySelector("[data-avms-study]")?.addEventListener("change", async event => {
      event.currentTarget.disabled = true;
      try { const result = await this.request("study",{userId,enabled:event.currentTarget.checked}); ui.notifications.info(result.message); await app.render({force:true}); }
      catch (error) { ui.notifications.error(error.message); event.currentTarget.disabled = false; }
    });
    tools.querySelector("[data-avms-reward]")?.addEventListener("click", async () => {
      const level = Number(tools.querySelector("[data-avms-level]")?.value || 1);
      const reward = this.rewards[level];
      const current = ActorVaultLedger.getResources(userId);
      const xp = current.studyBonus ? Math.round(reward.xp*1.10) : reward.xp;
      const after = { ...current, xp:current.xp+xp, gold:current.gold+reward.gold, credits:current.credits+reward.credits };
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        window:{title:`Claim Level ${level} Session Rewards`},
        content:`<p>Add <strong>${xp} XP, ${reward.gold}g, and ${reward.credits}sc</strong>${current.studyBonus ? " (The Study +10% XP applied)" : ""}?</p><p>Current: ${this.esc(this.balanceLabel(current))}<br>After claim: <strong>${this.esc(this.balanceLabel(after))}</strong></p>`,
        yes:{label:"Claim Session Rewards"}, no:{label:"Cancel"}, modal:true
      });
      if (!confirmed) return;
      try { const result = await this.request("reward",{userId,level}); ui.notifications.info(result.message); await app.render({force:true}); }
      catch (error) { ui.notifications.error(error.message); }
    });
  }
}

globalThis.ActorVaultMetaShop = ActorVaultMetaShop;
Hooks.once("ready", () => game.socket.on(AVMS_SOCKET, payload => ActorVaultMetaShop.onSocket(payload)));
Hooks.on("renderApplicationV2", (app, element) => {
  if (app?.id !== "actor-vault-app") return;
  for (const delay of [225,400,650]) setTimeout(() => ActorVaultMetaShop.enhance(app,element), delay);
});

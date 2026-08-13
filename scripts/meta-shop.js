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
    balancing:{group:"Forge",name:"Weapon Balancing",gold:100,credits:2},
    scry:{group:"Arcanum",name:"Scry a Hex",gold:50,credits:1},
    spellRestore:{group:"Arcanum",name:"Spell Restoration",gold:0,credits:3},
    rejuvenate:{group:"Sanctum",name:"Rejuvenate",gold:0,credits:2},
    horse:{group:"Bulwark",name:"Horse",gold:10,credits:1},
    warhorse:{group:"Bulwark",name:"Warhorse",gold:100,credits:3},
    inspiring:{group:"Theater",name:"Inspiring Performance",gold:15,credits:1},
    temporaryTraining:{group:"Theater",name:"Temporary Training",gold:30,credits:1},
    aria:{group:"Theater",name:"Aria of the Axebeak",gold:50,credits:2},
    comedy:{group:"Theater",name:"Comedy of Constructs",gold:50,credits:2},
    mirrorProficiency:{group:"The Mirror",name:"Proficiency Swap",gold:0,credits:5,requiresHousing:2},
    mirrorFeature:{group:"The Mirror",name:"Feature Swap",gold:0,credits:10,requiresHousing:2},
    mirrorFeat:{group:"The Mirror",name:"Feat Swap",gold:0,credits:20,requiresHousing:2},
    mirrorRespec:{group:"The Mirror",name:"Skill Tree Respec",dynamic:"respec",requiresHousing:2}
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

  static costLabel(cost) {
    const parts = [];
    if (cost.gold) parts.push(`${Number(cost.gold).toLocaleString()}g`);
    if (cost.credits) parts.push(`${cost.credits}sc`);
    if (cost.xp) parts.push(`${cost.xp} XP`);
    return parts.join(" + ") || "Free";
  }

  static async spend(userId, name, cost, requesterId, extra = {}) {
    const { requester, target } = this.auth(userId, requesterId);
    const previous = ActorVaultLedger.getResources(target.id);
    if (previous.gold < (cost.gold || 0)) throw new Error(`${name} requires ${Number(cost.gold || 0).toLocaleString()} gold.`);
    if (previous.credits < (cost.credits || 0)) throw new Error(`${name} requires ${cost.credits || 0} Server Credits.`);
    const next = { ...previous, gold:previous.gold-(cost.gold||0), credits:previous.credits-(cost.credits||0), ...extra };
    await ActorVaultLedger.commitResources(target.id, next, { previous, editorUserId:requester.id, action:`Meta Shop — ${name} (${this.costLabel(cost)})` });
    return { message:`${target.name} purchased ${name}.` };
  }

  static async execute(action, data, requesterId) {
    if (!globalThis.ActorVaultLedger) throw new Error("Persistent Resource Ledger is unavailable.");

    if (action === "purchase") {
      const def = this.items[data.itemId];
      if (!def) throw new Error("Unknown Meta Shop purchase.");
      const { target } = this.auth(data.userId, requesterId);
      const resources = ActorVaultLedger.getResources(target.id);
      if (def.requiresHousing && resources.housingTier < def.requiresHousing) throw new Error(`${def.name} requires House or better.`);
      const count = Math.max(0, Math.trunc(Number(resources.skillTreeRespecCount) || 0));
      const cost = def.dynamic === "respec" ? { gold:0, credits:5+(10*count) } : { gold:def.gold||0, credits:def.credits||0 };
      return this.spend(target.id, def.name, cost, requesterId, def.dynamic === "respec" ? { skillTreeRespecCount:count+1 } : {});
    }

    if (action === "housingUpgrade") {
      const { requester, target } = this.auth(data.userId, requesterId);
      const tier = Math.trunc(Number(data.tier) || 0);
      const def = this.housing[tier];
      if (!def) throw new Error("Unknown housing tier.");
      const previous = ActorVaultLedger.getResources(target.id);
      if (tier !== previous.housingTier + 1) throw new Error("Housing must be upgraded one tier at a time.");
      if (previous.gold < def.gold || previous.credits < def.credits) throw new Error(`${def.name} requires ${this.costLabel(def)}.`);
      const next = { ...previous, gold:previous.gold-def.gold, credits:previous.credits-def.credits, housingTier:tier };
      await ActorVaultLedger.commitResources(target.id, next, { previous, editorUserId:requester.id, action:`Meta Shop — Housing Upgrade: ${def.name} (${this.costLabel(def)})` });
      return { message:`${target.name} upgraded housing to ${def.name}.` };
    }

    if (action === "study") {
      const { requester, target } = this.auth(data.userId, requesterId);
      const previous = ActorVaultLedger.getResources(target.id);
      const next = { ...previous, studyBonus:Boolean(data.enabled) };
      await ActorVaultLedger.commitResources(target.id, next, { previous, editorUserId:requester.id, action:`The Study ${next.studyBonus ? "enabled" : "disabled"}` });
      return { message:`The Study bonus is ${next.studyBonus ? "enabled" : "disabled"}.` };
    }

    if (action === "reward") {
      const { requester, target } = this.auth(data.userId, requesterId);
      const level = Math.trunc(Number(data.level) || 0);
      const reward = this.rewards[level];
      if (!reward) throw new Error("Select a valid reward level.");
      const previous = ActorVaultLedger.getResources(target.id);
      const xp = previous.studyBonus ? Math.round(reward.xp * 1.10) : reward.xp;
      const next = { ...previous, xp:previous.xp+xp, gold:previous.gold+reward.gold, credits:previous.credits+reward.credits };
      await ActorVaultLedger.commitResources(target.id, next, { previous, editorUserId:requester.id, action:`Rewards — Level ${level}: +${xp} XP, +${reward.gold}g, +${reward.credits}sc${previous.studyBonus ? " (Study +10% XP)" : ""}` });
      return { message:`Level ${level} rewards added to ${target.name}.` };
    }

    if (action === "loan") return this.loan(data.userId, data.loanId, data.mode, requesterId);
    throw new Error(`Unknown Meta Shop action: ${action}`);
  }

  static async loan(userId, loanId, mode, requesterId) {
    const { requester, target } = this.auth(userId, requesterId);
    const definitions = {
      ironContract:{ name:"The Iron Contract", receive:{gold:250,credits:5,xp:0}, repay:{gold:300,credits:6,xp:0} },
      trainingGrounds:{ name:"Training Grounds", receive:{gold:0,credits:0,xp:1000}, repay:{gold:0,credits:0,xp:1200} }
    };
    const def = definitions[loanId];
    if (!def) throw new Error("Unknown loan contract.");
    const store = ActorVaultLedger.store();
    const entry = ActorVaultLedger.ensureEntryInStore(store, target);
    entry.loans ||= {};
    const active = Boolean(entry.loans[loanId]?.active);
    const previous = ActorVaultLedger.normalizeResources(entry.resources);
    const next = { ...previous };

    if (mode === "take") {
      if (active) throw new Error(`${def.name} is already active.`);
      next.gold += def.receive.gold; next.credits += def.receive.credits; next.xp += def.receive.xp;
      entry.loans[loanId] = { active:true, takenAt:Date.now(), takenByUserId:requester.id };
      entry.history ||= [];
      entry.history.unshift({ timestamp:Date.now(), editorUserId:requester.id, editorName:requester.name, action:`${def.name} — Loan Issued (+${this.costLabel(def.receive)})`, previous, state:foundry.utils.deepClone(next) });
    } else if (mode === "repay") {
      if (!active) throw new Error(`${def.name} is not active.`);
      if (next.gold < def.repay.gold || next.credits < def.repay.credits || next.xp < def.repay.xp) throw new Error(`${def.name} repayment requires ${this.costLabel(def.repay)}.`);
      next.gold -= def.repay.gold; next.credits -= def.repay.credits; next.xp -= def.repay.xp;
      entry.loans[loanId] = { ...entry.loans[loanId], active:false, repaidAt:Date.now(), repaidByUserId:requester.id };
      entry.history ||= [];
      entry.history.unshift({ timestamp:Date.now(), editorUserId:requester.id, editorName:requester.name, action:`${def.name} — Loan Repaid (-${this.costLabel(def.repay)})`, previous, state:foundry.utils.deepClone(next) });
    } else throw new Error("Unknown loan action.");

    entry.resources = foundry.utils.deepClone(next);
    entry.history = entry.history.slice(0, 100);
    entry.updatedAt = Date.now();
    await ActorVaultLedger.write(store);
    await target.setFlag("world", "metaResources", next);
    await target.setFlag("world", "metaResourcesHistory", entry.history.slice(0,30));
    return { message:`${target.name} ${mode === "take" ? "accepted" : "repaid"} ${def.name}.` };
  }

  static line(itemId, userId) {
    const def = this.items[itemId];
    const resources = ActorVaultLedger.getResources(userId);
    const count = Math.max(0, Math.trunc(Number(resources.skillTreeRespecCount) || 0));
    const cost = def.dynamic === "respec" ? { gold:0, credits:5+(10*count) } : { gold:def.gold||0, credits:def.credits||0 };
    const locked = Boolean(def.requiresHousing && resources.housingTier < def.requiresHousing);
    return `<div class="avms-line"><span><strong>${this.esc(def.name)}</strong><small>${this.esc(this.costLabel(cost))}${locked ? " — Requires House or better" : ""}</small></span><button type="button" data-avms-buy="${itemId}" ${locked ? "disabled" : ""}>Buy</button></div>`;
  }

  static shopMarkup(userId) {
    const groups = ["Purchase Spell Scrolls","Craft Magic Items","Craft Potions","Forge","Arcanum","Sanctum","Bulwark","Theater","The Mirror"];
    const resources = ActorVaultLedger.getResources(userId);
    const loans = ActorVaultLedger.getLoans(userId);
    const sections = groups.map(group => {
      const theaterNote = group === "Theater" ? `<p><strong>Unlocked Performances:</strong> Aria of the Axebeak, Comedy of Constructs</p>` : "";
      return `<section class="avms-group"><h3>${this.esc(group)}</h3>${theaterNote}${Object.entries(this.items).filter(([,def]) => def.group === group).map(([id]) => this.line(id,userId)).join("")}</section>`;
    }).join("");
    const loanCard = (id,name,receive,repay) => {
      const active = Boolean(loans?.[id]?.active);
      return `<div class="avms-line"><span><strong>${name}</strong><small>Receive ${receive} · Repay ${repay} · Limit 1 active</small></span><button type="button" data-avms-loan="${id}" data-mode="${active ? "repay" : "take"}">${active ? "Pay Loan" : "Take Loan"}</button></div>`;
    };
    const housingRows = Object.entries(this.housing).map(([tier,def]) => {
      const value = Number(tier);
      const allowed = value === resources.housingTier + 1;
      const done = value <= resources.housingTier;
      return `<div class="avms-line"><span><strong>${def.name}</strong><small>${this.costLabel(def)}</small></span><button type="button" data-avms-housing="${value}" ${allowed ? "" : "disabled"}>${done ? "Owned" : allowed ? "Upgrade" : "Locked"}</button></div>`;
    }).join("");
    return `<div class="avms-shop"><section class="avms-group"><h3>Guildhall</h3>${loanCard("ironContract","The Iron Contract","250g + 5sc","300g + 6sc")}${loanCard("trainingGrounds","Training Grounds","1000 XP","1200 XP")}</section>${sections}<section class="avms-group"><h3>Housing Upgrade</h3><p>Housing must progress one tier at a time.</p>${housingRows}</section></div>`;
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
      const resources = ActorVaultLedger.getResources(userId);
      const count = Math.max(0,Math.trunc(Number(resources.skillTreeRespecCount)||0));
      const cost = def.dynamic === "respec" ? {credits:5+(10*count)} : def;
      const confirmed = await foundry.applications.api.DialogV2.confirm({ window:{title:`Purchase ${def.name}`}, content:`<p>Purchase <strong>${this.esc(def.name)}</strong> for <strong>${this.esc(this.costLabel(cost))}</strong>?</p>`, yes:{label:"Purchase"}, no:{label:"Cancel"}, modal:true });
      if (confirmed) run("purchase",{ itemId:button.dataset.avmsBuy });
    }));
    root.querySelectorAll("[data-avms-housing]").forEach(button => button.addEventListener("click", () => run("housingUpgrade",{ tier:Number(button.dataset.avmsHousing) })));
    root.querySelectorAll("[data-avms-loan]").forEach(button => button.addEventListener("click", async () => {
      const mode = button.dataset.mode;
      const confirmed = await foundry.applications.api.DialogV2.confirm({ window:{title:mode === "take" ? "Take Loan" : "Pay Loan"}, content:`<p>${mode === "take" ? "Accept" : "Repay"} this contract?</p>`, yes:{label:mode === "take" ? "Take Loan" : "Pay Loan"}, no:{label:"Cancel"}, modal:true });
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
    tools.innerHTML = `<div class="avms-tools__row"><button type="button" data-avms-open><i class="fas fa-store"></i> Meta Shop</button><label class="avms-study"><input type="checkbox" data-avms-study ${resources.studyBonus ? "checked" : ""}><span><strong>The Study</strong><small>+10% bonus XP on Rewards while enabled.</small></span></label></div><div class="avms-rewards"><label><span>Rewards</span><select data-avms-level>${options}</select></label><button type="button" data-avms-reward>Claim Reward</button></div>`;

    tools.querySelector("[data-avms-open]")?.addEventListener("click", () => this.openShop(userId,app).catch(error => ui.notifications.error(error.message)));
    tools.querySelector("[data-avms-study]")?.addEventListener("change", async event => {
      event.currentTarget.disabled = true;
      try { const result = await this.request("study",{userId,enabled:event.currentTarget.checked}); ui.notifications.info(result.message); await app.render({force:true}); }
      catch (error) { ui.notifications.error(error.message); event.currentTarget.disabled = false; }
    });
    tools.querySelector("[data-avms-reward]")?.addEventListener("click", async () => {
      const level = Number(tools.querySelector("[data-avms-level]")?.value || 1);
      const reward = this.rewards[level];
      const xp = resources.studyBonus ? Math.round(reward.xp*1.10) : reward.xp;
      const confirmed = await foundry.applications.api.DialogV2.confirm({ window:{title:`Claim Level ${level} Rewards`}, content:`<p>Add <strong>${xp} XP, ${reward.gold}g, and ${reward.credits}sc</strong>${resources.studyBonus ? " (The Study +10% XP applied)" : ""}?</p>`, yes:{label:"Claim Reward"}, no:{label:"Cancel"}, modal:true });
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

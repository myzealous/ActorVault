const MODULE = "actor-vault";
const APP_ID = "actor-vault-app";
let refreshTimer = null;
let refreshing = false;

function vaultApp() {
  return foundry.applications.instances.get(APP_ID) || null;
}

function vaultIsOpen() {
  const app = vaultApp();
  return Boolean(app && (app.rendered || document.getElementById(APP_ID)));
}

function localChange(userId) {
  return !userId || userId === game.user.id;
}

function scheduleVaultRefresh(delay = 350) {
  if (!vaultIsOpen()) return;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refreshVault, delay);
}

async function refreshVault() {
  if (refreshing) return;
  const app = vaultApp();
  if (!app || !vaultIsOpen()) return;
  refreshing = true;
  try {
    await app.close();
    await new Promise(resolve => setTimeout(resolve, 75));
    await app.render({ force: true });
  } catch (error) {
    console.error(`${MODULE} | Vault refresh failed`, error);
    try { await app.render({ force: true }); } catch (_) {}
  } finally {
    refreshing = false;
  }
}

function managedActor(actor) {
  if (!actor) return false;
  if (actor.getFlag?.(MODULE, "record")) return true;
  let folder = actor.folder;
  while (folder) {
    if (folder.name?.trim().toLowerCase() === "players") return true;
    folder = folder.folder;
  }
  return false;
}

Hooks.on("updateActor", (actor, changes, _options, userId) => {
  if (!localChange(userId) || !managedActor(actor)) return;
  if (
    foundry.utils.hasProperty(changes, "flags.skill-tree") ||
    foundry.utils.hasProperty(changes, "flags.actor-vault") ||
    foundry.utils.hasProperty(changes, "ownership") ||
    foundry.utils.hasProperty(changes, "folder")
  ) scheduleVaultRefresh();
});

Hooks.on("createActor", (actor, _options, userId) => {
  if (localChange(userId) && managedActor(actor)) scheduleVaultRefresh(450);
});

Hooks.on("deleteActor", (actor, _options, userId) => {
  if (localChange(userId) && managedActor(actor)) scheduleVaultRefresh(450);
});

Hooks.on("updateUser", (_user, changes, _options, userId) => {
  if (!localChange(userId)) return;
  if (
    foundry.utils.hasProperty(changes, "flags.world.metaResources") ||
    foundry.utils.hasProperty(changes, "flags.world.metaResourcesHistory")
  ) scheduleVaultRefresh();
});

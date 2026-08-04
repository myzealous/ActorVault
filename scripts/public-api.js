const AVAPI_MODULE_ID = "actor-vault";

function findActorVaultButton() {
  return document.querySelector("button.actor-vault-open");
}

globalThis.ActorVaultAPI = Object.freeze({
  async open() {
    const module = game.modules.get(AVAPI_MODULE_ID);
    if (!module?.active) throw new Error("Actor Vault is not enabled.");

    let button = findActorVaultButton();
    if (!button) {
      try {
        await ui.sidebar?.tabs?.actors?.render?.({ force: true });
      } catch (_) {
        // The Actors directory may already be rendered or managed by Foundry.
      }
      button = findActorVaultButton();
    }

    if (!button) throw new Error("Actor Vault open button was not found.");
    button.click();
  }
});

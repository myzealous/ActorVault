const MODULE_ID = "actor-vault";

Hooks.once("ready", () => {
  // Foundry world collections are iterable but do not expose Array.flatMap.
  // Actor Vault v0.2.0 called game.scenes.flatMap while checking linked tokens.
  if (game.scenes && typeof game.scenes.flatMap !== "function") {
    Object.defineProperty(game.scenes, "flatMap", {
      configurable: true,
      value(callback, thisArg) {
        return Array.from(this).flatMap(callback, thisArg);
      }
    });
  }

  console.debug(`${MODULE_ID} | Foundry v14 collection compatibility loaded`);
});

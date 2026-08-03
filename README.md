# Actor Vault

Actor Vault is a Foundry Virtual Tabletop v14 module for campaigns where players rotate among multiple characters and the GM keeps persistent custom NPCs.

## Core behavior

A managed actor exists in exactly one place:

- **Active** in the world Actors directory; or
- **Stored** in the Actor Vault compendium.

Archiving creates and verifies the compendium actor before deleting the world actor. Activating creates and verifies the world actor before deleting the compendium actor. The module refuses duplicates identified by a permanent vault ID.

## Ownership

- Every managed actor records a primary player in `flags.actor-vault.record.mainUserId`.
- Active actors grant that user Owner permission.
- All other players receive Limited permission through the actor's default ownership.
- A GM may activate or archive anyone's actor without becoming its primary owner.
- Player requests are validated and performed by the active primary GM client.
- Players see only their own actors in the Actor Vault window.

Foundry compendiums use pack-level permissions rather than per-entry ownership. The module therefore enforces per-actor access in its UI and socket handler. Direct manipulation of the underlying compendium bypasses those safeguards.

## Safety restrictions

An actor cannot be archived while it:

- has a linked token on any scene;
- appears in any combat encounter;
- has an existing stored copy with the same vault ID; or
- has no primary player owner.

## Installation on The Forge

Use `actor-vault-forge-v0.1.1.zip`. Its `module.json` is at the archive root for Forge's Import Wizard.

1. Stop or idle the Forge game.
2. Open **Summon Import Wizard**.
3. Upload the ZIP.
4. Disable Bazaar substitution for custom packages.
5. Finish the import and restart the server.
6. Enable **Actor Vault** under **Manage Modules**.
7. Log in as GM once so the world Actor compendium can be created.

## Test procedure

Use a dummy player and disposable actors first.

1. Archive a player-owned actor.
2. Confirm it is removed from the world and present in the vault.
3. Activate it.
4. Confirm it is removed from the vault and restored to the world.
5. Confirm the original player remains Owner and other players have Limited visibility.
6. Repeat with the GM performing both operations.
7. Confirm linked-token and combat protections block archiving.

## Target

- Foundry VTT 14.365
- dnd5e 5.3.3

This release has been statically validated but has not been executed inside a live Foundry server by the authoring environment. Keep backups and test with disposable data before using it on live actors.

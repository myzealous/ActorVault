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


## Installation on The Forge

https://github.com/myzealous/ActorVault/releases/latest/download/module.json

## Target

- Foundry VTT 14.365
- dnd5e 5.3.3

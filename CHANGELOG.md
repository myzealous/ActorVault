# Changelog

## 1.0.8

- Added a persistent world-level resource ledger keyed by Forge player identity when available, preserving resource history if a Foundry user is removed or recreated.
- Added archived ledger management so former users remain recoverable until a GM explicitly deletes their ledger record.
- Added the Meta Shop with spell scrolls, crafting, potions, Forge, Arcanum, Sanctum, Bulwark, Theater, Guildhall loans, housing upgrades, and The Mirror.
- Added level-based Rewards and The Study +10% XP toggle.
- Added The Iron Contract and Training Grounds loans with one active contract of each type per player.
- Fixed The Iron Contract so gold and Server Credits are granted and repaid as separate resources.
- Added release-time manifest/file validation and JavaScript syntax checks.

## 0.1.1

- Repackaged with `module.json` at the root of the Forge import ZIP.
- Added GitHub-ready project files, license, validation script, and release workflow.
- Removed blank manifest and download fields from the local-upload manifest.

## 0.1.0

- Initial actor archive and activation workflow.
- Player self-service and GM management view.
- Primary-owner preservation, duplicate prevention, and linked-token/combat safety checks.

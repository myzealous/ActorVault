# Changelog

## 1.1.1

- Removed Resource Ledger export/import controls from the Actor Vault UI.
- Fixed duplicate Archived Ledgers buttons so only one GM archive control is shown.
- Added a Long Rest Cost column to Resource History. Long-rest entries show the cost change, while unrelated transactions show a dash.

## 1.1.0

- Made the world-level Resource Ledger the authoritative resource/history store, with Foundry User flags retained as compatibility mirrors.
- Added ledger schema v2 and automatic pre-migration snapshots.
- Added a shared transaction engine with structured transaction type, resource delta, changed values, metadata, and before/after balances.
- Routed dashboard saves, Meta Shop purchases, rewards, housing, loans, The Study, and long-rest credit changes through the shared transaction engine.
- Resource History now shows transaction type and delta, includes GM users, and supports viewing automatically archived ledgers.
- Added Meta Shop confirmations that show cost and balances before and after a purchase.
- Expanded Meta Shop descriptions for Forge, Arcanum, Sanctum, and Theater services.
- Consolidated layout and resource-history compatibility behavior into the Resource Ledger UI; duplicate final-layout and long-rest-history scripts are no longer loaded.

## 1.0.9

- Made the Meta Shop vertically scrollable so all shop categories remain reachable.
- Renamed the Rewards action to Claim Session Rewards.
- Added a GM Archive Ledger / Restore Ledger control for the currently selected user while preserving archived balances and history.
- Resource History now includes GM accounts as well as players and archived ledgers.

## 1.0.8

- Added a persistent world-level resource ledger keyed by Forge player identity when available, preserving resource history if a Foundry user is removed or recreated.
- Added archived ledger management so former users remain recoverable until a GM explicitly removes their ledger record.
- Added the Meta Shop with spell scrolls, crafting, potions, Forge, Arcanum, Sanctum, Bulwark, Theater, Guildhall loans, housing upgrades, and The Mirror.
- Added level-based Rewards and The Study +10% XP toggle.
- Added The Iron Contract and Training Grounds loans with one active contract of each type per player.
- Fixed The Iron Contract so gold and Server Credits are granted and repaid as separate resources.
- Added release-time manifest/file validation and JavaScript syntax checks.

## 0.1.1

- Repackaged with module.json at the root of the Forge import ZIP.
- Added GitHub-ready project files, license, validation script, and release workflow.
- Removed blank manifest and download fields from the local-upload manifest.

## 0.1.0

- Initial actor archive and activation workflow.
- Player self-service and GM management view.
- Primary-owner preservation, duplicate prevention, and linked-token/combat safety checks.

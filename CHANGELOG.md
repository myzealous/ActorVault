# Changelog

## 1.2.16

- Fixed the player-access compatibility layer so it no longer grants OWNER as the default permission to every Actor in the Players folder tree.
- Managed Actors are now normalized to Default Ownership: Limited while preserving all explicit per-user ownership entries, including the Actor's actual Owner assignment.
- The same normalization is applied when a GM loads the world and when new managed Actors are created, preventing Actor Vault from undoing Limited defaults after imports or manual permission fixes.
- Player-facing dashboard, Meta Shop, rewards, long-rest, and no-GM workflows remain handled by their existing owner metadata/socket/offline access paths rather than broad default Actor ownership.

## 1.2.15

- Fixed Actor Vault imports so restored world Actors always use Default Ownership: Limited.
- The Actor Vault metadata owner is explicitly restored as Owner and any stale explicit ownership entries from the compendium copy are removed.
- Added a post-create ownership verification/update so Foundry cannot leave an imported Actor with broader permissions than intended.

## 1.2.6

- Fixed a recursive offline ledger fallback that caused `Maximum call stack size exceeded` for players when no GM was online.
- Offline resource reads now bootstrap directly from the persistent ledger entry or legacy user flags instead of calling wrapped getters recursively.
- Restores player dashboard and Meta Shop rendering in no-GM mode.

## 1.2.5

- Added no-GM player mode for dashboard resources, Meta Shop purchases, rewards, housing, loans, The Study, and long-rest controls.
- Player-owned resource changes fall back to per-user flags when no GM is online, then reconcile back into the persistent world Resource Ledger the next time a GM logs in.
- Preserved the existing GM socket proxy whenever a GM is online.
- Character import continues to work directly for players through the checkout flow; Foundry still requires the user's role to have permission to create Actors.
- Compendium export remains GM-only.
- Fixed the local release builder so it includes the full scripts directory instead of only actor-vault.js.

## 1.2.4

- Fixed player-initiated Actor Vault writes by routing all shared-data requests through Foundry's valid module socket channel, `module.actor-vault`.
- Added a shared socket bridge that dispatches Meta Shop and dashboard/resource/rest requests to the active GM client and returns the result to the requesting player.
- This fixes player Meta Shop purchases, session rewards, The Study, dashboard resource saves, Long Rest, Did Not Long Rest, and Quick Recovery actions that previously appeared clickable but did not persist.

## 1.2.3

- Added a permissive player-access layer so non-GM users can use Actor Vault self-service controls without direct permission to world settings.
- Dashboard resource saves from players are now proxied through the active GM and written through the persistent Resource Ledger.
- Long-rest, Did Not Long Rest, and Quick Recovery actions from players are now proxied through the active GM so credit/history writes succeed.
- Managed Actors in the Players folder tree are granted OWNER-level default ownership, allowing player-side actor interactions such as normal sheet rests and updates.
- Meta Shop authorization no longer blocks non-GM users from using the shop/rewards workflow for the dashboard target user.
- Player-facing Meta Shop, Rewards, Study, Resource History, and dashboard resource controls are explicitly re-enabled after the Actor Vault UI finishes rendering.

## 1.2.2

- Fixed the GM Update Skill Points workflow to use the same zero-point-safe spent-point calculation as the Actor Vault dashboard.
- Fixed duplicate processing in the GM Update Skill Points workflow by scanning eligible managed Actors directly and deduplicating by Actor ID instead of reading rendered DOM rows.
- The GM bulk updater now only checks Actors in the Players folder tree that have class levels and Skill Tree data, so the summary count reflects eligible characters instead of duplicate UI rows.

## 1.2.1

- Fixed Skill Tree synchronization so zero-point entries left behind after a respec are not counted as spent points.
- Actor Vault now sums the current `points` values on resolved Skill Tree entries instead of treating every resolved entry as at least one spent point.

## 1.2.0

- Improved the GM Update Skill Points workflow so actors requiring review are named directly in the summary.
- Added a review dialog showing each affected actor, the reason review is required, entitlement, spent points, current unspent points, and expected unspent points.
- Added matching console diagnostics for skill-point review cases.

## 1.1.1

- Removed Resource Ledger export/import controls from the Actor Vault UI.
- Fixed duplicate Archived Ledgers buttons so only one GM archive control is shown.
- Added a Long Rest Cost column to Resource History. Long-rest entries show the cost change, while unrelated transactions show a dash.

## 1.1.0

- Made the world-level Resource Ledger the authoritative resource/history store, with Foundry User flags retained as compatibility mirrors only.
- Added ledger schema v2 and automatic pre-migration snapshots.
- Added a shared transaction engine with structured transaction type, resource delta, changed values, metadata, and before/after balances.
- Routed dashboard saves, Meta Shop purchases, rewards, housing, loans, The Study, and long-rest credit changes through the shared transaction engine.
- Resource History now shows transaction type and delta, includes GM users, and supports viewing automatically archived ledgers.
- Meta Shop confirmations show cost and balances before and after a purchase.
- Expanded Meta Shop descriptions for Forge, Arcanum, Sanctum, Bulwark, Theater services.
- Consolidated layout and resource-history compatibility behavior into the Resource Ledger UI; duplicate final-layout and long-rest-history scripts are no longer loaded.

## 1.0.9

- Made the Meta Shop vertically scrollable so all shop categories remain reachable.
- Renamed the Rewards action to Claim Session Rewards.
- Added a GM Archive Ledger / Restore Ledger control for the currently selected user while preserving archived balances and history.
- Resource History now includes GM accounts as well as players and archived ledgers.

## 1.0.8

- Added a persistent world-level resource ledger keyed by Forge player identity when available, preserving resource history if a Foundry user is removed or recreated.
- Added archived ledger management so former users remain recoverable until a GM explicitly removes the ledger record.
- Added the Meta Shop with spell scrolls, crafting, potions, Forge, Arcanum, Sanctum, Bulwark, Theater, Guildhall loans, housing upgrades, and The Mirror.
- Added level-based Rewards and The Study +10% XP toggle.
- Added The Iron Contract and Training Grounds loans with one active contract of each type per player.

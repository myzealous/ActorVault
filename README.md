# Actor Vault

Actor Vault is a Foundry Virtual Tabletop v14 module built for a persistent D&D 5e server where players may own several characters but only use some of them at a time.

Characters are kept in a permanent Actor Vault compendium and imported into the world when needed. This keeps the world Actor directory smaller while preserving ownership, progression, and player resources.

## Installation

Install with this manifest URL:

https://github.com/myzealous/ActorVault/releases/latest/download/module.json

Target versions:

- Foundry VTT 14.365
- D&D 5e 5.3.3

## Character vault workflow

### Players

- Players see only the active and stored characters assigned to their user account.
- A player can import a stored character into the world.
- Importing is blocked when the same vault character is already active.
- The permanent compendium copy remains available while the active world copy is checked out.
- Players cannot export characters back to the vault.

### Gamemasters

- GMs can import any stored character.
- **Import All Stored** imports every stored character that is not already active.
- Each active character has an individual **Export** button.
- **Export All Active** exports all managed actors in the Players folder structure.
- Export replaces the matching compendium entry by permanent vault ID instead of creating duplicates.
- Export removes linked scene tokens and combatants before deleting the active world actor.

Stored characters remain grouped by owner for easier browsing.

## Ownership

- Every managed character records its primary owner in `flags.actor-vault.record.mainUserId`.
- Any Foundry user account may be selected as the owner, regardless of role or GM status.
- The selected owner receives Owner permission on the active actor.
- Other users receive Limited visibility through default ownership.
- Ownership is preserved when importing and exporting.

## Player dashboard

Each user has a persistent dashboard containing:

- Gold
- Server Credits
- Experience
- Housing tier
- Protected magic-item storage

Housing applies to all characters owned by that user.

| Housing | Skill-point bonus | Protected slots |
| --- | ---: | ---: |
| None | 0 | 0 |
| Homestead | 1 | 0 |
| House | 2 | 1 |
| Manor | 3 | 2 |
| Estate | 4 | 3 |

Players can edit their own dashboard. GMs can select and edit any user's dashboard.

## Skill points

Skill-point entitlement is calculated per active classed character:

`minimum(total class levels, 12) + housing tier + Worldbreaker tier`

Maximum entitlement is 19.

The module integrates with the Skill Tree module using:

- `flags.skill-tree.skills`
- `flags.skill-tree.skillPoints`

Only purchased-skill UUIDs that still resolve to an existing Journal Page are counted. Stale purchases from deleted skill trees are ignored.

Skill-point status buttons use three states:

- Grey: already current
- Green: update available
- Red: manual review required

Players can update their own active characters. GMs have a bulk **Update Skill Points** action.

Actors without class levels, such as summons and many NPCs, are excluded from skill-point calculations.

## Worldbreaker progression

Each active classed character has its own Worldbreaker tier:

- None
- Tier 1
- Tier 2
- Tier 3

Worldbreaker points apply only to that character and are included in its skill-point entitlement.

Players can manage Worldbreaker for their own active characters. GMs can manage it for every active character.

## Per-character long rests

Long-rest cost is stored on each active character rather than on the user account.

Each classed active character has:

- Current Long Rest Cost, from 0 to 4
- Long Rest button
- Did Not Long Rest button
- Quick Recovery checkbox

### Long Rest

- Deducts that character's current cost from the owner's Server Credits.
- Increases the character's next cost by 1, to a maximum of 4.
- Is blocked when the owner does not have enough Server Credits.

### Did Not Long Rest

- Costs no Server Credits.
- Reduces that character's cost by 1, to a minimum of 0.

### Quick Recovery

- Checking Quick Recovery immediately lowers that character's displayed Long Rest Cost by 1.
- Unchecking it raises the cost by 1.
- Cost remains limited to the 0–4 range.
- There is no separate discounted-cost display.

Long-rest data is stored in `flags.actor-vault.longRest` and travels with the actor when exported to the vault.

## Resource history

Players can view their own history. GMs can view any user's history.

History records dashboard and long-rest changes, including:

- Timestamp
- Editor
- Action
- Character name when applicable
- Server Credits
- Long Rest Cost
- Quick Recovery state
- Housing
- Gold
- Experience
- Protected storage

The most recent 30 entries are retained per user.

## Interface refresh

After successful saves and vault actions, Actor Vault performs a clean refresh so the interface reflects current world and compendium data.

This applies to imports, exports, owner changes, housing, Worldbreaker, skill points, dashboard saves, and long-rest actions.

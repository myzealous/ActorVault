const HISTORY_SCOPE = "world";
const HISTORY_KEY = "metaResourcesHistory";

function esc(value) {
  return foundry.utils.escapeHTML(String(value ?? ""));
}

function normalizeState(state) {
  const source = state && typeof state === "object" ? state : {};
  const storage = Array.isArray(source.storage) ? source.storage : [];
  return {
    gold: Number(source.gold ?? 0),
    credits: Number(source.credits ?? 0),
    xp: Number(source.xp ?? 0),
    housingTier: Number(source.housingTier ?? source.housing ?? 0),
    storage: [...storage, "", "", "", ""].slice(0, 4).map(value => String(value ?? ""))
  };
}

function housingLabel(tier) {
  return ["None", "Homestead", "House", "Manor", "Estate"][Number(tier)] ?? `Tier ${tier}`;
}

function renderHistoryRows(user) {
  const history = user?.getFlag(HISTORY_SCOPE, HISTORY_KEY) || [];
  if (!history.length) {
    return '<p class="actor-vault-history__empty">No resource history has been logged for this user.</p>';
  }

  const rows = history.map((entry, index) => {
    const state = normalizeState(entry?.state);
    const storage = state.storage.map(item => item.trim() || "—").join("<br>");
    const timestamp = Number(entry?.timestamp);
    const date = Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : "Unknown date";

    return `
      <tr>
        <td>${index + 1}</td>
        <td>${esc(date)}</td>
        <td>${state.gold}</td>
        <td>${state.credits}</td>
        <td>${state.xp}</td>
        <td>${esc(housingLabel(state.housingTier))}</td>
        <td>${storage}</td>
      </tr>`;
  }).join("");

  return `
    <table class="actor-vault-history__table">
      <thead>
        <tr>
          <th>#</th>
          <th>Date &amp; Time</th>
          <th>Gold</th>
          <th>Credits</th>
          <th>XP</th>
          <th>Housing</th>
          <th>Protected Storage</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

async function openResourceHistory() {
  if (!game.user.isGM) {
    ui.notifications.warn("Only a GM can view resource history.");
    return;
  }

  const users = [...game.users]
    .filter(user => user?.id && !user.isGM)
    .sort((a, b) => a.name.localeCompare(b.name));

  if (!users.length) {
    ui.notifications.warn("No player users were found.");
    return;
  }

  const options = users.map(user => `<option value="${esc(user.id)}">${esc(user.name)}</option>`).join("");

  const dialog = new foundry.applications.api.DialogV2({
    window: {
      title: "Resource Change History",
      resizable: true
    },
    position: {
      width: 900,
      height: 700
    },
    content: `
      <section class="actor-vault-history">
        <label class="actor-vault-history__selector">
          <span>Player</span>
          <select data-history-user>${options}</select>
        </label>
        <div class="actor-vault-history__log" data-history-log></div>
      </section>`,
    buttons: [
      {
        action: "close",
        label: "Close",
        default: true
      }
    ]
  });

  dialog.addEventListener("render", () => {
    const root = dialog.element;
    const select = root?.querySelector("[data-history-user]");
    const log = root?.querySelector("[data-history-log]");
    if (!select || !log) return;

    const refresh = () => {
      const user = game.users.get(select.value);
      log.innerHTML = renderHistoryRows(user);
    };

    select.addEventListener("change", refresh);
    refresh();
  }, { once: true });

  dialog.render({ force: true });
}

Hooks.on("renderActorVaultApp", (app, html) => {
  if (!game.user.isGM) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root || root.querySelector(".actor-vault-history-open")) return;

  const toolbar = root.querySelector(".actor-vault__toolbar");
  if (!toolbar) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "actor-vault-history-open";
  button.innerHTML = '<i class="fas fa-clock-rotate-left"></i> Resource History';
  button.addEventListener("click", openResourceHistory);
  toolbar.append(button);
});

// Fallback for ApplicationV2 render hooks whose class-specific hook is not emitted.
Hooks.on("renderApplicationV2", (app, html) => {
  if (!game.user.isGM || app?.id !== "actor-vault-app") return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root || root.querySelector(".actor-vault-history-open")) return;

  const toolbar = root.querySelector(".actor-vault__toolbar");
  if (!toolbar) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "actor-vault-history-open";
  button.innerHTML = '<i class="fas fa-clock-rotate-left"></i> Resource History';
  button.addEventListener("click", openResourceHistory);
  toolbar.append(button);
});

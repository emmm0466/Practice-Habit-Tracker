const STORAGE_KEY = "petal-practice-v1";
const FLOWERS = [
  { name: "Sunflower", cost: 0 },
  { name: "Tulip", cost: 30, petalColor: "#e88087" },
  { name: "Daisy", cost: 50, petalColor: "#fffaf0" },
  { name: "Lavender", cost: 75, petalColor: "#9c83c5" },
];
const GROWTH_STAGES = ["Seed", "Sprout", "Growing stalk", "Bud", "Developing flower", "Full bloom"];
const dialog = document.querySelector("#practice-dialog");
const goalDialog = document.querySelector("#goal-dialog");
const form = document.querySelector("#practice-form");
const goalForm = document.querySelector("#goal-form");
const toast = document.querySelector("#toast");
const todayKey = dateKey(new Date());
let storageReadFailed = false;
let storageWriteFailed = false;
let isSubmitting = false;

function dateKey(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}
function isDateKey(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  return !Number.isNaN(date.getTime()) && dateKey(date) === value;
}
function dateLabel(value, options = { month: "short", day: "numeric" }) {
  return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, options);
}
function calendarDaysBetween(start, end) {
  const [startYear, startMonth, startDay] = start.split("-").map(Number);
  const [endYear, endMonth, endDay] = end.split("-").map(Number);
  return (Date.UTC(endYear, endMonth - 1, endDay) - Date.UTC(startYear, startMonth - 1, startDay)) / 86400000;
}
function newId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function createPlant(flower, minutes, targetMinutes) {
  return {
    id: newId(),
    flower,
    growthMinutes: minutes,
    growthGoalMinutes: Math.max(60, targetMinutes * 5),
    growthFloor: 0,
  };
}
function normalizeSession(session) {
  if (!session || !isDateKey(session.date)) return null;
  if (!Number.isInteger(session.minutes) || session.minutes < 1 || session.minutes > 300) return null;
  return {
    id: typeof session.id === "string" ? session.id : newId(),
    date: session.date,
    minutes: session.minutes,
    focus: typeof session.focus === "string" ? session.focus : "Practice",
    note: typeof session.note === "string" ? session.note : "",
    createdAt: typeof session.createdAt === "string" ? session.createdAt : "1970-01-01T00:00:00.000Z",
    tokensEarned: Number.isInteger(session.tokensEarned) ? Math.max(0, session.tokensEarned) : 0,
  };
}
function growthFor(plant) {
  const progress = Math.min(1, Math.max(
    Number.isFinite(plant.growthFloor) ? plant.growthFloor : 0,
    plant.growthMinutes / plant.growthGoalMinutes
  ));
  return {
    progress,
    percent: Math.round(progress * 100),
    stage: Math.min(GROWTH_STAGES.length - 1, Math.floor(progress * (GROWTH_STAGES.length - 1))),
  };
}
function loadState() {
  let saved;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createInitialState();
    saved = JSON.parse(raw);
  } catch (error) {
    storageReadFailed = true;
    console.error("Could not read saved practice data. Existing browser data will not be overwritten.", error);
    return createInitialState();
  }
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) {
    storageReadFailed = true;
    console.error("Saved practice data has an unexpected format. Existing browser data will not be overwritten.");
    return createInitialState();
  }

  const weeklyTargetMinutes = Number.isInteger(saved.weeklyTargetMinutes)
    ? Math.min(600, Math.max(10, saved.weeklyTargetMinutes))
    : 60;
  const expectedPracticeDays = Number.isInteger(saved.expectedPracticeDays)
    ? Math.min(7, Math.max(1, saved.expectedPracticeDays))
    : 3;
  if (saved.sessions !== undefined && !Array.isArray(saved.sessions)) {
    storageReadFailed = true;
    console.error("Saved practice sessions have an unexpected format. Existing browser data will not be overwritten.");
    return createInitialState();
  }
  const sessions = Array.isArray(saved.sessions)
    ? saved.sessions.map(normalizeSession).filter((session) => session && session.date <= todayKey)
    : [];
  const oldUnlocked = Array.isArray(saved.unlocked) ? saved.unlocked : [];
  const unlocked = [...new Set([
    "Sunflower",
    ...oldUnlocked
      .map((flower) => flower === "Sunny" ? "Sunflower" : flower)
      .filter((flower) => typeof flower === "string" && FLOWERS.some((item) => item.name === flower)),
  ])];
  const oldTokenBalance = Number.isFinite(saved.seedTokens)
    ? saved.seedTokens
    : Number.isFinite(saved.tokens) ? saved.tokens : 0;
  const seedTokens = Math.max(0, Math.floor(oldTokenBalance));

  let garden;
  if (Array.isArray(saved.garden)) {
    const seenFlowers = new Set();
    garden = saved.garden
      .filter((plant) => {
        if (!plant || !FLOWERS.some((flower) => flower.name === plant.flower) || seenFlowers.has(plant.flower)) return false;
        seenFlowers.add(plant.flower);
        return true;
      })
      .map((plant) => ({
        id: typeof plant.id === "string" && /^[a-zA-Z0-9_-]+$/.test(plant.id) ? plant.id : newId(),
        flower: plant.flower,
        growthMinutes: Number.isFinite(plant.growthMinutes) ? Math.max(0, plant.growthMinutes) : 0,
        growthGoalMinutes: Number.isFinite(plant.growthGoalMinutes)
          ? Math.max(60, plant.growthGoalMinutes)
          : Math.max(60, weeklyTargetMinutes * 5),
        growthFloor: Number.isFinite(plant.growthFloor)
          ? Math.min(1, Math.max(0, plant.growthFloor))
          : 0,
      }));
  } else {
    const previousPracticeMinutes = sessions.reduce((total, session) => total + session.minutes, 0);
    garden = unlocked.map((flower) =>
      createPlant(flower, flower === "Sunflower" ? previousPracticeMinutes : 0, weeklyTargetMinutes)
    );
  }
  for (const flower of unlocked) {
    if (!garden.some((plant) => plant.flower === flower)) garden.push(createPlant(flower, 0, weeklyTargetMinutes));
  }

  return {
    version: 2,
    sessions,
    seedTokens,
    unlocked: [...new Set([...unlocked, ...garden.map((plant) => plant.flower)])],
    weeklyTargetMinutes,
    expectedPracticeDays,
    garden,
    weeklyRewards: saved.weeklyRewards && typeof saved.weeklyRewards === "object" && !Array.isArray(saved.weeklyRewards)
      ? saved.weeklyRewards
      : {},
  };
}
function createInitialState() {
  return {
    version: 2,
    sessions: [],
    seedTokens: 0,
    unlocked: ["Sunflower"],
    weeklyTargetMinutes: 60,
    expectedPracticeDays: 3,
    garden: [createPlant("Sunflower", 0, 60)],
    weeklyRewards: {},
  };
}
let state = loadState();
let storageWarningShown = false;
function warnStorageUnavailable() {
  if (storageWarningShown) return;
  storageWarningShown = true;
  showToast("Browser storage is unavailable, so changes cannot be saved. Existing saved data has not been overwritten.");
}
function saveState() {
  if (storageReadFailed || storageWriteFailed) {
    warnStorageUnavailable();
    return false;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (error) {
    console.error("Could not save practice data.", error);
    storageWriteFailed = true;
    warnStorageUnavailable();
    return false;
  }
}
function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => toast.classList.remove("show"), 3200);
}
function sessionsInWeek(weekStart, sessions = state.sessions) {
  const weekEndDate = new Date(`${weekStart}T12:00:00`);
  weekEndDate.setDate(weekEndDate.getDate() + 6);
  const weekEnd = dateKey(weekEndDate);
  return sessions.filter((session) => session.date >= weekStart && session.date <= weekEnd);
}
function startOfWeek(dateString) {
  const date = new Date(`${dateString}T12:00:00`);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return dateKey(date);
}
function sessionsForCurrentWeek() {
  return sessionsInWeek(startOfWeek(todayKey)).filter((session) => session.date <= todayKey);
}
function renderWeek() {
  const monday = new Date(`${startOfWeek(todayKey)}T12:00:00`);
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  document.querySelector("#week-days").innerHTML = days.map((label, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    const key = dateKey(date);
    const completed = state.sessions.some((session) => session.date === key);
    const isToday = key === todayKey;
    return `<div class="day-cell${completed ? " completed" : ""}${isToday ? " today" : ""}"><span>${label}</span><div class="day-circle">${date.getDate()}</div></div>`;
  }).join("");

  const weekSessions = sessionsForCurrentWeek();
  const total = weekSessions.reduce((sum, session) => sum + session.minutes, 0);
  const percent = Math.min(100, Math.round((total / state.weeklyTargetMinutes) * 100));
  document.querySelector("#goal-minutes").textContent = total;
  document.querySelector("#weekly-target").textContent = state.weeklyTargetMinutes;
  document.querySelector("#expected-days").textContent = state.expectedPracticeDays;
  document.querySelector("#week-minutes").textContent = `${total} min`;
  document.querySelector("#leaderboard-minutes").textContent = total;
  const progressBar = document.querySelector(".goal-progress");
  progressBar.setAttribute("aria-valuemax", state.weeklyTargetMinutes);
  progressBar.setAttribute("aria-valuenow", Math.min(total, state.weeklyTargetMinutes));
  progressBar.setAttribute("aria-valuetext", `${total} of ${state.weeklyTargetMinutes} minutes this week`);
  document.querySelector("#goal-progress-fill").style.width = `${percent}%`;
  document.querySelector("#goal-percent").textContent = `${percent}%`;
  renderFriends(total);
}
function renderFriends(studentMinutes) {
  const friends = [
    { name: "Lily Chen", instrument: "Flute", minutes: 85, initial: "L", avatar: "avatar-peach", flower: "🌼" },
    { name: "Alex Rivera", instrument: "Piano", minutes: 70, initial: "A", avatar: "avatar-blue", flower: "🌷" },
    { name: "Sam Taylor", instrument: "Violin", minutes: studentMinutes, initial: "S", avatar: "avatar-green", flower: "🌱", isYou: true },
    { name: "Noah Park", instrument: "Cello", minutes: 35, initial: "N", avatar: "avatar-lilac", flower: "🌿" },
  ].sort((a, b) => b.minutes - a.minutes);
  document.querySelector("#friend-list").innerHTML = friends.map((friend, index) => {
    const minutes = friend.isYou ? `<span id="leaderboard-minutes">${friend.minutes}</span>` : friend.minutes;
    return `<div class="friend-row${friend.isYou ? " is-you" : ""}"><span class="friend-rank">${index + 1}</span><div class="friend-avatar ${friend.avatar}">${friend.initial}</div><div class="friend-info"><strong>${friend.name}${friend.isYou ? ' <span class="you-label">YOU</span>' : ""}</strong><small>${friend.instrument} · ${minutes} min</small></div><div class="friend-flower">${friend.flower}</div></div>`;
  }).join("");
}
function getStreak() {
  const practiced = new Set(state.sessions.map((session) => session.date));
  let cursor = new Date(`${todayKey}T12:00:00`);
  if (!practiced.has(todayKey)) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (practiced.has(dateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
function getPlantHealth() {
  if (!state.sessions.length) return { score: 100, status: "healthy", label: "Healthy" };
  const firstPractice = [...state.sessions].sort((a, b) => a.date.localeCompare(b.date))[0].date;
  const daysSinceFirstPractice = calendarDaysBetween(firstPractice, todayKey);
  if (daysSinceFirstPractice < 6) return { score: 100, status: "healthy", label: "Healthy" };

  const windowStartDate = new Date(`${todayKey}T12:00:00`);
  windowStartDate.setDate(windowStartDate.getDate() - 6);
  const windowStart = dateKey(windowStartDate);
  const daysPracticed = new Set(
    state.sessions
      .filter((session) => session.date >= windowStart && session.date <= todayKey)
      .map((session) => session.date)
  ).size;
  const missedExpectations = Math.max(0, state.expectedPracticeDays - daysPracticed);
  const score = Math.max(40, Math.round(100 - (missedExpectations / state.expectedPracticeDays) * 60));
  if (score >= 80) return { score, status: "healthy", label: "Healthy" };
  if (score >= 60) return { score, status: "wilting", label: "Needs a little care" };
  return { score, status: "tired", label: "Ready to recover" };
}
function activePlant() {
  return state.garden.find((plant) => growthFor(plant).stage < GROWTH_STAGES.length - 1) || null;
}
function plantPetals(flower) {
  const count = flower.name === "Tulip" ? 5 : flower.name === "Lavender" ? 9 : 12;
  if (flower.name === "Tulip") {
    return '<path class="plant-petal" d="M80 68C62 63 63 40 68 29C74 29 78 37 80 43C83 34 90 28 96 30C108 47 101 63 80 68Z"/>';
  }
  if (flower.name === "Lavender") {
    return Array.from({ length: count }, (_, index) => {
      const row = Math.floor(index / 3);
      const offset = index % 3;
      const x = 80 + (offset - 1) * (8 + row * 2);
      const y = 31 + row * 8 + (offset === 1 ? -2 : 1);
      return `<circle class="plant-petal" cx="${x}" cy="${y}" r="5"/>`;
    }).join("");
  }
  return Array.from({ length: count }, (_, index) => {
    const angle = (360 / count) * index;
    const rx = flower.name === "Sunflower" ? 7 : 6;
    const ry = flower.name === "Sunflower" ? 17 : 15;
    return `<ellipse class="plant-petal" cx="80" cy="48" rx="${rx}" ry="${ry}" transform="rotate(${angle} 80 55)"/>`;
  }).join("");
}
function plantSvg(plant, health, id) {
  const flower = FLOWERS.find((item) => item.name === plant.flower) || FLOWERS[0];
  const growth = growthFor(plant);
  const stageClass = ["seed", "sprout", "stalk", "bud", "developing", "bloom"][growth.stage];
  const face = flower.name === "Sunflower" || flower.name === "Daisy"
    ? '<g class="plant-face" fill="#573e32"><circle cx="75" cy="53" r="1.7"/><circle cx="85" cy="53" r="1.7"/><path d="M76 59Q80 63 84 59" fill="none" stroke="#573e32" stroke-width="1.5" stroke-linecap="round"/></g>'
    : "";
  return `<svg class="plant-svg species-${flower.name.toLowerCase()}" viewBox="0 0 160 205" role="img" aria-labelledby="${id}-title">
    <title id="${id}-title">${flower.name}, ${GROWTH_STAGES[growth.stage].toLowerCase()}, ${health.label.toLowerCase()}</title>
    <g class="plant-stalk">
      <path class="plant-stem" d="M80 158C76 135 84 111 80 70"/>
      <g class="plant-leaf left"><path fill="#79a96e" d="M80 132C57 132 43 118 42 100C61 100 76 111 80 132Z"/></g>
      <g class="plant-leaf right"><path fill="#91ba78" d="M80 113C99 111 111 98 113 82C96 84 84 96 80 113Z"/></g>
      <g class="plant-leaf left"><path fill="#85b274" d="M80 94C62 92 53 81 53 68C68 70 77 79 80 94Z"/></g>
    </g>
    <g class="plant-bud"><path fill="${flower.petalColor || "#e5aa37"}" stroke="#cd8d41" stroke-width="2" d="M80 70C65 65 67 48 80 39C94 48 95 64 80 70Z"/></g>
    <g class="plant-petals">${plantPetals(flower)}</g>
    <circle class="plant-center" cx="80" cy="55" r="${flower.name === "Sunflower" ? 15 : 10}"/>
    ${face}
    <ellipse class="plant-soil" cx="80" cy="160" rx="38" ry="8"/>
    <ellipse class="plant-seed" cx="80" cy="155" rx="6" ry="4"/>
    <path class="plant-pot" d="M43 163Q80 173 117 163L108 196Q80 203 52 196Z"/>
    <path class="plant-pot-rim" d="M39 158Q80 169 121 158L117 168Q80 180 43 168Z"/>
    <path class="plant-pot-detail" d="M59 182Q80 188 101 182"/>
  </svg>`;
}
function renderFlower() {
  const health = getPlantHealth();
  const plant = activePlant() || state.garden[state.garden.length - 1];
  const target = document.querySelector("#hero-flower");
  if (!plant) {
    target.innerHTML = "";
    document.querySelector("#hero-plant-name").textContent = "Garden in bloom";
    document.querySelector("#flower-stage").textContent = "All flowers grown";
    document.querySelector("#streak-count").textContent = `${getStreak()} ${getStreak() === 1 ? "day" : "days"}`;
    document.querySelector("#token-count").textContent = `${state.seedTokens} seed tokens`;
    return;
  }
  const growth = growthFor(plant);
  const flower = FLOWERS.find((item) => item.name === plant.flower) || FLOWERS[0];
  target.className = `hero-plant-wrap growth-${["seed", "sprout", "stalk", "bud", "developing", "bloom"][growth.stage]} plant-health-${health.status}`;
  const existingSvg = target.querySelector(".plant-svg");
  if (!existingSvg || existingSvg.dataset.plantId !== plant.id) {
    target.innerHTML = plantSvg(plant, health, "hero-plant");
  }
  const svg = target.querySelector(".plant-svg");
  svg.dataset.plantId = plant.id;
  updatePlantSvg(svg, plant, health);
  document.querySelector("#hero-plant-name").textContent = `${flower.name}${growth.stage === 5 ? "" : " seed"}`;
  document.querySelector("#flower-stage").textContent = `${GROWTH_STAGES[growth.stage]} · ${growth.percent}% · ${health.label}`;
  document.querySelector("#streak-count").textContent = `${getStreak()} ${getStreak() === 1 ? "day" : "days"}`;
  document.querySelector("#token-count").textContent = `${state.seedTokens} seed tokens`;
}
function renderLog() {
  const list = document.querySelector("#log-list");
  const entries = [...state.sessions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 4);
  if (!entries.length) {
    list.innerHTML = '<div class="empty-log">Your first practice session is waiting to be planted. 🌱</div>';
    return;
  }
  list.innerHTML = entries.map((session) => {
    const day = session.date === todayKey ? "Today" : dateLabel(session.date, { weekday: "short", month: "short", day: "numeric" });
    const note = session.note ? ` · ${escapeHtml(session.note)}` : "";
    const reward = session.tokensEarned ? `<small>+${session.tokensEarned} seed ${session.tokensEarned === 1 ? "token" : "tokens"}</small>` : "<small>Growth added to your seed</small>";
    return `<article class="log-entry"><div class="log-icon">♫</div><div class="log-details"><strong>${escapeHtml(session.focus)}</strong><span>${day}${note}</span></div><div class="log-duration">${session.minutes} min${reward}</div></article>`;
  }).join("");
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}
function updatePlantSvg(svg, plant, health) {
  const flower = FLOWERS.find((item) => item.name === plant.flower) || FLOWERS[0];
  const growth = growthFor(plant);
  const stemProgress = Math.min(1, growth.progress * 1.35);
  svg.style.setProperty("--stem-offset", `${125 * (1 - stemProgress)}px`);
  svg.classList.toggle("plant-health-wilting", health.status === "wilting");
  svg.classList.toggle("plant-health-tired", health.status === "tired");
  const title = svg.querySelector("title");
  if (title) title.textContent = `${flower.name}, ${GROWTH_STAGES[growth.stage].toLowerCase()}, ${health.label.toLowerCase()}`;
}
function renderCollection() {
  const health = getPlantHealth();
  const garden = document.querySelector("#mini-garden");
  document.querySelector("#collection-count").textContent = `${state.garden.length} / ${FLOWERS.length}`;
  const active = activePlant();
  FLOWERS.forEach((flower, index) => {
    const plant = state.garden.find((item) => item.flower === flower.name);
    if (plant) {
      const growth = growthFor(plant);
      const stageName = GROWTH_STAGES[growth.stage];
      const activeClass = plant.id === active?.id ? " is-active" : "";
      let card = garden.querySelector(`.garden-plant[data-plant-id="${plant.id}"]`);
      if (!card) {
        card = document.createElement("article");
        card.className = "garden-plant";
        card.dataset.plantId = plant.id;
        card.innerHTML = `${plantSvg(plant, health, `garden-${plant.id}`)}
          <span class="garden-plant-name"></span>
          <span class="garden-plant-status"></span>
          <span class="garden-plant-progress" aria-hidden="true"><span></span></span>`;
        garden.querySelector(`.locked-seed[data-flower="${flower.name}"]`)?.replaceWith(card);
      }
      card.className = `garden-plant growth-${["seed", "sprout", "stalk", "bud", "developing", "bloom"][growth.stage]} plant-health-${health.status}${activeClass}`;
      card.setAttribute("aria-label", `${flower.name}, ${stageName}, ${health.label}${plant.id === active?.id ? ", currently growing" : ""}`);
      card.querySelector(".garden-plant-name").textContent = flower.name;
      card.querySelector(".garden-plant-status").innerHTML = `${plant.id === active?.id ? "Tending now · " : ""}${stageName} · ${growth.percent}%<br>${health.label}`;
      card.querySelector(".garden-plant-progress span").style.width = `${growth.percent}%`;
      updatePlantSvg(card.querySelector(".plant-svg"), plant, health);
      const currentAtIndex = garden.children[index];
      if (currentAtIndex !== card) garden.insertBefore(card, currentAtIndex || null);
      return;
    }
    let button = garden.querySelector(`.locked-seed[data-flower="${flower.name}"]`);
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.dataset.flower = flower.name;
      button.className = "garden-plant locked-seed growth-seed";
      button.innerHTML = `${plantSvg({ flower: flower.name, growthMinutes: 0, growthGoalMinutes: state.weeklyTargetMinutes * 5 }, health, `locked-${flower.name.toLowerCase()}`)}
        <span class="garden-plant-name"></span><span class="seed-cost"></span>`;
    }
    button.setAttribute("aria-label", `Unlock ${flower.name} seed for ${flower.cost} seed tokens`);
    button.querySelector(".garden-plant-name").textContent = `${flower.name} seed`;
    button.querySelector(".seed-cost").textContent = `${flower.cost} seed tokens`;
    updatePlantSvg(button.querySelector(".plant-svg"), { flower: flower.name, growthMinutes: 0, growthGoalMinutes: state.weeklyTargetMinutes * 5 }, health);
    const currentAtIndex = garden.children[index];
    if (currentAtIndex !== button) garden.insertBefore(button, currentAtIndex || null);
  });
}
function render() {
  renderWeek();
  renderFlower();
  renderLog();
  renderCollection();
}
function awardWeeklyMilestones(sessions, week, previousRewards) {
  const weekSessions = sessionsInWeek(week, sessions);
  const minutes = weekSessions.reduce((total, session) => total + session.minutes, 0);
  const practiceDays = new Set(weekSessions.map((session) => session.date)).size;
  const old = previousRewards[week] || {};
  const earned = [];
  const updatedWeek = { ...old };
  if (!old.consistency && practiceDays >= state.expectedPracticeDays) {
    updatedWeek.consistency = true;
    earned.push("consistency");
  }
  if (!old.goal && minutes >= state.weeklyTargetMinutes) {
    updatedWeek.goal = true;
    earned.push("weekly goal");
  }
  return { earned, updatedWeek };
}
function updateGoalDialog() {
  document.querySelector("#weekly-target-input").value = state.weeklyTargetMinutes;
  document.querySelector("#expected-days-input").value = state.expectedPracticeDays;
}

document.querySelector("#today-label").textContent = new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
document.querySelector(".eyebrow").innerHTML = `${new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }).toUpperCase()} <span class="eyebrow-dot">✳</span> A FRESH START`;
document.querySelector("#practice-date").value = todayKey;
document.querySelector("#practice-date").max = todayKey;
document.querySelector("#open-practice").addEventListener("click", () => dialog.showModal());
document.querySelector("#close-practice").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});
document.querySelector("#edit-goal").addEventListener("click", () => {
  updateGoalDialog();
  goalDialog.showModal();
});
document.querySelector("#close-goal").addEventListener("click", () => goalDialog.close());
goalDialog.addEventListener("click", (event) => {
  if (event.target === goalDialog) goalDialog.close();
});
goalForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!goalForm.reportValidity()) return;
  const data = new FormData(goalForm);
  const weeklyTargetMinutes = Number(data.get("weeklyTarget"));
  const expectedPracticeDays = Number(data.get("expectedDays"));
  if (!Number.isInteger(weeklyTargetMinutes) || weeklyTargetMinutes < 10 || weeklyTargetMinutes > 600
    || weeklyTargetMinutes % 5 !== 0 || !Number.isInteger(expectedPracticeDays)
    || expectedPracticeDays < 1 || expectedPracticeDays > 7) {
    showToast("Choose a weekly goal of 10–600 minutes (in steps of 5) and 1–7 practice days.");
    return;
  }
  const previousState = state;
  const garden = state.garden.map((plant) => ({
    ...plant,
    growthGoalMinutes: Math.max(60, weeklyTargetMinutes * 5),
    growthFloor: Math.max(plant.growthFloor || 0, growthFor(plant).progress),
  }));
  state = { ...state, weeklyTargetMinutes, expectedPracticeDays, garden };
  if (!saveState()) {
    state = previousState;
    showToast(storageReadFailed
      ? "Saved data could not be read, so this change was not saved to protect it."
      : "Your browser couldn't save this goal. Check available storage and try again.");
    return;
  }
  render();
  if (storageReadFailed) warnStorageUnavailable();
  goalDialog.close();
  showToast("Your practice goal is saved. Your garden's growth stays just as it was.");
});
form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (isSubmitting || !form.reportValidity()) return;
  const data = new FormData(form);
  const minutes = Number(data.get("minutes"));
  const date = String(data.get("date"));
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 300 || !isDateKey(date) || date > todayKey) {
    showToast("Choose a practice time from 1–300 minutes and a real date no later than today.");
    return;
  }

  isSubmitting = true;
  const submitButton = form.querySelector('[type="submit"]');
  submitButton.disabled = true;
  const previousState = state;
  const week = startOfWeek(date);
  const session = {
    id: newId(),
    date,
    minutes,
    focus: String(data.get("focus")),
    note: String(data.get("note")).trim(),
    createdAt: new Date().toISOString(),
    tokensEarned: 0,
  };
  const plant = state.garden.find((item) => growthFor(item).stage < GROWTH_STAGES.length - 1);
  const garden = plant
    ? state.garden.map((item) => item.id === plant.id ? { ...item, growthMinutes: item.growthMinutes + minutes } : item)
    : state.garden;
  const sessions = [...state.sessions, session];
  const milestones = awardWeeklyMilestones(sessions, week, state.weeklyRewards);
  session.tokensEarned = milestones.earned.length;
  state = {
    ...state,
    sessions,
    garden,
    seedTokens: state.seedTokens + milestones.earned.length,
    weeklyRewards: { ...state.weeklyRewards, [week]: milestones.updatedWeek },
  };
  if (!saveState()) {
    state = previousState;
    isSubmitting = false;
    submitButton.disabled = false;
    showToast(storageReadFailed
      ? "Saved data could not be read, so this session was not saved to protect it."
      : "Your browser couldn't save this practice session. Check available storage and try again.");
    return;
  }
  render();
  dialog.close();
  form.reset();
  document.querySelector("#practice-date").value = todayKey;
  document.querySelector("#practice-minutes").value = 20;
  queueMicrotask(() => {
    isSubmitting = false;
    submitButton.disabled = false;
  });
  const plantName = plant ? plant.flower : "garden";
  const rewardMessage = milestones.earned.length
    ? ` You earned ${milestones.earned.length} seed ${milestones.earned.length === 1 ? "token" : "tokens"} for your ${milestones.earned.join(" and ")} milestone${milestones.earned.length > 1 ? "s" : ""}!`
    : "";
  showToast(`${minutes} minutes added to your ${plantName.toLowerCase()}'s growth.${rewardMessage}`);
});
document.querySelector("#mini-garden").addEventListener("click", (event) => {
  const button = event.target.closest("[data-flower]");
  if (!button) return;
  const flower = FLOWERS.find((item) => item.name === button.dataset.flower);
  if (!flower || state.unlocked.includes(flower.name)) return;
  if (state.seedTokens < flower.cost) {
    showToast(`You need ${flower.cost - state.seedTokens} more seed tokens to unlock ${flower.name.toLowerCase()}.`);
    return;
  }
  const previousState = state;
  state = {
    ...state,
    seedTokens: state.seedTokens - flower.cost,
    unlocked: [...state.unlocked, flower.name],
    garden: [...state.garden, createPlant(flower.name, 0, state.weeklyTargetMinutes)],
  };
  if (!saveState()) {
    state = previousState;
    showToast(storageReadFailed
      ? "Saved data could not be read, so this seed was not unlocked to protect it."
      : "Your browser couldn't save this garden change. Check available storage and try again.");
    return;
  }
  render();
  if (storageReadFailed) warnStorageUnavailable();
  showToast(`${flower.name} seed planted. Your practice will help it grow next.`);
});
document.querySelector("#week-link").addEventListener("click", () => showToast("Your practice week starts on Monday."));
document.querySelectorAll(".nav-link").forEach((link) => {
  link.addEventListener("click", () => {
    document.querySelectorAll(".nav-link").forEach((item) => item.classList.remove("active"));
    link.classList.add("active");
  });
});
render();

const STORAGE_KEY = "petal-practice-v1";
const FLOWERS = [
  { name: "Sunflower", cost: 0, fullBloomMinutes: 1000 },
  { name: "Tulip", cost: 30, petalColor: "#e88087", fullBloomMinutes: 1000 },
  { name: "Daisy", cost: 50, petalColor: "#fffaf0", fullBloomMinutes: 1000 },
  { name: "Lavender", cost: 75, petalColor: "#9c83c5", fullBloomMinutes: 1000 },
];
const DEMO_PROFILE = Object.freeze({
  student: Object.freeze({ firstName: "Emily" }),
  teacher: Object.freeze({ displayName: "Miss Costa" }),
});
const DEFAULT_GROWTH_MILESTONES = Object.freeze([
  { name: "Seed", cssClass: "seed", minutes: 0 },
  { name: "Sprout", cssClass: "sprout", minutes: 120 },
  { name: "Young plant", cssClass: "young-plant", minutes: 270 },
  { name: "Growing", cssClass: "growing", minutes: 500 },
  { name: "Budding", cssClass: "budding", minutes: 700 },
  { name: "Almost blooming", cssClass: "almost-blooming", minutes: 880 },
  { name: "Full bloom", cssClass: "bloom", minutes: 1000 },
]);
const DEFAULT_FULL_BLOOM_MINUTES = 1000;
const LEGACY_FULL_BLOOM_MINUTES = 300;
const GROWTH_STAGES = DEFAULT_GROWTH_MILESTONES.map((milestone) => milestone.name);
const MAX_WEEKLY_TOKENS = 8;
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
function growthMilestonesFor(flowerName, fullBloomMinutes) {
  const flower = FLOWERS.find((item) => item.name === flowerName);
  const configuredMilestones = Array.isArray(flower?.growthMilestones)
    && flower.growthMilestones.length === DEFAULT_GROWTH_MILESTONES.length
    && flower.growthMilestones.every((milestone, index, list) =>
      milestone && typeof milestone.name === "string"
      && typeof milestone.cssClass === "string"
      && Number.isInteger(milestone.minutes)
      && milestone.minutes >= 0
      && (index === 0 ? milestone.minutes === 0 : milestone.minutes > list[index - 1].minutes))
    ? flower.growthMilestones
    : DEFAULT_GROWTH_MILESTONES;
  const configuredGoal = Number.isInteger(flower?.fullBloomMinutes) && flower.fullBloomMinutes >= 7
    ? flower.fullBloomMinutes
    : configuredMilestones[configuredMilestones.length - 1]?.minutes || DEFAULT_FULL_BLOOM_MINUTES;
  const target = Number.isInteger(fullBloomMinutes) && fullBloomMinutes > 0
    ? fullBloomMinutes
    : configuredGoal;
  const sourceGoal = configuredMilestones[configuredMilestones.length - 1].minutes;
  if (target === sourceGoal) return configuredMilestones.map((milestone) => ({ ...milestone }));
  return configuredMilestones.map((milestone, index) => ({
    ...milestone,
    minutes: index === configuredMilestones.length - 1
      ? target
      : Math.round((milestone.minutes / sourceGoal) * target),
  }));
}
function createPlant(flower, minutes) {
  const milestones = growthMilestonesFor(flower);
  return {
    id: newId(),
    flower,
    growthMinutes: minutes,
    growthGoalMinutes: milestones[milestones.length - 1].minutes,
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
    instrument: typeof session.instrument === "string" && session.instrument.trim() ? session.instrument : "Violin",
    focus: typeof session.focus === "string" ? session.focus : "Practice",
    note: typeof session.note === "string" ? session.note : "",
    teacherFeedback: typeof session.teacherFeedback === "string" ? session.teacherFeedback : "",
    createdAt: typeof session.createdAt === "string" ? session.createdAt : "1970-01-01T00:00:00.000Z",
    tokensEarned: Number.isInteger(session.tokensEarned) ? Math.max(0, session.tokensEarned) : 0,
  };
}
function parseTokenBalance(value) {
  const parsed = typeof value === "number" ? value
    : typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value)
      : NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}
function tokenLabel(value) {
  return `${value} seed token${value === 1 ? "" : "s"}`;
}
function recoverTokenBalance(saved, sessions, unlocked) {
  const savedBalance = parseTokenBalance(saved.seedTokens);
  if (savedBalance !== null) return savedBalance;
  const legacyBalance = parseTokenBalance(saved.tokens);
  if (legacyBalance !== null) return legacyBalance;

  const earnedByWeek = new Map();
  for (const session of sessions) {
    const earned = Number.isSafeInteger(session.tokensEarned) ? Math.max(0, session.tokensEarned) : 0;
    const week = startOfWeek(session.date);
    earnedByWeek.set(week, Math.min(MAX_WEEKLY_TOKENS, (earnedByWeek.get(week) || 0) + earned));
  }
  const earned = [...earnedByWeek.values()].reduce((total, tokens) => total + tokens, 0);
  const spent = unlocked.reduce((total, name) => total + (FLOWERS.find((flower) => flower.name === name)?.cost || 0), 0);
  return Math.max(0, earned - spent);
}
function growthFor(plant) {
  const milestones = growthMilestonesFor(plant.flower, plant.growthGoalMinutes);
  const fullBloomMinutes = milestones[milestones.length - 1].minutes;
  const minutes = Math.max(
    Number.isFinite(plant.growthMinutes) ? plant.growthMinutes : 0,
    (Number.isFinite(plant.growthFloor) ? plant.growthFloor : 0) * fullBloomMinutes
  );
  const progress = Math.min(1, minutes / fullBloomMinutes);
  let stage = 0;
  for (let index = 1; index < milestones.length; index += 1) {
    if (minutes < milestones[index].minutes) break;
    stage = index;
  }
  const nextMilestone = milestones[stage + 1] || null;
  const previousMilestone = milestones[stage];
  return {
    progress,
    percent: Math.round(progress * 100),
    stage,
    stageName: milestones[stage].name,
    stageClass: milestones[stage].cssClass,
    minutes,
    fullBloomMinutes,
    nextMilestone,
    minutesToNextMilestone: nextMilestone ? Math.max(0, nextMilestone.minutes - minutes) : 0,
    minutesIntoNextMilestone: nextMilestone ? Math.max(0, minutes - previousMilestone.minutes) : 0,
    minutesBetweenMilestones: nextMilestone ? nextMilestone.minutes - previousMilestone.minutes : 0,
    nextMilestoneProgress: nextMilestone
      ? Math.min(1, (minutes - previousMilestone.minutes) / (nextMilestone.minutes - previousMilestone.minutes))
      : 1,
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
  const seedTokens = recoverTokenBalance(saved, sessions, unlocked);

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
          ? Math.max(7, plant.growthGoalMinutes)
          : growthMilestonesFor(plant.flower)[DEFAULT_GROWTH_MILESTONES.length - 1].minutes,
        growthFloor: Number.isFinite(plant.growthFloor)
          ? Math.min(1, Math.max(0, plant.growthFloor))
          : 0,
      }))
      .map((plant) => ({
        ...plant,
        growthGoalMinutes: plant.growthGoalMinutes === LEGACY_FULL_BLOOM_MINUTES
          ? growthMilestonesFor(plant.flower)[DEFAULT_GROWTH_MILESTONES.length - 1].minutes
          : plant.growthGoalMinutes,
      }));
  } else {
    const previousPracticeMinutes = sessions.reduce((total, session) => total + session.minutes, 0);
    garden = unlocked.map((flower) =>
      createPlant(flower, flower === "Sunflower" ? previousPracticeMinutes : 0)
    );
  }
  for (const flower of unlocked) {
    if (!garden.some((plant) => plant.flower === flower)) garden.push(createPlant(flower, 0));
  }
  const activePlantId = garden.some((plant) => plant.id === saved.activePlantId)
    ? saved.activePlantId
    : garden.find((plant) => growthFor(plant).stage < GROWTH_STAGES.length - 1)?.id || garden[garden.length - 1]?.id;

  return {
    version: 2,
    sessions,
    seedTokens,
    unlocked: [...new Set([...unlocked, ...garden.map((plant) => plant.flower)])],
    weeklyTargetMinutes,
    expectedPracticeDays,
    garden,
    activePlantId,
    weeklyRewards: saved.weeklyRewards && typeof saved.weeklyRewards === "object" && !Array.isArray(saved.weeklyRewards)
      ? saved.weeklyRewards
      : {},
  };
}
function createInitialState() {
  const sunflower = createPlant("Sunflower", 0);
  return {
    version: 2,
    sessions: [],
    seedTokens: 0,
    unlocked: ["Sunflower"],
    weeklyTargetMinutes: 60,
    expectedPracticeDays: 3,
    garden: [sunflower],
    activePlantId: sunflower.id,
    weeklyRewards: {},
  };
}
let state = loadState();
let historyCalendarMonth = new Date(`${todayKey.slice(0, 7)}-01T12:00:00`);
let historyRangeStart = null;
let historyRangeEnd = null;
let historyRangeAwaitingEnd = false;
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
function weekLabel(weekStart) {
  const start = new Date(`${weekStart}T12:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const options = { month: "short", day: "numeric" };
  return `${start.toLocaleDateString(undefined, options)} – ${end.toLocaleDateString(undefined, { ...options, year: "numeric" })}`;
}
function availablePracticeWeeks() {
  const weeks = new Set([startOfWeek(todayKey), ...state.sessions.map((session) => startOfWeek(session.date))]);
  return [...weeks].sort((a, b) => b.localeCompare(a));
}
function historyDateRange() {
  const currentWeekStart = startOfWeek(todayKey);
  if (document.querySelector("#week-history-select").value === "this-week") {
    const end = new Date(`${currentWeekStart}T12:00:00`);
    end.setDate(end.getDate() + 6);
    return { start: currentWeekStart, end: dateKey(end), label: `This Week · ${weekLabel(currentWeekStart)}` };
  }
  if (document.querySelector("#week-history-select").value === "last-week") {
    const start = new Date(`${currentWeekStart}T12:00:00`);
    start.setDate(start.getDate() - 7);
    const startKey = dateKey(start);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return { start: startKey, end: dateKey(end), label: `Last Week · ${weekLabel(startKey)}` };
  }
  if (document.querySelector("#week-history-select").value === "this-month") {
    const start = `${todayKey.slice(0, 7)}-01`;
    const [year, month] = todayKey.split("-").map(Number);
    const end = dateKey(new Date(year, month, 0, 12));
    return { start, end, label: `This Month · ${dateLabel(start, { month: "long", year: "numeric" })}` };
  }
  if (document.querySelector("#week-history-select").value === "last-month") {
    const [year, month] = todayKey.split("-").map(Number);
    const start = dateKey(new Date(year, month - 2, 1, 12));
    const end = dateKey(new Date(year, month - 1, 0, 12));
    return { start, end, label: `Last Month · ${dateLabel(start, { month: "long", year: "numeric" })}` };
  }
  const start = historyRangeStart || todayKey;
  const end = historyRangeEnd || start;
  const first = start <= end ? start : end;
  const last = start <= end ? end : start;
  const label = first === last
    ? dateLabel(first, { month: "short", day: "numeric", year: "numeric" })
    : `${dateLabel(first, { month: "short", day: "numeric", year: "numeric" })} – ${dateLabel(last, { month: "short", day: "numeric", year: "numeric" })}`;
  return { start: first, end: last, label: `Choose Dates · ${label}` };
}
function renderHistoryCalendar() {
  const month = historyCalendarMonth;
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstDay = new Date(year, monthIndex, 1, 12);
  const daysInMonth = new Date(year, monthIndex + 1, 0, 12).getDate();
  const leadingDays = (firstDay.getDay() + 6) % 7;
  const sessionsByDate = new Map();
  for (const session of state.sessions) {
    sessionsByDate.set(session.date, (sessionsByDate.get(session.date) || 0) + 1);
  }
  document.querySelector("#history-calendar-month").textContent = month.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const cells = Array.from({ length: leadingDays }, () => '<span class="history-calendar-blank" aria-hidden="true"></span>');
  for (let day = 1; day <= daysInMonth; day += 1) {
    const key = dateKey(new Date(year, monthIndex, day, 12));
    const isStart = key === historyRangeStart;
    const isEnd = key === historyRangeEnd;
    const inRange = historyRangeStart && historyRangeEnd
      && key >= (historyRangeStart < historyRangeEnd ? historyRangeStart : historyRangeEnd)
      && key <= (historyRangeStart < historyRangeEnd ? historyRangeEnd : historyRangeStart);
    const count = sessionsByDate.get(key) || 0;
    const classes = [
      "history-calendar-day",
      inRange ? "is-range" : "",
      isStart ? "is-range-start" : "",
      isEnd ? "is-range-end" : "",
      count ? "has-practice" : "",
      key === todayKey ? "is-today" : "",
    ].filter(Boolean).join(" ");
    const practiceLabel = count ? `, ${count} practice ${count === 1 ? "session" : "sessions"}` : ", no practice sessions";
    cells.push(`<button class="${classes}" type="button" role="gridcell" data-history-date="${key}" aria-label="${dateLabel(key, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}${practiceLabel}" aria-pressed="${isStart || isEnd}"><span>${day}</span>${count ? '<small aria-hidden="true">✿</small>' : ""}</button>`);
  }
  document.querySelector("#history-calendar-days").innerHTML = cells.join("");
  document.querySelector("#history-range-help").textContent = historyRangeAwaitingEnd
    ? `Start date: ${dateLabel(historyRangeStart)}. Choose an end date, or choose another date to start over.`
    : historyRangeStart && historyRangeEnd
      ? "Choose another date to start a new range."
      : "Choose a date, then choose another date to set a range.";
}
function renderWeekHistory() {
  const select = document.querySelector("#week-history-select");
  if (!select) return;
  const period = select.value || "this-week";
  const range = historyDateRange();
  const calendar = document.querySelector("#history-calendar");
  calendar.hidden = period !== "custom";
  if (period === "custom") renderHistoryCalendar();
  const sessions = state.sessions
    .filter((session) => session.date >= range.start && session.date <= range.end)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const totalMinutes = sessions.reduce((total, session) => total + session.minutes, 0);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const totalTime = hours ? `${hours} hr${hours === 1 ? "" : "s"}${minutes ? ` ${minutes} min` : ""}` : `${totalMinutes} min`;
  const practiceDays = new Set(sessions.map((session) => session.date)).size;
  document.querySelector("#history-period-summary").textContent = range.label;
  document.querySelector("#history-session-count").textContent = sessions.length;
  document.querySelector("#history-total-time").textContent = totalTime;
  document.querySelector("#history-day-count").textContent = practiceDays;
  const trigger = document.querySelector("#week-link");
  trigger.firstChild.textContent = period === "custom" ? "Choose Dates " : `${select.options[select.selectedIndex].text} `;
  const list = document.querySelector("#week-history-list");
  list.innerHTML = sessions.length
    ? sessions.map((session) => `<article class="week-history-entry"><strong>${dateLabel(session.date, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</strong><span>${session.minutes} min · ${escapeHtml(session.instrument)} · ${escapeHtml(session.focus)}</span>${session.note ? `<p class="history-session-note"><strong>Your note:</strong> ${escapeHtml(session.note)}</p>` : ""}</article>`).join("")
    : '<p class="empty-log">No practice sessions recorded during this period. Every new session is another step towards growing your garden!</p>';
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
  const progressBar = document.querySelector(".goal-progress");
  progressBar.setAttribute("aria-valuemax", state.weeklyTargetMinutes);
  progressBar.setAttribute("aria-valuenow", Math.min(total, state.weeklyTargetMinutes));
  progressBar.setAttribute("aria-valuetext", `${total} of ${state.weeklyTargetMinutes} minutes this week`);
  document.querySelector("#goal-progress-fill").style.width = `${percent}%`;
  document.querySelector("#goal-percent").textContent = `${percent}%`;
  renderFriends(total);
  renderWeekHistory();
}
function renderFriends(studentMinutes) {
  const friends = [
    { name: "Lily Chen", instrument: "Flute", minutes: 85, initial: "L", avatar: "avatar-peach", flower: "🌼" },
    { name: "Alex Rivera", instrument: "Piano", minutes: 70, initial: "A", avatar: "avatar-blue", flower: "🌷" },
    { name: DEMO_PROFILE.student.firstName, instrument: "Violin", minutes: studentMinutes, initial: DEMO_PROFILE.student.firstName[0].toUpperCase(), avatar: "avatar-green", flower: "🌱", isYou: true },
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
  const selected = state.garden.find((plant) => plant.id === state.activePlantId);
  if (selected && growthFor(selected).stage < GROWTH_STAGES.length - 1) return selected;
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
  const face = flower.name === "Sunflower" || flower.name === "Daisy"
    ? '<g class="plant-face" fill="#573e32"><circle cx="75" cy="53" r="1.7"/><circle cx="85" cy="53" r="1.7"/><path d="M76 59Q80 63 84 59" fill="none" stroke="#573e32" stroke-width="1.5" stroke-linecap="round"/></g>'
    : "";
  return `<svg class="plant-svg species-${flower.name.toLowerCase()}" viewBox="0 0 160 205" role="img" aria-labelledby="${id}-title">
    <title id="${id}-title">${flower.name}, ${growth.stageName.toLowerCase()}, ${health.label.toLowerCase()}</title>
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
  const plant = activePlant() || state.garden.find((item) => item.id === state.activePlantId) || state.garden[state.garden.length - 1];
  const target = document.querySelector("#hero-flower");
  if (!plant) {
    target.innerHTML = "";
    document.querySelector("#hero-plant-name").textContent = "Garden in bloom";
    document.querySelector("#flower-stage").textContent = "All flowers grown";
    document.querySelector("#flower-growth-detail").textContent = "Every flower has reached full bloom.";
    document.querySelector("#flower-progress").setAttribute("aria-valuenow", "100");
    document.querySelector("#flower-progress-fill").style.width = "100%";
    document.querySelector("#streak-count").textContent = `${getStreak()} ${getStreak() === 1 ? "day" : "days"}`;
    document.querySelector("#token-count").textContent = tokenLabel(state.seedTokens);
    return;
  }
  const growth = growthFor(plant);
  const flower = FLOWERS.find((item) => item.name === plant.flower) || FLOWERS[0];
  target.className = `hero-plant-wrap growth-${growth.stageClass} plant-health-${health.status}`;
  const existingSvg = target.querySelector(".plant-svg");
  if (!existingSvg || existingSvg.dataset.plantId !== plant.id) {
    target.innerHTML = plantSvg(plant, health, "hero-plant");
  }
  const svg = target.querySelector(".plant-svg");
  svg.dataset.plantId = plant.id;
  updatePlantSvg(svg, plant, health);
  document.querySelector("#hero-plant-name").textContent = flower.name;
  document.querySelector("#flower-stage").textContent = `${growth.stageName} · ${growth.minutes} min · ${health.label}`;
  document.querySelector("#flower-growth-detail").textContent = growth.nextMilestone
    ? `Next: ${growth.nextMilestone.name} · ${growth.minutesIntoNextMilestone}/${growth.minutesBetweenMilestones} min · Bloom: ${growth.minutes}/${growth.fullBloomMinutes} min (${growth.percent}%)`
    : `Full bloom · ${growth.minutes}/${growth.fullBloomMinutes} min (${growth.percent}%)`;
  document.querySelector("#flower-progress").setAttribute("aria-valuenow", growth.percent);
  document.querySelector("#flower-progress").setAttribute("aria-valuetext", `${growth.minutes} of ${growth.fullBloomMinutes} cumulative minutes; ${growth.percent}% to full bloom`);
  document.querySelector("#flower-progress-fill").style.width = `${growth.percent}%`;
  document.querySelector("#streak-count").textContent = `${getStreak()} ${getStreak() === 1 ? "day" : "days"}`;
  document.querySelector("#token-count").textContent = tokenLabel(state.seedTokens);
}
function renderLog() {
  const list = document.querySelector("#log-list");
  const entries = [...state.sessions]
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
    .slice(0, 4);
  if (!entries.length) {
    list.innerHTML = '<div class="empty-log">Your first practice session is waiting to be planted. 🌱</div>';
    return;
  }
  list.innerHTML = entries.map((session) => {
    const day = session.date === todayKey ? "Today" : dateLabel(session.date, { weekday: "short", month: "short", day: "numeric" });
    const note = session.note ? ` · ${escapeHtml(session.note)}` : "";
    const reward = session.tokensEarned ? `<small>+${session.tokensEarned} seed ${session.tokensEarned === 1 ? "token" : "tokens"}</small>` : "<small>Practice session saved</small>";
    return `<article class="log-entry"><div class="log-icon">♫</div><div class="log-details"><strong>${escapeHtml(session.focus)}</strong><span>${day} · ${escapeHtml(session.instrument)}${note}</span></div><div class="log-duration">${session.minutes} min${reward}</div></article>`;
  }).join("");
}
const ENCOURAGEMENTS = [
  "Keep practicing!",
  "Stay sharp and keep shining!",
  "Tune into happiness.",
  "Don't fret, practice makes perfect!",
  "Keep up the note-worthy work.",
  "You are making treble-mendous progress!",
  "Don't stop beating your personal bests.",
  "Every minute you practice scales up your talent.",
];
function sessionEncouragements(sessions) {
  let previousIndex = -1;
  return sessions.map((session) => {
    let hash = 0;
    for (const char of session.id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    let index = hash % ENCOURAGEMENTS.length;
    if (index === previousIndex) index = (index + 1) % ENCOURAGEMENTS.length;
    previousIndex = index;
    return ENCOURAGEMENTS[index];
  });
}
function renderCompleteLog() {
  const list = document.querySelector("#complete-log-list");
  const filter = document.querySelector("#log-week-filter");
  const weeks = availablePracticeWeeks();
  const previousFilter = filter.value;
  filter.innerHTML = `<option value="all">All weeks</option>${weeks.map((week) => `<option value="${week}">${week === startOfWeek(todayKey) ? "This week" : weekLabel(week)}</option>`).join("")}`;
  filter.value = weeks.includes(previousFilter) || previousFilter === "all" ? previousFilter : "all";
  const sessions = [...state.sessions]
    .filter((session) => filter.value === "all" || startOfWeek(session.date) === filter.value)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  if (!sessions.length) {
    list.innerHTML = '<div class="empty-log">No practice sessions yet. Your next note-worthy moment is waiting.</div>';
    return;
  }
  const encouragements = sessionEncouragements(sessions);
  list.innerHTML = sessions.map((session, index) => {
    const note = session.note ? escapeHtml(session.note) : "No student note added.";
    const feedback = session.teacherFeedback
      ? escapeHtml(session.teacherFeedback)
      : "No teacher feedback has been recorded for this session.";
    return `<article class="complete-log-entry">
      <div class="log-entry"><div class="log-icon">♫</div><div class="log-details"><strong>${escapeHtml(session.focus)}</strong><span>${dateLabel(session.date, { weekday: "long", month: "long", day: "numeric", year: "numeric" })} · ${escapeHtml(session.instrument)}</span></div><div class="log-duration">${session.minutes} min</div></div>
      <p class="practice-encouragement">${encouragements[index]}</p>
      <div class="session-notes"><p><strong>Your practice notes</strong><span>${note}</span></p><p class="teacher-session-feedback"><strong>Teacher feedback</strong><span>${feedback}</span></p></div>
    </article>`;
  }).join("");
}
function renderGardenPage() {
  const container = document.querySelector("#full-garden");
  const health = getPlantHealth();
  const active = activePlant();
  document.querySelector("#full-collection-count").textContent = `${state.garden.length} ${state.garden.length === 1 ? "flower" : "flowers"}`;
  if (!state.garden.length) {
    container.innerHTML = '<p class="empty-log">Your first seed is ready when you are.</p>';
    return;
  }
  container.innerHTML = state.garden.map((plant) => {
    const growth = growthFor(plant);
    const stage = growth.stageName;
    const isActive = plant.id === active?.id;
    const featureControl = growth.stage < GROWTH_STAGES.length - 1
      ? `<button class="garden-feature-button" type="button" data-feature-plant="${escapeHtml(plant.id)}">${isActive ? "Currently growing" : "Grow this flower"}</button>`
      : '<span class="garden-bloom-label">A lasting bloom</span>';
    return `<article class="garden-plant garden-page-plant growth-${growth.stageClass} plant-health-${health.status}${isActive ? " is-active" : ""}" data-plant-id="${escapeHtml(plant.id)}" aria-label="${escapeHtml(plant.flower)}, ${stage}, ${health.label}">
      ${plantSvg(plant, health, `garden-page-${plant.id}`)}
      <span class="garden-plant-name">${escapeHtml(plant.flower)}</span>
      <span class="garden-plant-status">${stage} · ${growth.minutes}/${growth.fullBloomMinutes} min<br>${growth.nextMilestone ? `Next: ${growth.nextMilestone.name} ${growth.minutesIntoNextMilestone}/${growth.minutesBetweenMilestones} min` : "Full bloom achieved"} · ${health.label}</span>
      <span class="garden-plant-progress" role="progressbar" aria-label="${escapeHtml(plant.flower)} growth" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${growth.percent}"><span style="width:${growth.percent}%"></span></span>
      ${featureControl}
    </article>`;
  }).join("");
  container.querySelectorAll(".plant-svg").forEach((svg) => {
    const plant = state.garden.find((item) => item.id === svg.closest("[data-plant-id]")?.dataset.plantId);
    if (plant) updatePlantSvg(svg, plant, health);
  });
}
const SAMPLE_CLASSMATES = [
  { id: "lily", name: "Lily Chen", instrument: "Flute", minutes: 85, initial: "L", avatar: "avatar-peach", plants: [{ flower: "Daisy", growthMinutes: 390, growthGoalMinutes: 420 }, { flower: "Sunflower", growthMinutes: 95, growthGoalMinutes: 300 }], achievement: "Two flowers growing" },
  { id: "alex", name: "Alex Rivera", instrument: "Piano", minutes: 70, initial: "A", avatar: "avatar-blue", plants: [{ flower: "Tulip", growthMinutes: 400, growthGoalMinutes: 400 }], achievement: "A new bloom" },
  { id: "noah", name: "Noah Park", instrument: "Cello", minutes: 35, initial: "N", avatar: "avatar-lilac", plants: [{ flower: "Lavender", growthMinutes: 150, growthGoalMinutes: 400 }], achievement: "Building a steady habit" },
];
let selectedClassmateId = SAMPLE_CLASSMATES[0].id;
function renderClassmates() {
  const roster = document.querySelector("#classmates-roster");
  const selected = SAMPLE_CLASSMATES.find((friend) => friend.id === selectedClassmateId) || SAMPLE_CLASSMATES[0];
  roster.innerHTML = SAMPLE_CLASSMATES.map((friend) =>
    `<button class="friend-row classmate-choice${friend.id === selected.id ? " is-selected" : ""}" type="button" data-sample-classmate="${friend.id}" aria-pressed="${friend.id === selected.id}"><span class="friend-avatar ${friend.avatar}">${friend.initial}</span><span class="friend-info"><strong>${friend.name}</strong><small>${friend.instrument} · ${friend.minutes} min this week</small></span><span class="friend-rank">›</span></button>`
  ).join("");
  document.querySelector("#classmate-garden-heading").textContent = `${selected.name}'s garden`;
  document.querySelector("#classmate-achievement").textContent = "Sample";
  document.querySelector("#classmate-progress").textContent = `${selected.instrument} · ${selected.minutes} minutes this week · ${selected.achievement}`;
  document.querySelector("#classmate-garden").innerHTML = selected.plants.map((plant, index) => {
    const growth = growthFor(plant);
    const health = { status: "healthy", label: "Healthy" };
    const stage = growth.stageName;
    return `<article class="garden-plant garden-page-plant growth-${growth.stageClass} plant-health-healthy">
      ${plantSvg(plant, health, `sample-${selected.id}-${index}`)}
      <span class="garden-plant-name">${plant.flower}</span>
      <span class="garden-plant-status">${stage} · ${growth.minutes}/${growth.fullBloomMinutes} min<br>${growth.nextMilestone ? `Next: ${growth.nextMilestone.name} ${growth.minutesIntoNextMilestone}/${growth.minutesBetweenMilestones} min` : "Full bloom achieved"} · Healthy</span>
      <span class="garden-plant-progress" role="progressbar" aria-label="${plant.flower} sample growth" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${growth.percent}"><span style="width:${growth.percent}%"></span></span>
    </article>`;
  }).join("");
  document.querySelectorAll("#classmate-garden .plant-svg").forEach((svg, index) => updatePlantSvg(svg, selected.plants[index], { status: "healthy", label: "Healthy" }));
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
  if (title) title.textContent = `${flower.name}, ${growth.stageName.toLowerCase()}, ${health.label.toLowerCase()}`;
}
function renderCollection() {
  const health = getPlantHealth();
  const garden = document.querySelector("#mini-garden");
  document.querySelector("#shop-token-count").textContent = tokenLabel(state.seedTokens);
  document.querySelector("#collection-count").textContent = `${state.garden.length} / ${FLOWERS.length}`;
  const active = activePlant();
  FLOWERS.forEach((flower, index) => {
    const seedPlant = {
      flower: flower.name,
      growthMinutes: 0,
      growthGoalMinutes: growthMilestonesFor(flower.name)[DEFAULT_GROWTH_MILESTONES.length - 1].minutes,
      growthFloor: 0,
    };
    const plant = state.garden.find((item) => item.flower === flower.name);
    if (plant) {
      const growth = growthFor(plant);
      const stageName = growth.stageName;
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
      card.className = `garden-plant growth-${growth.stageClass} plant-health-${health.status}${activeClass}`;
      card.setAttribute("aria-label", `${flower.name}, ${stageName}, ${health.label}${plant.id === active?.id ? ", currently growing" : ""}`);
      card.querySelector(".garden-plant-name").textContent = flower.name;
      card.querySelector(".garden-plant-status").innerHTML = `${plant.id === active?.id ? "Tending now · " : ""}${stageName} · ${growth.minutes}/${growth.fullBloomMinutes} min<br>${growth.nextMilestone ? `Next: ${growth.nextMilestone.name} ${growth.minutesIntoNextMilestone}/${growth.minutesBetweenMilestones} min` : "Full bloom achieved"} · ${health.label}`;
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
      button.innerHTML = `${plantSvg(seedPlant, health, `locked-${flower.name.toLowerCase()}`)}
        <span class="garden-plant-name"></span><span class="seed-cost"></span>`;
    }
    button.setAttribute("aria-label", `Unlock ${flower.name} seed for ${flower.cost} seed tokens`);
    button.querySelector(".garden-plant-name").textContent = `${flower.name} seed`;
    button.querySelector(".seed-cost").textContent = `${flower.cost} seed tokens`;
    updatePlantSvg(button.querySelector(".plant-svg"), seedPlant, health);
    const currentAtIndex = garden.children[index];
    if (currentAtIndex !== button) garden.insertBefore(button, currentAtIndex || null);
  });
}
function render() {
  renderWeek();
  renderFlower();
  renderLog();
  renderCollection();
  renderCompleteLog();
  renderGardenPage();
  renderClassmates();
}
function awardWeeklyMilestones(sessions, week, previousRewards) {
  const weekSessions = sessionsInWeek(week, sessions);
  const minutes = weekSessions.reduce((total, session) => total + session.minutes, 0);
  const practiceDays = new Set(weekSessions.map((session) => session.date)).size;
  const old = previousRewards[week] || {};
  const earned = [];
  const updatedWeek = { ...old };
  const weeklyTargetMinutes = Number.isInteger(old.weeklyTargetMinutes) ? old.weeklyTargetMinutes : state.weeklyTargetMinutes;
  const expectedPracticeDays = Number.isInteger(old.expectedPracticeDays) ? old.expectedPracticeDays : state.expectedPracticeDays;
  if (!old.consistency && practiceDays >= expectedPracticeDays) {
    updatedWeek.consistency = true;
    earned.push("consistency");
  }
  if (!old.goal && minutes >= weeklyTargetMinutes) {
    updatedWeek.goal = true;
    earned.push("weekly goal");
  }
  updatedWeek.weeklyTargetMinutes = weeklyTargetMinutes;
  updatedWeek.expectedPracticeDays = expectedPracticeDays;
  const alreadyAwarded = weekSessions.reduce((total, session) => total + session.tokensEarned, 0);
  const availableWeeklyAwards = Math.max(0, MAX_WEEKLY_TOKENS - alreadyAwarded);
  return { earned: earned.slice(0, availableWeeklyAwards), updatedWeek };
}
function snapshotExistingWeeklyGoals(sessions, weeklyRewards) {
  const updatedRewards = { ...weeklyRewards };
  const weeks = new Set(sessions.map((session) => startOfWeek(session.date)));
  for (const week of weeks) {
    const existing = updatedRewards[week] || {};
    if (Number.isInteger(existing.weeklyTargetMinutes) && Number.isInteger(existing.expectedPracticeDays)) continue;
    const weekSessions = sessionsInWeek(week, sessions);
    const minutes = weekSessions.reduce((total, session) => total + session.minutes, 0);
    const days = new Set(weekSessions.map((session) => session.date)).size;
    updatedRewards[week] = {
      ...existing,
      weeklyTargetMinutes: Number.isInteger(existing.weeklyTargetMinutes) ? existing.weeklyTargetMinutes : state.weeklyTargetMinutes,
      expectedPracticeDays: Number.isInteger(existing.expectedPracticeDays) ? existing.expectedPracticeDays : state.expectedPracticeDays,
      goal: Boolean(existing.goal) || minutes >= state.weeklyTargetMinutes,
      consistency: Boolean(existing.consistency) || days >= state.expectedPracticeDays,
    };
  }
  return updatedRewards;
}
function updateGoalDialog() {
  document.querySelector("#weekly-target-input").value = state.weeklyTargetMinutes;
  document.querySelector("#expected-days-input").value = state.expectedPracticeDays;
}

document.querySelector("#today-label").textContent = new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
document.querySelector(".eyebrow").innerHTML = `${new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }).toUpperCase()} <span class="eyebrow-dot">✳</span> A FRESH START`;
document.querySelector("#dashboard-greeting").textContent = `${new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 18 ? "Good afternoon" : "Good evening"}, ${DEMO_PROFILE.student.firstName}`;
document.querySelector("#student-display-name").textContent = DEMO_PROFILE.student.firstName;
document.querySelector("#student-avatar").textContent = DEMO_PROFILE.student.firstName[0].toUpperCase();
document.querySelector("#teacher-display-name").textContent = DEMO_PROFILE.teacher.displayName;
document.querySelector("#teacher-avatar").textContent = DEMO_PROFILE.teacher.displayName[0].toUpperCase();
document.querySelector("#practice-date").value = todayKey;
document.querySelector("#practice-date").max = todayKey;
document.querySelector("#week-history-select").addEventListener("change", () => {
  const select = document.querySelector("#week-history-select");
  if (select.value === "custom" && !historyRangeStart) {
    historyRangeStart = todayKey;
    historyRangeEnd = todayKey;
    historyRangeAwaitingEnd = false;
  }
  renderWeekHistory();
});
document.querySelector("#week-link").setAttribute("aria-expanded", "false");
document.querySelector("#week-link").addEventListener("click", () => {
  const panel = document.querySelector("#week-history-panel");
  panel.hidden = !panel.hidden;
  document.querySelector("#week-link").setAttribute("aria-expanded", String(!panel.hidden));
  if (!panel.hidden) renderWeekHistory();
});
document.addEventListener("pointerdown", (event) => {
  const panel = document.querySelector("#week-history-panel");
  const trigger = document.querySelector("#week-link");
  if (!panel.hidden && !panel.contains(event.target) && !trigger.contains(event.target)) {
    panel.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  const panel = document.querySelector("#week-history-panel");
  if (panel.hidden) return;
  panel.hidden = true;
  document.querySelector("#week-link").setAttribute("aria-expanded", "false");
  document.querySelector("#week-link").focus();
});
document.querySelector("#history-month-prev").addEventListener("click", () => {
  historyCalendarMonth = new Date(historyCalendarMonth.getFullYear(), historyCalendarMonth.getMonth() - 1, 1, 12);
  renderWeekHistory();
});
document.querySelector("#history-month-next").addEventListener("click", () => {
  historyCalendarMonth = new Date(historyCalendarMonth.getFullYear(), historyCalendarMonth.getMonth() + 1, 1, 12);
  renderWeekHistory();
});
document.querySelector("#history-calendar-days").addEventListener("click", (event) => {
  const button = event.target.closest("[data-history-date]");
  if (!button) return;
  const selectedDate = button.dataset.historyDate;
  if (!historyRangeStart || !historyRangeAwaitingEnd) {
    historyRangeStart = selectedDate;
    historyRangeEnd = selectedDate;
    historyRangeAwaitingEnd = true;
  } else if (selectedDate < historyRangeStart) {
    historyRangeEnd = historyRangeStart;
    historyRangeStart = selectedDate;
    historyRangeAwaitingEnd = false;
  } else {
    historyRangeEnd = selectedDate;
    historyRangeAwaitingEnd = false;
  }
  renderWeekHistory();
});
document.querySelector("#log-week-filter").addEventListener("change", renderCompleteLog);
document.querySelector("#full-garden").addEventListener("click", (event) => {
  const button = event.target.closest("[data-feature-plant]");
  if (!button) return;
  const plant = state.garden.find((item) => item.id === button.dataset.featurePlant);
  if (!plant || growthFor(plant).stage >= GROWTH_STAGES.length - 1) return;
  const previousState = state;
  state = { ...state, activePlantId: plant.id };
  if (!saveState()) {
    state = previousState;
    showToast("Your browser couldn't save this garden choice. Check available storage and try again.");
    return;
  }
  render();
  showToast(`${plant.flower} is now featured on your dashboard.`);
});
document.querySelector("#classmates-roster").addEventListener("click", (event) => {
  const button = event.target.closest("[data-sample-classmate]");
  if (!button) return;
  selectedClassmateId = button.dataset.sampleClassmate;
  renderClassmates();
});
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
  state = {
    ...state,
    weeklyTargetMinutes,
    expectedPracticeDays,
    weeklyRewards: snapshotExistingWeeklyGoals(state.sessions, state.weeklyRewards),
  };
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
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240 || !isDateKey(date) || date > todayKey) {
    showToast("Choose a practice time from 1–240 minutes and a real date no later than today.");
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
    instrument: String(data.get("instrument")),
    focus: String(data.get("focus")),
    note: String(data.get("note")).trim(),
    createdAt: new Date().toISOString(),
    tokensEarned: 0,
  };
  const plant = activePlant();
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
    activePlantId: plant?.id || state.activePlantId,
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
const flowersBeingUnlocked = new Set();
document.querySelector("#mini-garden").addEventListener("click", (event) => {
  const button = event.target.closest("[data-flower]");
  if (!button) return;
  const flower = FLOWERS.find((item) => item.name === button.dataset.flower);
  if (!flower || state.unlocked.includes(flower.name) || flowersBeingUnlocked.has(flower.name)) return;
  const availableTokens = parseTokenBalance(state.seedTokens);
  if (!Number.isSafeInteger(flower.cost) || flower.cost < 0 || availableTokens === null) {
    console.error("Flower unlock stopped because its cost or the saved token balance is invalid.", {
      flower: flower.name,
      cost: flower.cost,
      availableTokens: state.seedTokens,
    });
    showToast("Your seed token balance could not be verified. No tokens were spent.");
    return;
  }
  if (availableTokens < flower.cost) {
    const needed = flower.cost - availableTokens;
    showToast(`You need ${needed} more seed token${needed === 1 ? "" : "s"} to unlock ${flower.name.toLowerCase()}.`);
    return;
  }
  flowersBeingUnlocked.add(flower.name);
  button.disabled = true;
  const previousState = state;
  const plant = createPlant(flower.name, 0);
  state = {
    ...state,
    seedTokens: availableTokens - flower.cost,
    unlocked: [...state.unlocked, flower.name],
    garden: [...state.garden, plant],
    activePlantId: plant.id,
  };
  if (!saveState()) {
    state = previousState;
    flowersBeingUnlocked.delete(flower.name);
    button.disabled = false;
    showToast(storageReadFailed
      ? "Saved data could not be read, so this seed was not unlocked to protect it."
      : "Your browser couldn't save this garden change. Check available storage and try again.");
    return;
  }
  render();
  flowersBeingUnlocked.delete(flower.name);
  if (storageReadFailed) warnStorageUnavailable();
  showToast(`${flower.name} unlocked and planted. Your practice will help it grow next.`);
});
function showPage() {
  const page = {
    "#garden-page": "garden",
    "#practice-log-page": "practice-log",
    "#classmates-page": "classmates",
  }[window.location.hash] || "dashboard";
  const titles = { dashboard: "Dashboard", garden: "My garden", "practice-log": "Practice log", classmates: "Classmates" };
  document.querySelectorAll("[data-page-view]").forEach((view) => {
    view.hidden = view.dataset.pageView !== page;
  });
  document.querySelector("#page-title").textContent = titles[page];
  document.querySelectorAll(".nav-link").forEach((link) => {
    link.classList.toggle("active", link.dataset.page === page);
  });
  const inYourSpace = page !== "dashboard";
  document.querySelectorAll(".space-nav-group").forEach((group) => {
    const summary = group.querySelector("summary");
    summary.classList.toggle("active", inYourSpace);
    if (inYourSpace) group.open = true;
  });
  if (page === "garden") renderGardenPage();
  if (page === "practice-log") renderCompleteLog();
  if (page === "classmates") renderClassmates();
}
window.addEventListener("hashchange", showPage);
render();
showPage();

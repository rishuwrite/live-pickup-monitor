/**
 * Lenskart Live Pickup Monitor — TV Layout script.js
 */

const SHEET_GET_URL    = "https://script.google.com/macros/s/AKfycbwDjSwykFzMWHerWI0SA_ROS0uKYSpE09eWY5NaLzUlqG39O2h3W3bfzAWsy7-SYVVW/exec";
const COUNTS_REFRESH_MS = 30_000;

let pickupData  = [];
let counts      = {};
let lastUpdated = null;
let lastRunKey  = "";

// ── Courier key ───────────────────────────────────────────────────────────────
function courierKey(name) {
  return name.split(/ RD /i)[0].trim();
}

function getCount(name) {
  if (Object.keys(counts).length === 0) return null;
  return counts[courierKey(name)] ?? 0;
}

// ── Courier card HTML ─────────────────────────────────────────────────────────
function courierCard(name) {
  const c = getCount(name);
  let badgeClass, badgeText, cardClass;

  if (c === null) {
    badgeClass = "count-unknown"; badgeText = "⏳ —"; cardClass = "unknown";
  } else if (c === 0) {
    badgeClass = "count-zero";    badgeText = "✅ 0"; cardClass = "zero";
  } else {
    badgeClass = "count-live";    badgeText = `📦 ${c}`; cardClass = "has-count";
  }

  return `
    <div class="courier-card ${cardClass}">
      <span class="courier-name">${name}</span>
      <span class="count-badge ${badgeClass}">${badgeText}</span>
    </div>`;
}

// ── Time helpers ──────────────────────────────────────────────────────────────
function toMin(t) {
  const [tm, ap] = t.split(" ");
  let [h, m] = tm.split(":").map(Number);
  if (h === 12) h = 0;
  if (ap === "PM") h += 12;
  return h * 60 + m;
}

function normalizeFuture(s, now) {
  return s <= now ? s + 1440 : s;
}

function buildSlotMap(arr) {
  const map = {};
  arr.forEach(p => {
    const k = `${p.start}|${p.end}`;
    if (!map[k]) map[k] = { start: p.start, end: p.end, pickups: [], sortStart: p.sortStart };
    map[k].pickups.push(p);
  });
  return Object.values(map).sort((a, b) => a.sortStart - b.sortStart);
}

// ── DOM ───────────────────────────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }

function flashShake(el) {
  el.classList.add("flash", "shake");
  setTimeout(() => el.classList.remove("flash", "shake"), 600);
}

// ── Clock ─────────────────────────────────────────────────────────────────────
function getIST() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
}

function formatClock(t) {
  const base = new Intl.DateTimeFormat("en-IN", {
    weekday: "long", day: "numeric", month: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true,
  }).format(t);
  return `${base}.${Math.floor(t.getMilliseconds() / 100)}`;
}

// ── Last updated ──────────────────────────────────────────────────────────────
function renderLastUpdated() {
  const el = $("lastUpdated");
  if (!el) return;
  if (!lastUpdated) {
    el.textContent = "⏳ Counts: waiting for first push...";
    el.className = "last-updated stale";
  } else {
    el.textContent = `📊 Counts last pushed: ${lastUpdated}`;
    el.className = "last-updated fresh";
  }
}

// ── Fetch counts ──────────────────────────────────────────────────────────────
async function fetchCounts() {
  try {
    const res  = await fetch(SHEET_GET_URL + "?t=" + Date.now());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    lastUpdated = data.timestamp || null;
    const nc = {};
    Object.entries(data).forEach(([k, v]) => {
      if (k !== "timestamp" && typeof v === "number") nc[k] = v;
    });
    counts = nc;
    renderLastUpdated();
  } catch (err) {
    console.warn("Counts fetch failed:", err.message);
  }
}

// ── Main update (100ms) ───────────────────────────────────────────────────────
function update() {
  const ist    = getIST();
  const curMin = ist.getHours() * 60 + ist.getMinutes();
  const nowSec = ist.getHours() * 3600 + ist.getMinutes() * 60 + ist.getSeconds();

  $("clock").innerText = formatClock(ist);

  const running = [], future = [];

  pickupData.forEach(p => {
    let s = toMin(p.start), e = toMin(p.end);
    if (e <= s) e += 1440;
    const inWindow = (curMin >= s && curMin < e) || (e > 1440 && curMin < e - 1440);
    if (inWindow) running.push({ ...p, startMin: s, endMin: e });
    else future.push({ ...p, sortStart: normalizeFuture(s, curMin) });
  });

  // ── Running card ────────────────────────────────────────────────────────────
  const runRow = $("runningRow");

  if (running.length) {
    runRow.style.display = "block";

    const first  = running[0];
    const remain = Math.max(0, first.endMin * 60 - nowSec);
    const total  = (first.endMin - first.startMin) * 60;
    const pct    = Math.min(100, ((total - remain) / total) * 100);

    const names = running.map(x => x.name).join(",");
    if (names !== lastRunKey) { flashShake(runRow); lastRunKey = names; }

    $("runningMeta").innerHTML = `
      <span class="time-badge">${first.start} – ${first.end}</span>
      <span class="countdown-badge">⏱ ${Math.floor(remain / 60)}m ${remain % 60}s</span>
    `;
    $("current").innerHTML = running.map(p => courierCard(p.name)).join("");
    $("progressBar").style.width = pct.toFixed(1) + "%";

  } else {
    runRow.style.display = "none";
  }

  // ── Upcoming 3 slots ────────────────────────────────────────────────────────
  const slots = buildSlotMap(future).slice(0, 3);

  [0, 1, 2].forEach(i => {
    const slot = slots[i];
    const metaEl     = $(`meta${i}`);
    const couriersEl = $(`couriers${i}`);
    const cardEl     = $(`slot${i}`);

    if (!slot) {
      cardEl.style.visibility = "hidden";
      return;
    }
    cardEl.style.visibility = "visible";
    metaEl.innerHTML     = `<span class="time-badge">${slot.start} – ${slot.end}</span>`;
    couriersEl.innerHTML = slot.pickups.map(p => courierCard(p.name)).join("");
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  try {
    const res = await fetch("data/pickups.json?v=5");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    pickupData = await res.json();
  } catch (err) {
    console.warn("pickups.json load failed:", err);
    pickupData = [];
  }

  await fetchCounts();
  setInterval(fetchCounts, COUNTS_REFRESH_MS);
  update();
  setInterval(update, 100);
}

document.addEventListener("DOMContentLoaded", init);

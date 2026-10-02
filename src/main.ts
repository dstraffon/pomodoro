import './style.css';
import * as T from './timer';
import type { Mode, TimerState } from './timer';
import { createShader, hex, type Palette } from './shader';
import * as audio from './audio';
import { heatmap, lastWeek, sessionsOn, streak } from './stats';
import { DEFAULT_SETTINGS, load, save, uid, type Settings, type Sound } from './store';

/* ───────── State ───────── */

const data = load();
const s = data.settings;
let timer: TimerState = data.timer ?? T.createTimer(s);
let zen = false;

const persist = () => {
  data.timer = timer;
  save(data);
};

const $ = <E extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<E>(sel)!;
const $$ = <E extends HTMLElement = HTMLElement>(sel: string) => [...document.querySelectorAll<E>(sel)];
const root = document.documentElement;

const MODE_LABEL: Record<Mode, string> = { focus: 'Focus', short: 'Short break', long: 'Long break' };

/* ───────── Shader backdrop ───────── */

const PALETTES: Record<Mode, Palette> = {
  focus: { base: hex('#0b0507'), a: hex('#ff4d2e'), b: hex('#ff2d75'), c: hex('#ffb347') },
  short: { base: hex('#03090c'), a: hex('#14b8a6'), b: hex('#2563eb'), c: hex('#9dffcf') },
  long: { base: hex('#06041a'), a: hex('#7c3aed'), b: hex('#db2777'), c: hex('#60a5fa') },
};

const shader = createShader($<HTMLCanvasElement>('#bg'), PALETTES[timer.mode]);

/* ───────── Dial ───────── */

const R = 84;
const C = 2 * Math.PI * R;
const ringArc = $('#ringArc');
const ringGlowArc = $('#ringGlowArc');
const ringHead = $('#ringHead');
const ticksG = $('#ticks');
const TICKS = 60;
const tickEls: SVGLineElement[] = [];

for (let i = 0; i < TICKS; i++) {
  const a = (i / TICKS) * Math.PI * 2;
  const major = i % 5 === 0;
  const r1 = 93;
  const r2 = major ? 99 : 97;
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', String(100 + r1 * Math.cos(a)));
  line.setAttribute('y1', String(100 + r1 * Math.sin(a)));
  line.setAttribute('x2', String(100 + r2 * Math.cos(a)));
  line.setAttribute('y2', String(100 + r2 * Math.sin(a)));
  if (major) line.classList.add('major');
  ticksG.append(line);
  tickEls.push(line);
}
for (const el of [ringArc, ringGlowArc]) el.style.strokeDasharray = `${C}`;

let litTicks = -1;
function renderRing(p: number) {
  const off = C * (1 - p);
  ringArc.style.strokeDashoffset = `${off}`;
  ringGlowArc.style.strokeDashoffset = `${off}`;
  const a = p * Math.PI * 2;
  ringHead.setAttribute('cx', String(100 + R * Math.cos(a)));
  ringHead.setAttribute('cy', String(100 + R * Math.sin(a)));
  ringHead.style.opacity = p > 0.002 ? '1' : '0';
  const lit = Math.floor(p * TICKS);
  if (lit !== litTicks) {
    litTicks = lit;
    tickEls.forEach((t, i) => t.classList.toggle('lit', i < lit));
  }
}

/* Rolling digits: each character animates independently when it changes. */
const timeEl = $('#time');
let shownTime = '';
function renderTime(str: string) {
  if (str === shownTime) return;
  if (shownTime.length !== str.length) {
    timeEl.innerHTML = '';
    for (const ch of str) {
      const slot = document.createElement('span');
      slot.className = ch === ':' ? 'digit colon' : 'digit';
      slot.innerHTML = `<span>${ch}</span>`;
      timeEl.append(slot);
    }
  } else {
    [...str].forEach((ch, i) => {
      if (ch === shownTime[i]) return;
      const slot = timeEl.children[i] as HTMLElement;
      slot.querySelectorAll('.out').forEach((n) => n.remove());
      const old = slot.lastElementChild as HTMLElement | null;
      old?.classList.remove('in');
      old?.classList.add('out');
      old?.addEventListener('animationend', () => old.remove(), { once: true });
      const next = document.createElement('span');
      next.className = 'in';
      next.textContent = ch;
      slot.append(next);
    });
  }
  timeEl.setAttribute('aria-label', str);
  shownTime = str;
}

/* Dynamic favicon showing progress in the browser tab. */
const favicon = $<HTMLLinkElement>('#favicon');
const favCanvas = document.createElement('canvas');
favCanvas.width = favCanvas.height = 64;
let lastFav = -1;
function renderFavicon(p: number) {
  const bucket = timer.status === 'idle' ? -1 : Math.round(p * 48);
  if (bucket === lastFav) return;
  lastFav = bucket;
  if (bucket === -1) {
    favicon.href = './icon.svg';
    return;
  }
  const c = favCanvas.getContext('2d')!;
  const accent = getComputedStyle(root).getPropertyValue('--accent').trim() || '#ff5a36';
  c.clearRect(0, 0, 64, 64);
  c.lineCap = 'round';
  c.lineWidth = 9;
  c.strokeStyle = 'rgba(255,255,255,0.18)';
  c.beginPath();
  c.arc(32, 32, 24, 0, Math.PI * 2);
  c.stroke();
  c.strokeStyle = accent;
  c.beginPath();
  c.arc(32, 32, 24, -Math.PI / 2, -Math.PI / 2 + Math.max(0.05, p) * Math.PI * 2);
  c.stroke();
  favicon.href = favCanvas.toDataURL('image/png');
}

/* ───────── Render ───────── */

const app = $('#app');
const tabs = $$<HTMLButtonElement>('.modes [role=tab]');
const indicator = $('.modes-indicator');

function placeIndicator() {
  const active = tabs.find((t) => t.dataset.mode === timer.mode)!;
  indicator.style.width = `${active.offsetWidth}px`;
  indicator.style.transform = `translateX(${active.offsetLeft}px)`;
}

function renderMode() {
  root.dataset.mode = timer.mode;
  tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.mode === timer.mode)));
  placeIndicator();
  $('#label').textContent = MODE_LABEL[timer.mode];
  shader?.setPalette(PALETTES[timer.mode]);
  $<HTMLMetaElement>('meta[name=theme-color]').content =
    timer.mode === 'focus' ? '#0b0608' : timer.mode === 'short' ? '#04090c' : '#07051a';
  renderCycle();
  renderSub();
}

function renderCycle() {
  const n = Math.max(1, s.longEvery);
  const done = timer.mode === 'long' ? n : timer.cycleCount % n;
  $('#cycle').innerHTML = Array.from({ length: n }, (_, i) => `<i class="${i < done ? 'on' : ''}"></i>`).join('');
  $('#cycle').setAttribute('aria-label', `${done} of ${n} focus sessions before a long break`);
}

let breathTimer = 0;
function renderSub() {
  const sub = $('#sub');
  const breathing = timer.mode !== 'focus' && timer.status === 'running';
  app.classList.toggle('breathing', breathing);
  clearInterval(breathTimer);
  if (breathing) {
    // Matches the 14s CSS breathe cycle: 4s in, 4s hold, 6s out.
    const start = performance.now();
    const phase = () => {
      const t = ((performance.now() - start) / 1000) % 14;
      sub.textContent = t < 4 ? 'Breathe in' : t < 8 ? 'Hold' : 'Breathe out';
    };
    phase();
    breathTimer = window.setInterval(phase, 250);
    return;
  }
  if (timer.mode === 'focus') {
    const n = Math.max(1, s.longEvery);
    sub.textContent = `Session ${(timer.cycleCount % n) + 1} of ${n}`;
  } else {
    sub.textContent = timer.status === 'paused' ? 'Paused' : 'Step away from the screen';
  }
  if (timer.status === 'paused') sub.textContent = 'Paused';
}

function renderStatus() {
  const running = timer.status === 'running';
  app.classList.toggle('running', running);
  $('#play').setAttribute('aria-label', running ? 'Pause (Space)' : 'Start (Space)');
  shader?.setEnergy(running ? 1 : 0.6);
  audio.setAmbient(s.sound, running);
  renderSub();
  void wakeLock(running);
}

function renderGoal() {
  const today = sessionsOn(data.sessions, Date.now()).length;
  const p = Math.min(1, today / Math.max(1, s.dailyGoal));
  $('#goalArc').style.strokeDashoffset = String(94.25 * (1 - p));
  $('#goalNum').textContent = String(today);
  $('#goal').classList.toggle('met', p >= 1);
  $('#goal').title = `${today} of ${s.dailyGoal} sessions today`;
}

function frame() {
  const now = Date.now();
  if (T.isDone(timer, now)) complete();
  const rem = T.remaining(timer, now);
  const p = T.progress(timer, now);
  const str = T.format(rem);
  renderTime(str);
  renderRing(p);
  shader?.setGlow(p);
  renderFavicon(p);
  const title = timer.status === 'idle' ? 'Ember · Focus timer' : `${str} · ${MODE_LABEL[timer.mode]}`;
  if (document.title !== title) document.title = title;
}

let lastSecond = -1;
function loop() {
  frame();
  if (s.tick && timer.status === 'running') {
    const sec = Math.ceil(T.remaining(timer, Date.now()) / 1000);
    if (sec !== lastSecond) {
      if (lastSecond !== -1) audio.tick();
      lastSecond = sec;
    }
  }
  requestAnimationFrame(loop);
}
// rAF pauses in background tabs; this keeps completion + tab title honest.
setInterval(() => document.hidden && frame(), 1000);

/* ───────── Actions ───────── */

function setTimer(next: TimerState) {
  const modeChanged = next.mode !== timer.mode;
  timer = next;
  if (modeChanged) renderMode();
  renderStatus();
  renderCycle();
  frame();
  persist();
}

function toggle() {
  audio.unlock();
  setTimer(T.toggle(timer, Date.now()));
}

function reset() {
  setTimer(T.reset(timer, s));
}

function skip() {
  setTimer(T.advance(timer, s, false));
}

function changeMode(mode: Mode) {
  if (mode === timer.mode) return;
  setTimer(T.switchMode(timer, mode, s));
}

function complete(silent = false) {
  const finished = timer;
  if (finished.mode === 'focus') {
    const minutes = Math.round(finished.durationMs / 60000);
    data.sessions.push({ at: Date.now(), minutes, taskId: data.activeTaskId ?? undefined });
    const task = data.tasks.find((t) => t.id === data.activeTaskId);
    if (task) task.done += 1;
  }
  let next = T.advance(finished, s, true);
  const auto = next.mode === 'focus' ? s.autoStartFocus : s.autoStartBreaks;
  if (auto && !silent) next = T.start(next, Date.now());
  setTimer(next);
  renderGoal();
  renderTasks();
  renderChip();
  if (silent) return;

  const toBreak = finished.mode === 'focus';
  if (s.chime) audio.chime(toBreak ? 'break' : 'focus');
  navigator.vibrate?.(toBreak ? [80, 60, 80] : [120]);
  const pulse = $('#pulse');
  pulse.classList.remove('go');
  void pulse.offsetWidth;
  pulse.classList.add('go');

  const today = sessionsOn(data.sessions, Date.now()).length;
  let msg: string;
  if (toBreak && today === s.dailyGoal) msg = `<strong>Daily goal reached.</strong> ${today} sessions today. Beautiful work.`;
  else if (toBreak) msg = `<strong>Session complete.</strong> Time for a ${next.mode === 'long' ? 'long' : 'short'} break.`;
  else msg = `<strong>Break's over.</strong> Ready when you are.`;
  toast(msg);
  notify(toBreak ? 'Focus session complete' : 'Break is over', toBreak ? 'Take a breather.' : 'Time to focus.');
}

let toastTimer = 0;
function toast(html: string) {
  const el = $('#toast');
  el.innerHTML = html;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 4200);
}

async function notify(title: string, body: string) {
  if (!s.notify || !('Notification' in window) || Notification.permission !== 'granted' || !document.hidden) return;
  const opts = { body, icon: './icon-192.png', badge: './icon-192.png', tag: 'ember' };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(title, opts);
    else new Notification(title, opts);
  } catch {
    /* notifications are best-effort */
  }
}

let lock: WakeLockSentinel | null = null;
async function wakeLock(on: boolean) {
  try {
    if (on && !lock && 'wakeLock' in navigator && !document.hidden) {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => (lock = null));
    } else if (!on && lock) {
      await lock.release();
      lock = null;
    }
  } catch {
    lock = null;
  }
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    void wakeLock(timer.status === 'running');
    frame();
  }
});

/* ───────── Controls ───────── */

$('#play').addEventListener('click', toggle);
$('#reset').addEventListener('click', reset);
$('#skip').addEventListener('click', skip);
tabs.forEach((t) => t.addEventListener('click', () => changeMode(t.dataset.mode as Mode)));
addEventListener('resize', placeIndicator);
document.fonts?.ready.then(placeIndicator);

function setZen(on: boolean) {
  zen = on;
  app.classList.toggle('zen', on);
  if (on) closeSheet();
}
$('#zen').addEventListener('click', () => setZen(!zen));

addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement;
  const key = e.key.toLowerCase();
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (target.closest('input, textarea')) {
    if (key === 'escape') {
      target.blur();
      closeSheet();
    }
    return;
  }
  const map: Record<string, () => void> = {
    ' ': toggle,
    r: reset,
    s: skip,
    '1': () => changeMode('focus'),
    '2': () => changeMode('short'),
    '3': () => changeMode('long'),
    z: () => setZen(!zen),
    t: () => openSheet('tasks'),
    i: () => openSheet('stats'),
    m: () => openSheet('sounds'),
    ',': () => openSheet('settings'),
    escape: () => (sheetOpen ? closeSheet() : setZen(false)),
  };
  const fn = map[key];
  if (!fn) return;
  // Let Space/Enter activate a focused button normally.
  if (key === ' ' && target.closest('button')) return;
  e.preventDefault();
  fn();
});

/* ───────── Sheet ───────── */

type Panel = 'tasks' | 'stats' | 'sounds' | 'settings';
const PANEL_TITLE: Record<Panel, string> = { tasks: 'Tasks', stats: 'Your rhythm', sounds: 'Soundscape', settings: 'Settings' };
const sheet = $('#sheet');
let sheetOpen: Panel | null = null;
let lastFocus: HTMLElement | null = null;

function openSheet(panel: Panel) {
  if (sheetOpen === panel) return closeSheet();
  if (!sheetOpen) lastFocus = document.activeElement as HTMLElement;
  sheetOpen = panel;
  setZen(false);
  document.body.classList.add('sheet-open');
  sheet.setAttribute('aria-hidden', 'false');
  sheet.style.transform = '';
  $('#sheetTitle').textContent = PANEL_TITLE[panel];
  $$('.panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === panel));
  $$('.dock-btn').forEach((b) => b.classList.toggle('active', b.dataset.panel === panel));
  if (panel === 'stats') renderStats();
  if (panel === 'tasks') renderTasks();
  requestAnimationFrame(() => {
    const first = sheet.querySelector<HTMLElement>(`.panel.active input, .panel.active button`);
    (panel === 'tasks' && matchMedia('(pointer: fine)').matches ? $('#taskInput') : first ?? $('#sheetClose')).focus({
      preventScroll: true,
    });
  });
}

function closeSheet() {
  if (!sheetOpen) return;
  sheetOpen = null;
  document.body.classList.remove('sheet-open');
  sheet.setAttribute('aria-hidden', 'true');
  $$('.dock-btn').forEach((b) => b.classList.remove('active'));
  lastFocus?.focus({ preventScroll: true });
}

$$('.dock-btn').forEach((b) => b.addEventListener('click', () => openSheet(b.dataset.panel as Panel)));
$('#sheetClose').addEventListener('click', closeSheet);
$('#scrim').addEventListener('click', closeSheet);
$('#taskChip').addEventListener('click', () => openSheet('tasks'));

// Drag the handle down to dismiss the bottom sheet on touch screens.
{
  const handle = $('#sheetHandle');
  let startY = 0;
  let dy = 0;
  handle.addEventListener('pointerdown', (e) => {
    startY = e.clientY;
    dy = 0;
    handle.setPointerCapture(e.pointerId);
    sheet.style.transition = 'none';
  });
  handle.addEventListener('pointermove', (e) => {
    if (!handle.hasPointerCapture(e.pointerId)) return;
    dy = Math.max(0, e.clientY - startY);
    sheet.style.transform = `translateY(${dy}px)`;
  });
  const end = () => {
    sheet.style.transition = '';
    if (dy > 90) closeSheet();
    sheet.style.transform = '';
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

/* ───────── Tasks ───────── */

let estimate = 1;
const CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const CROSS = '<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7 7 17"/></svg>';

const esc = (str: string) =>
  str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function renderTasks() {
  const list = $('#taskList');
  if (data.tasks.length === 0) {
    list.innerHTML = `<li class="empty"><strong>A clear runway.</strong>Add what you want to get done, then pick one to focus on.</li>`;
  } else {
    list.innerHTML = data.tasks
      .map((t) => {
        const count = Math.max(t.estimate, t.done);
        const pips =
          count <= 8 ? Array.from({ length: count }, (_, i) => `<i class="${i < t.done ? 'on' : ''}"></i>`).join('') : `${t.done}/${t.estimate}`;
        const cls = ['task', t.id === data.activeTaskId ? 'active' : '', t.completed ? 'completed' : ''].join(' ');
        return `<li class="${cls}" data-id="${t.id}" tabindex="0" aria-label="${esc(t.title)}, ${t.done} of ${t.estimate} sessions${t.id === data.activeTaskId ? ', current' : ''}">
          <button class="check" data-act="check" aria-label="${t.completed ? 'Mark incomplete' : 'Mark complete'}">${CHECK}</button>
          <span class="task-title">${esc(t.title)}</span>
          <span class="pips" aria-hidden="true">${pips}</span>
          <button class="icon-btn task-del" data-act="del" aria-label="Delete task">${CROSS}</button>
        </li>`;
      })
      .join('');
  }
  const open = data.tasks.filter((t) => !t.completed);
  const remainingSessions = open.reduce((n, t) => n + Math.max(0, t.estimate - t.done), 0);
  const finishAt = new Date(Date.now() + remainingSessions * (s.focusMin + s.shortMin) * 60000);
  $('#tasksSummary').textContent = remainingSessions
    ? `${remainingSessions} session${remainingSessions === 1 ? '' : 's'} left · done around ${finishAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
    : data.tasks.length
      ? 'All caught up'
      : '';
  $('#tasksFoot').style.display = data.tasks.length ? '' : 'none';
}

function renderChip() {
  const task = data.tasks.find((t) => t.id === data.activeTaskId);
  $('#taskChip').classList.toggle('has-task', !!task);
  $('#taskChipText').textContent = task ? task.title : 'What are you focusing on?';
}

function commitTasks() {
  renderTasks();
  renderChip();
  persist();
}

$('#taskForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $<HTMLInputElement>('#taskInput');
  const title = input.value.trim();
  if (!title) return;
  const task = { id: uid(), title, estimate, done: 0, completed: false };
  data.tasks.unshift(task);
  if (!data.activeTaskId) data.activeTaskId = task.id;
  input.value = '';
  estimate = 1;
  $('#taskEst').textContent = '1';
  commitTasks();
});

$$('.stepper button').forEach((b) =>
  b.addEventListener('click', () => {
    estimate = Math.min(12, Math.max(1, estimate + Number(b.dataset.step)));
    $('#taskEst').textContent = String(estimate);
  }),
);

$('#taskList').addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const li = target.closest<HTMLElement>('.task');
  if (!li) return;
  const task = data.tasks.find((t) => t.id === li.dataset.id)!;
  const act = target.closest<HTMLElement>('[data-act]')?.dataset.act;
  if (act === 'del') {
    data.tasks = data.tasks.filter((t) => t !== task);
    if (data.activeTaskId === task.id) data.activeTaskId = data.tasks.find((t) => !t.completed)?.id ?? null;
  } else if (act === 'check') {
    task.completed = !task.completed;
    if (task.completed && data.activeTaskId === task.id) data.activeTaskId = data.tasks.find((t) => !t.completed)?.id ?? null;
  } else {
    data.activeTaskId = data.activeTaskId === task.id ? null : task.id;
  }
  commitTasks();
});
$('#taskList').addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && (e.target as HTMLElement).classList.contains('task')) {
    e.preventDefault();
    (e.target as HTMLElement).click();
  }
});

$('#clearDone').addEventListener('click', () => {
  data.tasks = data.tasks.filter((t) => !t.completed);
  commitTasks();
});

/* ───────── Stats ───────── */

const tooltip = $('#tooltip');
function showTip(el: HTMLElement, html: string) {
  const r = el.getBoundingClientRect();
  tooltip.innerHTML = html;
  tooltip.style.left = `${r.left + r.width / 2}px`;
  tooltip.style.top = `${r.top}px`;
  tooltip.classList.add('show');
}
const hideTip = () => tooltip.classList.remove('show');

function renderStats() {
  const now = Date.now();
  const today = sessionsOn(data.sessions, now);
  const todayMin = today.reduce((n, x) => n + x.minutes, 0);
  $('#statToday').textContent = String(today.length);
  $('#statTodaySub').textContent = `sessions, ${todayMin}m`;
  $('#statStreak').textContent = String(streak(data.sessions, now));
  const totalMin = data.sessions.reduce((n, x) => n + x.minutes, 0);
  $('#statTotal').textContent = totalMin < 600 ? (totalMin / 60).toFixed(1) : String(Math.round(totalMin / 60));

  const week = lastWeek(data.sessions, now);
  const max = Math.max(60, ...week.map((d) => d.minutes));
  $('#bars').innerHTML = week
    .map((d, i) => {
      const date = new Date(d.key + 'T00:00');
      const label = date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
      return `<div class="bar ${i === 6 ? 'today' : ''}" data-tip="<b>${d.minutes} min</b> · ${label}" tabindex="0" aria-label="${label}: ${d.minutes} minutes">
        <div class="bar-col"><div class="bar-fill ${d.minutes ? '' : 'zero'}" style="height:${(d.minutes / max) * 100}%;animation-delay:${i * 40}ms"></div></div>
        <span>${d.label}</span></div>`;
    })
    .join('');

  const todayKey = week[6].key;
  $('#heat').innerHTML = heatmap(data.sessions, now, 12)
    .flat()
    .map((c) => {
      const label = new Date(c.key + 'T00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const tip = c.future ? '' : `data-tip="<b>${c.minutes} min</b> · ${label}"`;
      return `<i data-l="${c.level}" class="${c.future ? 'future' : ''} ${c.key === todayKey ? 'today' : ''}" ${tip}></i>`;
    })
    .join('');
}

for (const sel of ['#bars', '#heat']) {
  const host = $(sel);
  host.addEventListener('pointerover', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
    if (el) showTip(el, el.dataset.tip!);
  });
  host.addEventListener('pointerleave', hideTip);
  host.addEventListener('focusin', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
    if (el) showTip(el, el.dataset.tip!);
  });
  host.addEventListener('focusout', hideTip);
}
$('#sheet').addEventListener('scroll', hideTip, true);

/* ───────── Sounds ───────── */

const SOUNDS: { id: Sound; name: string; icon: string }[] = [
  { id: 'off', name: 'Silence', icon: '<path d="M11 5 6 9H2v6h4l5 4zM23 9l-6 6M17 9l6 6"/>' },
  { id: 'rain', name: 'Rain', icon: '<path d="M20 15.5A4.5 4.5 0 0 0 17.5 7a6 6 0 0 0-11.4 2A4 4 0 0 0 6 17"/><path d="M9 14l-1 3M13 14l-1 3M11 19l-1 3M15 19l-1 3"/>' },
  { id: 'brown', name: 'Brown noise', icon: '<path d="M2 12c2-4 4 4 6 0s4 4 6 0 4 4 6 0 2 2 2 2"/>' },
  { id: 'waves', name: 'Ocean', icon: '<path d="M2 8c2.5-2 4.5-2 7 0s4.5 2 7 0 4.5-2 6 0M2 14c2.5-2 4.5-2 7 0s4.5 2 7 0 4.5-2 6 0M2 20c2.5-2 4.5-2 7 0s4.5 2 7 0 4.5-2 6 0"/>' },
  { id: 'drone', name: 'Drone', icon: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7" opacity=".6"/><circle cx="12" cy="12" r="10.5" opacity=".3"/>' },
];

function renderSounds() {
  $('#sounds').innerHTML = SOUNDS.map(
    (x) => `<button class="sound" data-sound="${x.id}" aria-pressed="${s.sound === x.id}"><svg viewBox="0 0 24 24">${x.icon}</svg>${x.name}</button>`,
  ).join('');
}
$('#sounds').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-sound]');
  if (!b) return;
  audio.unlock();
  s.sound = b.dataset.sound as Sound;
  renderSounds();
  // Preview the sound briefly even when the timer isn't running.
  audio.setAmbient(s.sound, true);
  if (timer.status !== 'running') {
    clearTimeout(previewTimer);
    previewTimer = window.setTimeout(() => audio.setAmbient(s.sound, timer.status === 'running'), 4000);
  }
  persist();
});
let previewTimer = 0;

/* ───────── Settings ───────── */

function paintRange(input: HTMLInputElement) {
  const p = (Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min));
  input.style.setProperty('--fill', `${p * 100}%`);
  const out = document.querySelector<HTMLOutputElement>(`output[data-for="${input.id}"]`);
  if (!out) return;
  const v = Number(input.value);
  out.textContent =
    input.id === 'longEvery' ? `${v} sessions` : input.id === 'dailyGoal' ? `${v} sessions` : `${v} min`;
}

const NUMERIC: (keyof Settings)[] = ['focusMin', 'shortMin', 'longMin', 'longEvery', 'dailyGoal', 'volume'];
const BOOLEAN: (keyof Settings)[] = ['autoStartBreaks', 'autoStartFocus', 'notify', 'chime'];

function bindSettings() {
  for (const key of NUMERIC) {
    const input = $<HTMLInputElement>(`#${key}`);
    input.value = String(s[key]);
    paintRange(input);
    input.addEventListener('input', () => {
      (s[key] as number) = Number(input.value);
      paintRange(input);
      if (key === 'volume') audio.setVolume(s.volume);
      // Apply new durations right away if the current session hasn't started.
      if (key.endsWith('Min') && timer.status === 'idle') setTimer(T.reset(timer, s));
      if (key === 'longEvery') renderMode();
      if (key === 'dailyGoal') renderGoal();
      persist();
    });
  }
  for (const key of BOOLEAN) {
    const input = $<HTMLInputElement>(`#${key}`);
    input.checked = Boolean(s[key]);
    input.addEventListener('change', async () => {
      (s[key] as boolean) = input.checked;
      if (key === 'notify' && input.checked && 'Notification' in window && Notification.permission !== 'granted') {
        const res = await Notification.requestPermission();
        if (res !== 'granted') {
          input.checked = s.notify = false;
          toast('Notifications are blocked in your browser settings.');
        }
      }
      persist();
    });
  }
  const tickInput = $<HTMLInputElement>('#tickSound');
  tickInput.checked = s.tick;
  tickInput.addEventListener('change', () => {
    s.tick = tickInput.checked;
    persist();
  });
}

$('#wipe').addEventListener('click', () => {
  if (!confirm('Delete all tasks, history and settings? This cannot be undone.')) return;
  Object.assign(s, DEFAULT_SETTINGS);
  data.tasks = [];
  data.sessions = [];
  data.activeTaskId = null;
  timer = T.createTimer(s);
  persist();
  location.reload();
});

/* ───────── Boot ───────── */

// If the page was closed while running, settle what happened in the meantime.
if (T.isDone(timer, Date.now())) complete(true);

audio.setVolume(s.volume);
bindSettings();
renderSounds();
renderMode();
renderStatus();
renderGoal();
renderTasks();
renderChip();
requestAnimationFrame(loop);

if (!shader) document.body.classList.add('no-webgl');

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

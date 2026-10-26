'use strict';
const $ = s => document.querySelector(s);
const app = $('#app');
const uid = () => Math.random().toString(36).slice(2, 9);
const clone = o => JSON.parse(JSON.stringify(o));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = sec => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

const COMMON = ['Press banca', 'Press inclinado con mancuernas', 'Aperturas', 'Fondos', 'Press militar',
  'Elevaciones laterales', 'Pájaros', 'Dominadas', 'Jalón al pecho', 'Remo con barra', 'Remo con mancuerna',
  'Curl con barra', 'Curl martillo', 'Press francés', 'Extensión de tríceps en polea', 'Sentadilla', 'Prensa',
  'Peso muerto', 'Peso muerto rumano', 'Zancadas', 'Extensión de cuádriceps', 'Curl femoral', 'Gemelos',
  'Plancha', 'Abdominales'];

// ---------- Almacenamiento (localStorage) ----------
const load = (k, d) => { try { return JSON.parse(localStorage.getItem('gym.' + k)) ?? d; } catch { return d; } };
const store = (k, v) => v == null ? localStorage.removeItem('gym.' + k) : localStorage.setItem('gym.' + k, JSON.stringify(v));

// rests[k] = segundos de descanso después de la serie k (el último es "tras la última serie"; 0 = sin descanso)
const newEx = (name = '') => ({ id: uid(), name, sets: 3, rests: [90, 90, 120], reps: '', weight: '' });

let routines = load('routines', null) || [{
  id: uid(), name: 'Pecho y hombros (ejemplo)', exercises: [
    { ...newEx('Press banca'), sets: 4, rests: [90, 120, 180, 120], reps: '8-10' },
    { ...newEx('Press militar') },
    { ...newEx('Elevaciones laterales'), rests: [60, 60, 0] },
  ],
}];
let history = load('history', []);
let S = load('session', null); // entrenamiento en curso
let editing = null;            // rutina abierta en el editor

const saveRoutines = () => store('routines', routines);
const saveSession = () => store('session', S);
saveRoutines();
navigator.storage?.persist?.();

// ---------- Alertas: sonido, vibración, notificación, pantalla encendida ----------
let actx, wakeLock;
function unlockAudio() {
  try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); actx.resume(); } catch { }
}
function beep() {
  if (!actx) return;
  const t = actx.currentTime;
  [0, 0.3, 0.6, 1.2, 1.5, 1.8].forEach((d, k) => {
    const o = actx.createOscillator(), g = actx.createGain();
    o.frequency.value = k % 3 === 2 ? 1320 : 880;
    g.gain.setValueAtTime(0.0001, t + d);
    g.gain.exponentialRampToValueAtTime(0.6, t + d + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.22);
    o.connect(g).connect(actx.destination);
    o.start(t + d); o.stop(t + d + 0.25);
  });
}
function alarm() {
  beep();
  navigator.vibrate?.([400, 150, 400, 150, 700]);
  if (document.hidden && window.Notification?.permission === 'granted') {
    const e = S?.ex[S.i];
    navigator.serviceWorker?.ready.then(r => r.showNotification('Descanso terminado', {
      body: e ? `${e.name} — Serie ${S.s + 1} de ${e.sets}` : '', tag: 'rest', renotify: true, vibrate: [400, 150, 400],
    }));
  }
}
function askNotify() {
  try { if (window.Notification?.permission === 'default') Notification.requestPermission(); } catch { }
}
async function keepAwake(on) {
  try {
    if (on && !wakeLock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { }
}

// ---------- Router ----------
function render() {
  const [, view = '', id] = location.hash.split('/');
  if (view === 'edit' && routines.some(r => r.id === id)) renderEdit(id);
  else if (view === 'workout' && S) renderWorkout();
  else if (view === 'history') renderHistory();
  else renderHome();
  keepAwake(!!S);
}

// ---------- Pantalla: inicio ----------
function renderHome() {
  editing = null;
  const banner = S ? `<a class="banner" href="#/workout">
      <div><small>Entrenamiento en curso</small><b>${esc(S.name)}</b></div>
      <span id="mini">${S.rest ? fmt(restLeft()) : 'Continuar →'}</span></a>` : '';
  app.innerHTML = `
    <header class="bar"><h1 class="grow">Rutinas</h1><a class="btn ghost" href="#/history">Historial</a></header>
    <main class="pad">
      ${banner}
      ${routines.map(r => `<div class="card">
        <div><h2>${esc(r.name || 'Sin nombre')}</h2>
        <small>${r.exercises.length} ejercicios · ${r.exercises.reduce((a, e) => a + e.sets, 0)} series</small></div>
        <div class="row"><a class="btn ghost grow" href="#/edit/${r.id}">Editar</a>
        <button class="btn primary grow" data-a="start" data-id="${r.id}">Iniciar</button></div>
      </div>`).join('')}
      <button class="btn ghost wide" data-a="newRoutine">+ Nueva rutina</button>
    </main>`;
}

// ---------- Pantalla: editor de rutina (autoguardado) ----------
function renderEdit(id) {
  editing = routines.find(r => r.id === id);
  const used = routines.flatMap(r => r.exercises.map(e => e.name.trim())).filter(Boolean);
  const names = [...new Set([...COMMON, ...used])].sort((a, b) => a.localeCompare(b));
  app.innerHTML = `
    <header class="bar"><a class="btn ghost" href="#/">← Listo</a><span class="grow"></span>
      <button class="btn ghost danger" data-a="delRoutine">Eliminar rutina</button></header>
    <main class="pad">
      <input class="title" data-f="rname" placeholder="Nombre de la rutina" value="${esc(editing.name)}">
      ${editing.exercises.map((e, i) => exCard(e, i, editing.exercises.length)).join('')}
      <button class="btn ghost wide" data-a="addEx">+ Agregar ejercicio</button>
      <p class="hint">Los cambios se guardan solos. Descansos en segundos; 0 = sin descanso.</p>
    </main>
    <datalist id="exnames">${names.map(n => `<option value="${esc(n)}">`).join('')}</datalist>`;
}
function exCard(e, i, n) {
  return `<div class="card" data-i="${i}">
    <div class="row"><span class="idx">${i + 1}</span>
      <input class="grow" list="exnames" data-f="name" placeholder="Nombre del ejercicio" value="${esc(e.name)}"></div>
    <div class="row"><span class="lbl">Series</span>
      <div class="stepper"><button class="btn" data-a="sets" data-d="-1">−</button><b>${e.sets}</b>
      <button class="btn" data-a="sets" data-d="1">+</button></div></div>
    <div class="row">
      <label class="fld">Reps (opcional)<input data-f="reps" value="${esc(e.reps)}" placeholder="8-10"></label>
      <label class="fld">Peso kg (opcional)<input data-f="weight" inputmode="decimal" value="${esc(e.weight)}" placeholder="—"></label>
    </div>
    <span class="lbl">Descanso después de cada serie (seg)</span>
    <div class="rests">${e.rests.map((r, k) => `<label class="fld">${k === e.sets - 1 ? 'Tras la última' : 'Tras serie ' + (k + 1)}
      <input type="number" inputmode="numeric" min="0" step="5" data-r="${k}" value="${r}"></label>`).join('')}</div>
    <div class="row end">
      <button class="btn ghost" data-a="move" data-d="-1" ${i ? '' : 'disabled'} aria-label="Subir">↑</button>
      <button class="btn ghost" data-a="move" data-d="1" ${i < n - 1 ? '' : 'disabled'} aria-label="Bajar">↓</button>
      <button class="btn ghost danger" data-a="delEx">Quitar</button>
    </div>
  </div>`;
}
const exIndex = el => +el.closest('[data-i]').dataset.i;

app.addEventListener('input', ev => {
  const el = ev.target, d = el.dataset;
  if (!editing) return;
  if (d.f === 'rname') editing.name = el.value;
  else if (d.f) editing.exercises[exIndex(el)][d.f] = el.value;
  else if (d.r) editing.exercises[exIndex(el)].rests[+d.r] = Math.max(0, parseInt(el.value) || 0);
  else return;
  saveRoutines();
});

// ---------- Pantalla: entrenamiento ----------
function restLeft() {
  const r = S.rest;
  return Math.max(0, Math.ceil((r.paused ?? r.endsAt - Date.now()) / 1000));
}
function startWorkout(id) {
  const r = routines.find(r => r.id === id);
  if (!r.exercises.length) return alert('Agregá al menos un ejercicio a la rutina.');
  if (S && !confirm('Hay un entrenamiento en curso. ¿Descartarlo y empezar este?')) return;
  S = { name: r.name || 'Entrenamiento', start: Date.now(), ex: clone(r.exercises), i: 0, s: 0,
    done: r.exercises.map(() => 0), rest: null, go: false, end: false };
  saveSession();
  askNotify();
  location.hash = '#/workout';
}
function endRest(withAlarm) {
  S.rest = null;
  S.go = withAlarm;
  saveSession();
  if (withAlarm) alarm();
  if (!location.hash.startsWith('#/edit')) render();
}
function saveWorkout() {
  const any = S.done.some(Boolean);
  if (any) {
    history.unshift({ name: S.name, start: S.start, end: Date.now(),
      ex: S.ex.map((e, i) => ({ name: e.name || `Ejercicio ${i + 1}`, done: S.done[i], sets: e.sets })) });
    store('history', history);
  }
  S = null;
  saveSession();
  location.hash = any ? '#/history' : '#/';
}

function renderWorkout() {
  editing = null;
  const total = S.ex.reduce((a, e) => a + e.sets, 0), done = S.done.reduce((a, b) => a + b, 0);
  const head = `<header class="bar"><a class="btn ghost" href="#/" aria-label="Inicio">←</a>
      <div class="grow center"><b>${esc(S.name)}</b><small>${done} de ${total} series</small></div>
      <button class="btn ghost" data-a="finish">Finalizar</button></header>
    <div class="progress"><i style="width:${done / total * 100}%"></i></div>`;

  if (S.end) {
    app.innerHTML = head + `<main class="workout">
      <div class="state">COMPLETADO</div>
      <h2 class="exname">¡Entrenamiento terminado!</h2>
      <p class="sub">${done} series en ${Math.round((Date.now() - S.start) / 60000)} min</p>
      <div class="grow"></div>
      <button class="btn huge primary" data-a="save">Guardar entrenamiento</button>
      <button class="btn small" data-a="undo">Deshacer última serie</button></main>`;
    return;
  }

  const e = S.ex[S.i], next = S.ex[S.i + 1];
  const name = esc(e.name || `Ejercicio ${S.i + 1}`);
  if (S.rest) {
    const paused = S.rest.paused != null;
    app.innerHTML = head + `<main class="workout rest">
      <div class="state">${paused ? 'PAUSADO' : 'DESCANSO'}</div>
      <div class="timer" id="timer">${fmt(restLeft())}</div>
      <div class="restbar"><i id="restbar"></i></div>
      <p class="sub center">${S.s === 0 ? 'Próximo ejercicio' : 'Siguiente'}:<br><b>${name}</b> — Serie ${S.s + 1} de ${e.sets}</p>
      <div class="grow"></div>
      <div class="ctrls">
        <button class="btn" data-a="add" data-d="-15">−15</button>
        <button class="btn" data-a="pause">${paused ? '▶ Seguir' : '❚❚ Pausa'}</button>
        <button class="btn" data-a="add" data-d="15">+15</button>
        <button class="btn" data-a="add" data-d="30">+30</button>
      </div>
      <button class="btn huge restbtn" data-a="skip">Saltar descanso</button>
      <button class="btn small" data-a="undo">Deshacer serie</button></main>`;
    updateTimer();
    return;
  }

  const target = [e.reps && `${e.reps} reps`, e.weight && `${e.weight} kg`].filter(Boolean).join(' · ');
  const dots = Array.from({ length: e.sets }, (_, k) => `<i class="${k < S.s ? 'on' : k === S.s ? 'cur' : ''}"></i>`).join('');
  app.innerHTML = head + `<main class="workout ${S.go ? 'go' : ''}">
    <div class="state">${S.go ? '¡A LA SERIE!' : 'EN SERIE'}</div>
    <h2 class="exname">${name}</h2>
    <div class="setno">Serie ${S.s + 1} <span>de ${e.sets}</span></div>
    <div class="dots">${dots}</div>
    ${target ? `<p class="sub">${esc(target)}</p>` : ''}
    <div class="grow"></div>
    <p class="next">${next ? 'Después: ' + esc(next.name || `Ejercicio ${S.i + 2}`) : 'Último ejercicio'}</p>
    <button class="btn huge primary" data-a="done">Serie completada</button>
    ${done ? '<button class="btn small" data-a="undo">Deshacer última serie</button>' : ''}</main>`;
}
function updateTimer() {
  if (!S?.rest) return;
  const left = restLeft(), t = $('#timer'), m = $('#mini');
  if (t) {
    t.textContent = fmt(left);
    t.classList.toggle('paused', S.rest.paused != null);
    $('#restbar').style.width = Math.min(100, left * 1000 / S.rest.total * 100) + '%';
  }
  if (m) m.textContent = fmt(left);
}
setInterval(() => {
  if (!S?.rest || S.rest.paused != null) return;
  if (Date.now() >= S.rest.endsAt) endRest(true); else updateTimer();
}, 250);

// ---------- Pantalla: historial ----------
function renderHistory() {
  editing = null;
  const when = t => new Date(t).toLocaleString('es', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  app.innerHTML = `
    <header class="bar"><a class="btn ghost" href="#/" aria-label="Inicio">←</a><h1 class="grow">Historial</h1></header>
    <main class="pad">
      ${history.length ? history.map(h => `<div class="card">
        <div><small>${when(h.start)} · ${Math.round((h.end - h.start) / 60000)} min</small><h2>${esc(h.name)}</h2></div>
        <ul>${h.ex.map(e => `<li class="${e.done ? '' : 'zero'}"><span>${esc(e.name)}</span><b>${e.done}/${e.sets}</b></li>`).join('')}</ul>
      </div>`).join('') : '<p class="hint">Todavía no hay entrenamientos guardados.</p>'}
    </main>`;
}

// ---------- Acciones ----------
const actions = {
  start: el => startWorkout(el.dataset.id),
  newRoutine() {
    const r = { id: uid(), name: '', exercises: [newEx()] };
    routines.push(r); saveRoutines();
    location.hash = '#/edit/' + r.id;
  },
  delRoutine() {
    if (!confirm(`¿Eliminar la rutina "${editing.name || 'Sin nombre'}"?`)) return;
    routines = routines.filter(r => r !== editing); saveRoutines();
    location.hash = '#/';
  },
  addEx() {
    editing.exercises.push(newEx()); saveRoutines(); render();
    const inputs = app.querySelectorAll('[data-f="name"]'), last = inputs[inputs.length - 1];
    last.scrollIntoView({ block: 'center' }); last.focus();
  },
  delEx(el) {
    const i = exIndex(el);
    if (!confirm(`¿Quitar "${editing.exercises[i].name || 'este ejercicio'}"?`)) return;
    editing.exercises.splice(i, 1); saveRoutines(); render();
  },
  move(el) {
    const i = exIndex(el), j = i + +el.dataset.d, xs = editing.exercises;
    [xs[i], xs[j]] = [xs[j], xs[i]]; saveRoutines(); render();
  },
  sets(el) {
    const e = editing.exercises[exIndex(el)], n = e.sets + +el.dataset.d;
    if (n < 1 || n > 10) return;
    // se agrega/quita una serie intermedia; el descanso "tras la última" se conserva
    if (n > e.sets) e.rests.splice(-1, 0, e.rests.length > 1 ? e.rests[e.rests.length - 2] : 90);
    else e.rests.splice(-2, 1);
    e.sets = n; saveRoutines(); render();
  },
  done() {
    const e = S.ex[S.i], rest = +e.rests[S.s] || 0;
    S.done[S.i]++;
    S.go = false;
    if (++S.s >= e.sets) { S.i++; S.s = 0; }
    S.end = S.i >= S.ex.length;
    S.rest = !S.end && rest > 0 ? { total: rest * 1000, endsAt: Date.now() + rest * 1000, paused: null } : null;
    navigator.vibrate?.(40);
    saveSession(); render();
  },
  undo() {
    if (S.s > 0) S.s--;
    else if (S.i > 0) { S.i--; S.s = S.ex[S.i].sets - 1; }
    else return;
    S.done[S.i]--;
    Object.assign(S, { rest: null, go: false, end: false });
    saveSession(); render();
  },
  pause() {
    const r = S.rest;
    if (r.paused != null) { r.endsAt = Date.now() + r.paused; r.paused = null; }
    else r.paused = r.endsAt - Date.now();
    saveSession(); render();
  },
  add(el) {
    const r = S.rest, d = el.dataset.d * 1000;
    if (r.paused != null) r.paused += d; else r.endsAt += d;
    if (d > 0) r.total += d;
    if ((r.paused ?? r.endsAt - Date.now()) <= 0) return endRest(false);
    saveSession(); updateTimer();
  },
  skip: () => endRest(false),
  finish() { if (confirm('¿Finalizar el entrenamiento? Se guarda lo hecho hasta ahora.')) saveWorkout(); },
  save: () => saveWorkout(),
};
app.addEventListener('click', ev => {
  const el = ev.target.closest('[data-a]');
  if (el && !el.disabled) actions[el.dataset.a](el);
});
document.addEventListener('click', unlockAudio);
document.addEventListener('visibilitychange', () => { if (!document.hidden) keepAwake(!!S); });
window.addEventListener('hashchange', render);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
if (S && !location.hash) location.hash = '#/workout'; else render();

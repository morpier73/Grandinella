import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { AppLauncher } from '@capacitor/app-launcher';
import { Geolocation } from '@capacitor/geolocation';
import { LocalNotifications } from '@capacitor/local-notifications';
import { BackgroundRunner } from '@capacitor/background-runner';
import {
  fetchForecast,
  assessHailRisk,
  currentSummary,
  formatTime,
  planNextCheck,
  isCheckDue,
  LEVELS,
} from './hail.js';
import {
  ringPoints,
  buildRingUrl,
  stormMotion,
  chooseEscape,
  compassName,
  buildShelterQuery,
  parseShelters,
  navUrl,
  RING_KM,
} from './escape.js';

const RUNNER_LABEL = 'it.grandinella.app.check';
// Ad app aperta si segue lo stesso schema del background, ma mai oltre 1 ora.
const MAX_OPEN_REFRESH_MS = 60 * 60 * 1000;
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const platform = Capacitor.getPlatform();
const native = Capacitor.isNativePlatform();

const $ = (s) => document.querySelector(s);

function toast(message) {
  const t = $('#toast');
  t.textContent = message;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2800);
}

function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch (e) {
    return fallback;
  }
}

function save(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // Archivio non disponibile: si continua senza ricordare la scelta.
  }
}

let here = load('location', null);
let car = load('car', null);
let settings = Object.assign(
  { alerts: false, followGps: false, navigator: platform === 'ios' ? 'apple' : 'google' },
  load('settings', {})
);
let loading = false;
let appPlan = null;
let lastAssessment = null;
let lastData = null;

// Quello che si sta controllando: l'auto se è parcheggiata, altrimenti tu.
function target() {
  return car ? { ...car, name: car.name || 'la tua auto' } : here;
}

async function syncRunner() {
  if (!native) return;
  try {
    await BackgroundRunner.dispatchEvent({
      label: RUNNER_LABEL,
      event: 'saveState',
      details: { location: here, settings, car },
    });
  } catch (e) {
    console.warn('Runner non raggiungibile', e);
  }
}

function setLocation(loc) {
  here = loc;
  save('location', loc);
  syncRunner();
  refresh(true);
}

function renderTimeline(slots) {
  const el = $('#timeline');
  el.innerHTML = '';
  for (const s of slots) {
    const i = document.createElement('i');
    i.className = 'k-' + s.kind;
    i.title = formatTime(s.time) + ' · ' + s.kind;
    el.appendChild(i);
  }
  const ticks = $('#ticks');
  ticks.innerHTML = '';
  [0, 4, 8, 11].forEach((k) => {
    const span = document.createElement('span');
    span.textContent = k === 0 ? 'Ora' : formatTime(slots[k].time);
    ticks.appendChild(span);
  });
}

function render(data) {
  const a = assessHailRisk(data, new Date());
  const cur = currentSummary(data);
  const t = target();
  lastAssessment = a;
  lastData = data;

  $('#hero').className = 'hero level-' + a.levelInfo.key;
  $('#place').textContent = car ? 'Dove hai lasciato l’auto' + (car.name ? ' · ' + car.name : '') : t.name || 'Posizione attuale';
  $('#level').textContent = a.levelInfo.label;
  $('#when').textContent = a.firstEvent
    ? 'Primo temporale previsto verso le ' + formatTime(a.firstEvent)
    : 'Nessun temporale previsto fino alle ' + formatTime(Date.now() + 3 * 3600 * 1000);
  $('#updated').textContent =
    'Aggiornato alle ' + formatTime(a.checkedAt) + (appPlan ? ' · prossimo controllo alle ' + formatTime(appPlan.nextAt) : '');

  $('#temp').textContent = cur.temperature === null ? '—°' : Math.round(cur.temperature) + '°';
  $('#cond').textContent = cur.label + (cur.gust === null ? '' : ' · raffiche ' + Math.round(cur.gust) + ' km/h');
  $('#freezing').textContent = a.metrics.freezing === null ? '—' : Math.round(a.metrics.freezing) + ' m';
  $('#cape').textContent = a.metrics.cape === null ? 'CAPE n.d.' : 'CAPE max ' + Math.round(a.metrics.cape) + ' J/kg';

  const reasons = $('#reasons');
  reasons.innerHTML = '';
  for (const r of a.reasons) {
    const li = document.createElement('li');
    li.textContent = r;
    reasons.appendChild(li);
  }
  renderTimeline(a.timeline);
  renderCar();
}

// Consiglio per l'auto: riparo coperto e, se c'è tempo, direzione.
async function renderAdvice(a, data) {
  const panel = $('#advice');
  if (a.level < 2) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const t = target();
  const motion = stormMotion(data, new Date());
  $('#motion').textContent = motion
    ? 'I temporali arrivano da ' + compassName(motion.fromDeg) + ' e si muovono verso ' + compassName(motion.toDeg) + ' a circa ' + Math.round(motion.speedKmh) + ' km/h.'
    : 'Direzione dei temporali non disponibile.';

  let ring = [];
  try {
    const points = ringPoints(t.lat, t.lon);
    const r = await fetch(buildRingUrl(points));
    if (r.ok) {
      const list = await r.json();
      const arr = Array.isArray(list) ? list : [list];
      ring = points.map((p, i) => ({ ...p, level: arr[i] ? assessHailRisk(arr[i], new Date()).level : undefined }));
    }
  } catch (e) {
    // Senza i punti intorno si consiglia solo il riparo.
  }
  const advice = chooseEscape(a, ring, motion, Date.now());
  const dir = $('#escape');
  dir.innerHTML = '';
  if (advice && advice.mode === 'direzione') {
    const p = document.createElement('p');
    p.innerHTML = 'Se sei già in viaggio: direzione consigliata <strong></strong>, circa ' + RING_KM + ' km.';
    p.querySelector('strong').textContent = advice.name;
    dir.appendChild(p);
    dir.appendChild(navButton('Apri la direzione nel navigatore', advice.lat, advice.lon));
  } else if (advice) {
    const p = document.createElement('p');
    p.textContent =
      advice.reason === 'vicino'
        ? 'Il temporale è vicino: non metterti in viaggio, porta l’auto al coperto.'
        : 'Nessuna direzione è chiaramente più sicura: meglio un riparo coperto.';
    dir.appendChild(p);
  }
  findShelters(false);
}

function navButton(label, lat, lon) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'secondary';
  b.textContent = label;
  b.onclick = () => openNavigator(lat, lon);
  return b;
}

async function openNavigator(lat, lon) {
  const url = navUrl(settings.navigator, lat, lon);
  try {
    if (native) await AppLauncher.openUrl({ url });
    else window.open(url, '_blank', 'noopener');
  } catch (e) {
    toast('Impossibile aprire il navigatore');
  }
}

let shelterCache = load('shelters', null);
async function findShelters(manual) {
  const t = target();
  if (!t) return toast('Imposta prima una posizione');
  const list = $('#shelters');
  const key = t.lat.toFixed(3) + ',' + t.lon.toFixed(3);
  // I ripari non cambiano: si riusano quelli già trovati per lo stesso punto.
  let items = shelterCache && shelterCache.key === key ? shelterCache.items : null;
  if (!items) {
    if (manual) list.innerHTML = '<li class="empty">Cerco i ripari…</li>';
    try {
      const r = await fetch(OVERPASS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(buildShelterQuery(t.lat, t.lon)),
      });
      if (!r.ok) throw new Error(String(r.status));
      items = parseShelters(await r.json(), t);
      shelterCache = { key, items };
      save('shelters', shelterCache);
    } catch (e) {
      list.innerHTML = '<li class="empty">Ricerca dei ripari non disponibile in questo momento.</li>';
      return;
    }
  }
  $('#sheltersBox').hidden = false;
  list.innerHTML = '';
  if (!items.length) {
    list.innerHTML = '<li class="empty">Nessun parcheggio coperto trovato entro 3 km.</li>';
    return;
  }
  for (const s of items) {
    const li = document.createElement('li');
    const info = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = s.name;
    const meta = document.createElement('small');
    meta.textContent = s.kind + ' · ' + s.km.toFixed(1).replace('.', ',') + ' km' + (s.note ? ' · ' + s.note : '');
    info.append(name, meta);
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'go';
    go.textContent = 'Vai';
    go.onclick = () => openNavigator(s.lat, s.lon);
    li.append(info, go);
    list.appendChild(li);
  }
}

async function refresh(force) {
  const t = target();
  if (!t || loading) return;
  if (!force && !isCheckDue(appPlan, Date.now())) return;
  loading = true;
  $('#updated').textContent = 'Aggiornamento…';
  try {
    const data = await fetchForecast(t.lat, t.lon);
    const now = Date.now();
    appPlan = planNextCheck(appPlan, assessHailRisk(data, new Date(now)), now);
    appPlan.nextAt = Math.min(appPlan.nextAt, now + MAX_OPEN_REFRESH_MS);
    render(data);
    renderAdvice(lastAssessment, data);
  } catch (e) {
    $('#updated').textContent = 'Dati non disponibili. Controlla la connessione.';
    toast('Aggiornamento non riuscito');
  } finally {
    loading = false;
  }
}

async function reverseName(lat, lon) {
  try {
    const r = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=it`
    );
    const d = await r.json();
    return d.locality || d.city || '';
  } catch (e) {
    return '';
  }
}

async function currentPosition(highAccuracy) {
  if (native) {
    const perm = await Geolocation.requestPermissions({ permissions: ['location', 'coarseLocation'] });
    if (perm.location !== 'granted' && perm.coarseLocation !== 'granted') throw new Error('permesso');
  }
  const p = await Geolocation.getCurrentPosition({ enableHighAccuracy: highAccuracy, timeout: 15000 });
  return { lat: p.coords.latitude, lon: p.coords.longitude };
}

async function useGps() {
  try {
    const { lat, lon } = await currentPosition(false);
    setLocation({ lat, lon, name: (await reverseName(lat, lon)) || 'Posizione attuale' });
    toast('Posizione aggiornata');
  } catch (e) {
    toast('Posizione non disponibile: cerca un comune');
    $('#query').focus();
  }
}

function renderCar() {
  const status = $('#carStatus');
  if (car) {
    status.textContent =
      'Auto parcheggiata' + (car.name ? ' a ' + car.name : '') + ' alle ' + formatTime(car.at) + '. Gli avvisi valgono per l’auto.';
    $('#parkBtn').hidden = true;
    $('#unparkBtn').hidden = false;
  } else {
    status.textContent = 'Quando parcheggi, salva la posizione: gli avvisi seguiranno l’auto anche se tu sei altrove.';
    $('#parkBtn').hidden = false;
    $('#unparkBtn').hidden = true;
  }
}

async function park() {
  let pos;
  try {
    pos = await currentPosition(true);
  } catch (e) {
    if (!here) return toast('Posizione non disponibile');
    pos = { lat: here.lat, lon: here.lon };
    toast('GPS non disponibile: uso la posizione scelta');
  }
  car = { lat: pos.lat, lon: pos.lon, name: await reverseName(pos.lat, pos.lon), at: Date.now() };
  save('car', car);
  appPlan = null;
  renderCar();
  await syncRunner();
  refresh(true);
  toast('Posizione dell’auto salvata');
}

async function unpark() {
  car = null;
  save('car', null);
  appPlan = null;
  renderCar();
  await syncRunner();
  refresh(true);
  toast('Ok, gli avvisi tornano alla tua posizione');
}

let searchTimer;
async function search(q) {
  const list = $('#results');
  if (q.trim().length < 3) {
    list.hidden = true;
    return;
  }
  try {
    const r = await fetch(
      'https://geocoding-api.open-meteo.com/v1/search?count=6&language=it&format=json&name=' + encodeURIComponent(q.trim())
    );
    const d = await r.json();
    list.innerHTML = '';
    for (const place of d.results || []) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = [place.name, place.admin2 || place.admin1, place.country_code].filter(Boolean).join(', ');
      b.onclick = () => {
        list.hidden = true;
        $('#query').value = '';
        setLocation({ lat: place.latitude, lon: place.longitude, name: place.name });
      };
      li.appendChild(b);
      list.appendChild(li);
    }
    if (!list.children.length) list.innerHTML = '<li class="empty">Nessun comune trovato</li>';
    list.hidden = false;
  } catch (e) {
    toast('Ricerca non disponibile');
  }
}

async function enableAlerts() {
  if (!native) {
    toast('Gli avvisi in background funzionano solo nell’app installata');
    return false;
  }
  const perm = await LocalNotifications.requestPermissions();
  if (perm.display !== 'granted') {
    toast('Notifiche non consentite: attivale nelle impostazioni');
    return false;
  }
  try {
    await BackgroundRunner.requestPermissions({ apis: ['notifications', 'geolocation'] });
  } catch (e) {
    // Su alcune versioni il permesso è già coperto da LocalNotifications.
  }
  if (platform === 'android') {
    await LocalNotifications.createChannel({
      id: 'grandine',
      name: 'Allerte grandine',
      description: 'Avvisi quando il rischio di grandine è moderato o alto',
      importance: 5,
      visibility: 1,
      vibration: true,
    });
  }
  return true;
}

async function showBackgroundStatus() {
  const el = $('#bgStatus');
  if (!native) {
    el.textContent = 'Stai usando la versione web: gli avvisi richiedono l’app.';
    return;
  }
  if (!settings.alerts) {
    el.textContent = '';
    return;
  }
  try {
    const s = await BackgroundRunner.dispatchEvent({ label: RUNNER_LABEL, event: 'getStatus', details: {} });
    if (s && s.lastCheck) {
      const d = new Date(s.lastCheck.at);
      let text =
        'Ultimo controllo: ' +
        d.toLocaleDateString('it-IT') +
        ' alle ' +
        formatTime(s.lastCheck.at) +
        ' (' +
        LEVELS[s.lastCheck.level].short.toLowerCase() +
        ').';
      if (s.lastCheck.nextAt) text += ' Prossimo verso le ' + formatTime(s.lastCheck.nextAt) + '.';
      el.textContent = text;
    } else {
      el.textContent = 'Primo controllo in background entro circa 15 minuti dalla chiusura dell’app.';
    }
  } catch (e) {
    el.textContent = '';
  }
}

async function testNotification() {
  if (!native) return toast('Le notifiche funzionano solo nell’app installata');
  if (!(await enableAlerts())) return;
  await LocalNotifications.schedule({
    notifications: [
      {
        id: 999,
        title: 'Prova di Grandinella',
        body: 'Le notifiche funzionano. Questa è solo una prova.',
        channelId: 'grandine',
      },
    ],
  });
}

function saveSettings(patch) {
  settings = { ...settings, ...patch };
  save('settings', settings);
  return syncRunner();
}

function bind() {
  $('#locate').onclick = useGps;
  $('#search').onsubmit = (e) => {
    e.preventDefault();
    search($('#query').value);
  };
  $('#query').oninput = (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => search(e.target.value), 350);
  };

  const alertsToggle = $('#alertsToggle');
  const gpsToggle = $('#gpsToggle');
  const navSelect = $('#navigator');
  alertsToggle.checked = settings.alerts;
  gpsToggle.checked = settings.followGps;
  if (platform !== 'ios') navSelect.querySelector('option[value="apple"]').remove();
  navSelect.value = settings.navigator;
  alertsToggle.onchange = async () => {
    if (alertsToggle.checked && !(await enableAlerts())) alertsToggle.checked = false;
    await saveSettings({ alerts: alertsToggle.checked });
    showBackgroundStatus();
    if (settings.alerts) toast('Avvisi attivi');
  };
  gpsToggle.onchange = async () => {
    await saveSettings({ followGps: gpsToggle.checked });
    if (gpsToggle.checked) useGps();
  };
  navSelect.onchange = () => saveSettings({ navigator: navSelect.value });
  $('#testNotif').onclick = testNotification;
  $('#parkBtn').onclick = park;
  $('#unparkBtn').onclick = unpark;
  $('#shelterBtn').onclick = () => findShelters(true);
  if (platform === 'ios') $('#iosNote').hidden = false;

  if (native) {
    App.addListener('resume', () => {
      refresh(false);
      showBackgroundStatus();
    });
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh(false);
  });
  // Ogni minuto si guarda solo se il controllo è dovuto: costa nulla.
  setInterval(() => {
    if (!document.hidden) refresh(false);
  }, 60 * 1000);
}

bind();
renderCar();
syncRunner();
showBackgroundStatus();
if (car || (here && !settings.followGps)) refresh(true);
else useGps();

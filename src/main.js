import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Geolocation } from '@capacitor/geolocation';
import { LocalNotifications } from '@capacitor/local-notifications';
import { BackgroundRunner } from '@capacitor/background-runner';
import { fetchForecast, assessHailRisk, currentSummary, formatTime, LEVELS } from './hail.js';

const RUNNER_LABEL = 'it.grandinella.app.check';
const REFRESH_MS = 10 * 60 * 1000;
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
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // Archivio non disponibile: si continua senza ricordare la scelta.
  }
}

let here = load('location', null);
let settings = load('settings', { alerts: false, followGps: false });
let loading = false;

async function syncRunner() {
  if (!native) return;
  try {
    await BackgroundRunner.dispatchEvent({
      label: RUNNER_LABEL,
      event: 'saveState',
      details: { location: here, settings },
    });
  } catch (e) {
    console.warn('Runner non raggiungibile', e);
  }
}

function setLocation(loc) {
  here = loc;
  save('location', loc);
  syncRunner();
  refresh();
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

  $('#hero').className = 'hero level-' + a.levelInfo.key;
  $('#place').textContent = here.name || 'Posizione attuale';
  $('#level').textContent = a.levelInfo.label;
  $('#when').textContent = a.firstEvent
    ? 'Primo temporale previsto verso le ' + formatTime(a.firstEvent)
    : 'Nessun temporale previsto fino alle ' + formatTime(Date.now() + 3 * 3600 * 1000);
  $('#updated').textContent = 'Aggiornato alle ' + formatTime(a.checkedAt);

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
}

async function refresh() {
  if (!here || loading) return;
  loading = true;
  $('#updated').textContent = 'Aggiornamento…';
  try {
    const data = await fetchForecast(here.lat, here.lon);
    render(data);
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

async function useGps() {
  try {
    if (native) {
      const perm = await Geolocation.requestPermissions({ permissions: ['coarseLocation'] });
      if (perm.location !== 'granted' && perm.coarseLocation !== 'granted') {
        toast('Permesso di posizione negato');
        return;
      }
    }
    const p = await Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 15000 });
    const lat = p.coords.latitude;
    const lon = p.coords.longitude;
    setLocation({ lat, lon, name: (await reverseName(lat, lon)) || 'Posizione attuale' });
    toast('Posizione aggiornata');
  } catch (e) {
    toast('Posizione non disponibile: cerca un comune');
    $('#query').focus();
  }
}

let searchTimer;
async function search(q) {
  const list = $('#results');
  if (q.trim().length < 2) {
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
  if (Capacitor.getPlatform() === 'android') {
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
      el.textContent =
        'Ultimo controllo in background: ' +
        d.toLocaleDateString('it-IT') +
        ' alle ' +
        formatTime(s.lastCheck.at) +
        ' (' +
        LEVELS[s.lastCheck.level].short.toLowerCase() +
        ').';
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
  alertsToggle.checked = settings.alerts;
  gpsToggle.checked = settings.followGps;
  alertsToggle.onchange = async () => {
    if (alertsToggle.checked && !(await enableAlerts())) alertsToggle.checked = false;
    settings = { ...settings, alerts: alertsToggle.checked };
    save('settings', settings);
    await syncRunner();
    showBackgroundStatus();
    if (settings.alerts) toast('Avvisi attivi');
  };
  gpsToggle.onchange = async () => {
    settings = { ...settings, followGps: gpsToggle.checked };
    save('settings', settings);
    await syncRunner();
    if (gpsToggle.checked) useGps();
  };
  $('#testNotif').onclick = testNotification;

  if (native) {
    App.addListener('resume', () => {
      refresh();
      showBackgroundStatus();
    });
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
  });
  setInterval(() => {
    if (!document.hidden) refresh();
  }, REFRESH_MS);
}

bind();
syncRunner();
showBackgroundStatus();
if (here && !settings.followGps) refresh();
else useGps();

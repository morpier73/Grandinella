// Logica condivisa tra l'app e il controllo in background.
// Nessun import: lo script di build copia questo file dentro il runner
// in background (public/runners/background.js) togliendo gli "export".

export const LEVELS = [
  { id: 0, key: 'nessuno', label: 'Nessun rischio', short: 'Nessuno' },
  { id: 1, key: 'basso', label: 'Rischio basso', short: 'Basso' },
  { id: 2, key: 'moderato', label: 'Rischio moderato', short: 'Moderato' },
  { id: 3, key: 'alto', label: 'Rischio alto', short: 'Alto' },
];

export const HORIZON_HOURS = 3;
export const SLOT_MINUTES = 15;
export const ALERT_MIN_LEVEL = 2;
export const ALERT_COOLDOWN_MS = 3 * 60 * 60 * 1000;

const HOURLY_BASE = [
  'weather_code',
  'precipitation_probability',
  'precipitation',
  'cape',
  'wind_gusts_10m',
  'freezing_level_height',
];
// Variabili disponibili solo con alcuni modelli: se l'API le rifiuta
// si riprova senza.
const HOURLY_EXTRA = ['lifted_index', 'lightning_potential'];
// Vento in quota: serve a stimare dove si muovono i temporali.
const HOURLY_STEERING = ['wind_speed_700hPa', 'wind_direction_700hPa', 'wind_speed_500hPa', 'wind_direction_500hPa'];

// detail "light": solo dati orari essenziali, per i controlli con rischio nullo.
// detail "full": anche dati a 15 minuti e vento in quota.
export function buildForecastUrl(lat, lon, extended = true, detail = 'full') {
  const light = detail === 'light';
  let hourly = extended ? HOURLY_BASE.concat(HOURLY_EXTRA) : HOURLY_BASE;
  if (!light) hourly = hourly.concat(HOURLY_STEERING);
  const params = [
    'latitude=' + lat.toFixed(4),
    'longitude=' + lon.toFixed(4),
    'current=temperature_2m,weather_code,precipitation,wind_gusts_10m',
    'hourly=' + hourly.join(','),
  ];
  if (!light) params.push('minutely_15=weather_code,precipitation', 'forecast_minutely_15=16');
  params.push('forecast_hours=' + (light ? 4 : 5), 'timezone=auto', 'timeformat=unixtime');
  return 'https://api.open-meteo.com/v1/forecast?' + params.join('&');
}

export async function fetchForecast(lat, lon, fetchFn, detail) {
  const f = fetchFn || fetch;
  let res = await f(buildForecastUrl(lat, lon, true, detail));
  if (res.status === 400) res = await f(buildForecastUrl(lat, lon, false, detail));
  if (!res.ok) throw new Error('Servizio meteo non disponibile (' + res.status + ')');
  return res.json();
}

export function weatherLabel(code) {
  if (code === 99) return 'Temporale con grandine forte';
  if (code === 96) return 'Temporale con grandine';
  if (code === 95) return 'Temporale';
  if (code >= 85) return 'Rovesci di neve';
  if (code >= 80) return 'Rovesci';
  if (code >= 71) return 'Neve';
  if (code >= 61) return 'Pioggia';
  if (code >= 51) return 'Pioviggine';
  if (code >= 45) return 'Nebbia';
  if (code >= 3) return 'Coperto';
  if (code >= 1) return 'Poco nuvoloso';
  return 'Sereno';
}

function num(v) {
  return typeof v === 'number' && isFinite(v) ? v : null;
}

function maxOf(values) {
  let m = null;
  for (const v of values) if (v !== null && (m === null || v > m)) m = v;
  return m;
}

function minOf(values) {
  let m = null;
  for (const v of values) if (v !== null && (m === null || v < m)) m = v;
  return m;
}

// Indici delle ore che si sovrappongono alla finestra [now, now + 3h).
function hourIndexes(times, nowSec) {
  const end = nowSec + HORIZON_HOURS * 3600;
  const out = [];
  for (let i = 0; i < times.length; i++) {
    if (times[i] + 3600 > nowSec && times[i] < end) out.push(i);
  }
  return out;
}

function slotKind(code, precip) {
  if (code === 96 || code === 99) return 'grandine';
  if (code !== null && code >= 95) return 'temporale';
  if (precip !== null && precip >= 2.5) return 'forte';
  if ((precip !== null && precip >= 0.2) || (code !== null && code >= 51)) return 'pioggia';
  return 'asciutto';
}

// 12 intervalli da 15 minuti per le prossime 3 ore. Usa i dati a 15 minuti
// quando ci sono, altrimenti ripiega su quelli orari.
export function buildTimeline(data, now) {
  const nowSec = Math.floor(now.getTime() / 1000);
  const start = nowSec - (nowSec % (SLOT_MINUTES * 60));
  const m = data.minutely_15 || {};
  const h = data.hourly || {};
  const slots = [];
  for (let k = 0; k < (HORIZON_HOURS * 60) / SLOT_MINUTES; k++) {
    const t = start + k * SLOT_MINUTES * 60;
    let code = null;
    let precip = null;
    const mi = m.time ? m.time.indexOf(t) : -1;
    if (mi >= 0) {
      code = num(m.weather_code && m.weather_code[mi]);
      precip = num(m.precipitation && m.precipitation[mi]);
    } else if (h.time) {
      const hi = h.time.findIndex((ht) => t >= ht && t < ht + 3600);
      if (hi >= 0) {
        code = num(h.weather_code && h.weather_code[hi]);
        const p = num(h.precipitation && h.precipitation[hi]);
        precip = p === null ? null : p / 4;
      }
    }
    slots.push({ time: t * 1000, code, kind: slotKind(code, precip) });
  }
  return slots;
}

export function assessHailRisk(data, now) {
  const nowDate = now || new Date();
  const nowSec = Math.floor(nowDate.getTime() / 1000);
  const h = data.hourly || {};
  const idx = h.time ? hourIndexes(h.time, nowSec) : [];
  const pick = (name) => idx.map((i) => num(h[name] && h[name][i]));

  const timeline = buildTimeline(data, nowDate);
  const codes = pick('weather_code').concat(timeline.map((s) => s.code));
  const hailHeavy = codes.includes(99);
  const hail = hailHeavy || codes.includes(96);
  const stormCode = codes.some((c) => c !== null && c >= 95);

  const cape = maxOf(pick('cape'));
  const li = minOf(pick('lifted_index'));
  const lightning = maxOf(pick('lightning_potential'));
  const prob = maxOf(pick('precipitation_probability'));
  const gust = maxOf(pick('wind_gusts_10m'));

  // Lo zero termico conta soprattutto nelle ore in cui c'è convezione.
  const stormIdx = idx.filter((i) => {
    const c = num(h.weather_code && h.weather_code[i]);
    return c !== null && c >= 95;
  });
  const freezing = minOf(
    (stormIdx.length ? stormIdx : idx).map((i) => num(h.freezing_level_height && h.freezing_level_height[i]))
  );

  const storm = stormCode || (lightning !== null && lightning >= 2);

  let instability = 0;
  if ((cape !== null && cape >= 2000) || (li !== null && li <= -6)) instability = 2;
  else if ((cape !== null && cape >= 800) || (li !== null && li <= -3)) instability = 1;

  let freezingAdj = 0;
  if (freezing !== null && freezing <= 3200) freezingAdj = 1;
  else if (freezing !== null && freezing >= 4500) freezingAdj = -1;

  const reasons = [];
  let level = 0;
  if (hailHeavy) {
    level = 3;
    reasons.push('Il modello prevede temporali con grandine forte');
  } else if (hail) {
    level = instability >= 1 ? 3 : 2;
    reasons.push('Il modello prevede temporali con grandine');
  } else if (storm) {
    level = Math.max(1, Math.min(3, 1 + instability + freezingAdj));
    reasons.push(stormCode ? 'Temporali previsti nelle prossime 3 ore' : 'Alto potenziale di fulmini');
  } else if (prob !== null && prob >= 50 && instability >= 1) {
    level = 1;
    reasons.push('Atmosfera instabile con possibili rovesci');
  }

  if (level > 0) {
    if (instability === 2) reasons.push('Energia convettiva molto alta (CAPE ' + Math.round(cape || 0) + ' J/kg)');
    else if (instability === 1) reasons.push('Energia convettiva moderata (CAPE ' + Math.round(cape || 0) + ' J/kg)');
    if (freezingAdj === 1) reasons.push('Zero termico basso (' + Math.round(freezing) + ' m): la grandine fonde meno');
    if (freezingAdj === -1) reasons.push('Zero termico alto (' + Math.round(freezing) + ' m): la grandine tende a fondere');
    if (gust !== null && gust >= 60) reasons.push('Raffiche fino a ' + Math.round(gust) + ' km/h');
  } else {
    reasons.push(stormCode ? 'Temporali deboli' : 'Nessun temporale previsto nelle prossime 3 ore');
  }

  const firstSlot = timeline.find((s) => s.kind === 'grandine' || s.kind === 'temporale');
  let firstEvent = firstSlot ? firstSlot.time : null;
  if (!firstEvent && storm) {
    const i = idx.find((j) => num(h.weather_code && h.weather_code[j]) >= 95);
    if (i !== undefined) firstEvent = Math.max(h.time[i], nowSec) * 1000;
  }

  return {
    level,
    levelInfo: LEVELS[level],
    reasons,
    firstEvent,
    timeline,
    metrics: { cape, li, lightning, prob, gust, freezing, hail, storm },
    checkedAt: nowDate.getTime(),
  };
}

export function currentSummary(data) {
  const c = data.current || {};
  return {
    temperature: num(c.temperature_2m),
    code: num(c.weather_code),
    label: weatherLabel(num(c.weather_code)),
    gust: num(c.wind_gusts_10m),
  };
}

// Decide se mandare una notifica e perché: solo da "moderato" in su,
// subito se il livello sale, di nuovo quando il fenomeno è imminente,
// altrimenti non più di una ogni 3 ore. Restituisce false oppure il motivo.
export const IMMINENT_MS = 30 * 60 * 1000;

export function shouldNotify(previous, assessment, nowMs) {
  if (assessment.level < ALERT_MIN_LEVEL) return false;
  if (!previous) return 'nuovo';
  if (assessment.level > previous.level) return 'aumento';
  const imminent = assessment.firstEvent !== null && assessment.firstEvent - nowMs <= IMMINENT_MS;
  if (imminent && !previous.imminent) return 'imminente';
  if (nowMs - previous.at >= ALERT_COOLDOWN_MS) return 'promemoria';
  return false;
}

// Stato da salvare dopo un controllo. Il segno "imminente" si azzera quando
// il fenomeno non è più vicino, così il temporale successivo riavvisa.
export function nextAlertState(previous, assessment, reason, nowMs) {
  const imminentNow = assessment.firstEvent !== null && assessment.firstEvent - nowMs <= IMMINENT_MS;
  if (reason) return { at: nowMs, level: assessment.level, imminent: imminentNow };
  if (previous && previous.imminent && !imminentNow) return Object.assign({}, previous, { imminent: false });
  return previous;
}

// Intervallo tra un controllo e l'altro in base al rischio.
export const CHECK_INTERVALS_MS = [3 * 3600000, 3600000, 30 * 60000, 15 * 60000];
export const MIN_INTERVAL_MS = 15 * 60000;

// Pianifica il prossimo controllo. Il livello "effettivo" scende solo dopo
// due controlli consecutivi più bassi; se il temporale è previsto entro
// un'ora si ricontrolla comunque entro 15 minuti.
export function planNextCheck(previousPlan, assessment, nowMs) {
  let level = assessment.level;
  let lowerStreak = 0;
  if (previousPlan && assessment.level < previousPlan.level) {
    lowerStreak = (previousPlan.lowerStreak || 0) + 1;
    if (lowerStreak < 2) level = previousPlan.level;
    else lowerStreak = 0;
  }
  let delay = CHECK_INTERVALS_MS[level];
  if (assessment.firstEvent !== null && assessment.firstEvent - nowMs <= 3600000) {
    delay = Math.min(delay, MIN_INTERVAL_MS);
  }
  return { level, lowerStreak, nextAt: nowMs + delay, detail: level === 0 ? 'light' : 'full' };
}

// Il controllo è dovuto? Un minuto di tolleranza perché il sistema non
// sveglia mai l'app all'istante esatto.
export function isCheckDue(plan, nowMs) {
  return !plan || nowMs >= plan.nextAt - 60000;
}

export function formatTime(ms) {
  const d = new Date(ms);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

export function alertText(assessment, placeName, options) {
  const opts = options || {};
  const when = assessment.firstEvent ? ' verso le ' + formatTime(assessment.firstEvent) : ' nelle prossime 3 ore';
  const where = opts.car ? ' dove hai lasciato l\'auto' : placeName ? ' a ' + placeName : '';
  const title =
    (opts.reason === 'imminente' ? 'Grandine in arrivo' : assessment.levelInfo.label + ' di grandine') + where;
  const action = opts.car
    ? 'Apri Grandinella per il parcheggio coperto più vicino.'
    : 'Metti al riparo auto e piante.';
  return { title, body: assessment.reasons[0] + when + '. ' + action };
}

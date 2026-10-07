// Direzione dei temporali, punti intorno, scelta della direzione di fuga,
// ripari coperti e link ai navigatori. Solo logica: niente rete né DOM,
// tranne buildRingUrl/buildShelterQuery che preparano le richieste.

export const RING_KM = 15;
export const SHELTER_RADIUS_M = 3000;
export const SHELTER_FIRST_MINUTES = 20;

const BEARINGS = [0, 45, 90, 135, 180, 225, 270, 315];
const NAMES = ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ovest', 'ovest', 'nord-ovest'];

export function compassName(deg) {
  return NAMES[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

function rad(d) {
  return (d * Math.PI) / 180;
}

function deg(r) {
  return (r * 180) / Math.PI;
}

// Punto a "km" chilometri in direzione "bearing" (gradi, 0 = nord).
export function destination(lat, lon, bearing, km) {
  const R = 6371;
  const d = km / R;
  const b = rad(bearing);
  const p1 = rad(lat);
  const l1 = rad(lon);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: deg(p2), lon: deg(l2) };
}

export function distanceKm(a, b) {
  const R = 6371;
  const dp = rad(b.lat - a.lat);
  const dl = rad(b.lon - a.lon);
  const h = Math.sin(dp / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function ringPoints(lat, lon, km = RING_KM) {
  return BEARINGS.map((b) => ({ bearing: b, ...destination(lat, lon, b, km) }));
}

// Una sola richiesta per gli 8 punti: Open-Meteo accetta più coordinate.
export function buildRingUrl(points) {
  const params = [
    'latitude=' + points.map((p) => p.lat.toFixed(4)).join(','),
    'longitude=' + points.map((p) => p.lon.toFixed(4)).join(','),
    'hourly=weather_code,precipitation_probability,precipitation,cape,wind_gusts_10m,freezing_level_height',
    'forecast_hours=4',
    'timezone=auto',
    'timeformat=unixtime',
  ];
  return 'https://api.open-meteo.com/v1/forecast?' + params.join('&');
}

function angleDiff(a, b) {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

// Movimento dei temporali: media vettoriale del vento a 700 e 500 hPa nelle
// prossime 3 ore. Il vento meteorologico indica da dove soffia.
export function stormMotion(data, now) {
  const h = (data && data.hourly) || {};
  if (!h.time || !h.wind_speed_700hPa) return null;
  const nowSec = Math.floor(now.getTime() / 1000);
  let u = 0;
  let v = 0;
  let n = 0;
  for (let i = 0; i < h.time.length; i++) {
    if (h.time[i] + 3600 <= nowSec || h.time[i] >= nowSec + 3 * 3600) continue;
    for (const lvl of ['700', '500']) {
      const sp = h['wind_speed_' + lvl + 'hPa'] && h['wind_speed_' + lvl + 'hPa'][i];
      const dir = h['wind_direction_' + lvl + 'hPa'] && h['wind_direction_' + lvl + 'hPa'][i];
      if (typeof sp !== 'number' || typeof dir !== 'number') continue;
      // Vettore verso cui si muove l'aria.
      const to = rad(dir + 180);
      u += sp * Math.sin(to);
      v += sp * Math.cos(to);
      n++;
    }
  }
  if (!n) return null;
  u /= n;
  v /= n;
  const speed = Math.sqrt(u * u + v * v);
  if (speed < 5) return null;
  const toDeg = (deg(Math.atan2(u, v)) + 360) % 360;
  return { toDeg, fromDeg: (toDeg + 180) % 360, speedKmh: speed };
}

// Sceglie cosa consigliare per l'auto.
// center: valutazione nel punto; ring: [{bearing, lat, lon, level}]; motion: da stormMotion.
// Restituisce null (nessun consiglio), {mode: 'riparo'} oppure
// {mode: 'direzione', bearing, lat, lon, name}.
export function chooseEscape(center, ring, motion, nowMs) {
  if (!center || center.level < 2) return null;
  const minutes = center.firstEvent === null ? null : (center.firstEvent - nowMs) / 60000;
  if (minutes !== null && minutes <= SHELTER_FIRST_MINUTES) return { mode: 'riparo', reason: 'vicino' };
  if (!ring || !ring.length) return { mode: 'riparo', reason: 'dati' };

  let candidates = ring.filter((p) => typeof p.level === 'number');
  if (motion) {
    // Niente direzioni verso il temporale né lungo il suo percorso.
    candidates = candidates.filter((p) => angleDiff(p.bearing, motion.fromDeg) > 45 && angleDiff(p.bearing, motion.toDeg) > 45);
  }
  if (!candidates.length) return { mode: 'riparo', reason: 'dati' };

  const lateral = (p) => (motion ? Math.abs(90 - angleDiff(p.bearing, motion.toDeg)) : 0);
  candidates.sort((a, b) => a.level - b.level || lateral(a) - lateral(b));
  const best = candidates[0];
  if (best.level >= center.level) return { mode: 'riparo', reason: 'ovunque' };
  return { mode: 'direzione', bearing: best.bearing, lat: best.lat, lon: best.lon, name: compassName(best.bearing), level: best.level };
}

// Ripari coperti per l'auto da OpenStreetMap (servizio Overpass).
export function buildShelterQuery(lat, lon, radius = SHELTER_RADIUS_M) {
  const a = '(around:' + radius + ',' + lat.toFixed(5) + ',' + lon.toFixed(5) + ')';
  return (
    '[out:json][timeout:15];(' +
    'nwr["amenity"="parking"]["parking"~"multi-storey|underground"]' + a + ';' +
    'nwr["building"="parking"]' + a + ';' +
    'nwr["amenity"="parking"]["covered"="yes"]' + a + ';' +
    'nwr["amenity"="fuel"]' + a + ';' +
    ');out center 40;'
  );
}

export function parseShelters(json, from) {
  const seen = new Set();
  const out = [];
  for (const el of (json && json.elements) || []) {
    const lat = el.lat !== undefined ? el.lat : el.center && el.center.lat;
    const lon = el.lon !== undefined ? el.lon : el.center && el.center.lon;
    if (typeof lat !== 'number' || typeof lon !== 'number') continue;
    const t = el.tags || {};
    const fuel = t.amenity === 'fuel';
    let kind = 'Parcheggio coperto';
    if (fuel) kind = 'Distributore';
    else if (t.parking === 'underground') kind = 'Parcheggio sotterraneo';
    else if (t.parking === 'multi-storey' || t.building === 'parking') kind = 'Parcheggio multipiano';
    const key = lat.toFixed(4) + ',' + lon.toFixed(4);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      lat,
      lon,
      kind,
      name: t.name || t.brand || kind,
      fuel,
      note: fuel ? 'pensilina da verificare' : t.maxheight ? 'altezza max ' + t.maxheight + ' m' : t.access === 'private' ? 'privato' : '',
      km: distanceKm(from, { lat, lon }),
    });
  }
  // Prima i parcheggi coperti, poi i distributori; a parità, il più vicino.
  out.sort((a, b) => Number(a.fuel) - Number(b.fuel) || a.km - b.km);
  return out.filter((s) => !s.fuel || s.km <= 2).slice(0, 3);
}

export function navUrl(app, lat, lon) {
  const ll = lat.toFixed(5) + ',' + lon.toFixed(5);
  if (app === 'waze') return 'https://waze.com/ul?ll=' + ll + '&navigate=yes';
  if (app === 'apple') return 'https://maps.apple.com/?daddr=' + ll + '&dirflg=d';
  return 'https://www.google.com/maps/dir/?api=1&destination=' + ll + '&travelmode=driving';
}

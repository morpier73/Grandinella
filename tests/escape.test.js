import { describe, it, expect } from 'vitest';
import {
  compassName,
  destination,
  distanceKm,
  ringPoints,
  buildRingUrl,
  stormMotion,
  chooseEscape,
  parseShelters,
  buildShelterQuery,
  navUrl,
} from '../src/escape.js';

const NOW = new Date('2026-07-15T14:05:00Z');
const H0 = Date.UTC(2026, 6, 15, 14) / 1000;
const BO = { lat: 44.457, lon: 11.2 };

function winds(dir700, sp700, dir500, sp500) {
  return {
    hourly: {
      time: [0, 1, 2, 3].map((i) => H0 + i * 3600),
      wind_speed_700hPa: [sp700, sp700, sp700, sp700],
      wind_direction_700hPa: [dir700, dir700, dir700, dir700],
      wind_speed_500hPa: [sp500, sp500, sp500, sp500],
      wind_direction_500hPa: [dir500, dir500, dir500, dir500],
    },
  };
}

describe('geometria', () => {
  it('dà i nomi dei punti cardinali', () => {
    expect(compassName(0)).toBe('nord');
    expect(compassName(100)).toBe('est');
    expect(compassName(225)).toBe('sud-ovest');
    expect(compassName(350)).toBe('nord');
  });
  it('calcola un punto a 15 km e la distanza', () => {
    const p = destination(BO.lat, BO.lon, 90, 15);
    expect(distanceKm(BO, p)).toBeCloseTo(15, 1);
    expect(p.lon).toBeGreaterThan(BO.lon);
  });
  it('prepara 8 punti in una sola richiesta', () => {
    const pts = ringPoints(BO.lat, BO.lon);
    expect(pts).toHaveLength(8);
    const u = buildRingUrl(pts);
    expect(u.split('latitude=')[1].split('&')[0].split(',')).toHaveLength(8);
  });
});

describe('stormMotion', () => {
  it('vento da ovest: i temporali vanno verso est', () => {
    const m = stormMotion(winds(270, 40, 270, 60), NOW);
    expect(m.fromDeg).toBeCloseTo(270, 0);
    expect(m.toDeg).toBeCloseTo(90, 0);
    expect(m.speedKmh).toBeCloseTo(50, 0);
  });
  it('senza vento in quota non stima nulla', () => {
    expect(stormMotion({ hourly: { time: [H0] } }, NOW)).toBeNull();
    expect(stormMotion(winds(270, 2, 90, 2), NOW)).toBeNull();
  });
});

describe('chooseEscape', () => {
  const t = NOW.getTime();
  const motion = { fromDeg: 270, toDeg: 90, speedKmh: 40 };
  const ring = (levels) => ringPoints(BO.lat, BO.lon).map((p, i) => ({ ...p, level: levels[i] }));
  // ordine: N, NE, E, SE, S, SO, O, NO

  it('nessun consiglio con rischio basso', () => {
    expect(chooseEscape({ level: 1, firstEvent: null }, [], motion, t)).toBeNull();
  });
  it('se il temporale è entro 20 minuti consiglia il riparo', () => {
    expect(chooseEscape({ level: 3, firstEvent: t + 15 * 60000 }, ring([0, 0, 0, 0, 0, 0, 0, 0]), motion, t).mode).toBe('riparo');
  });
  it('sceglie una direzione di lato rispetto al percorso', () => {
    const r = chooseEscape({ level: 3, firstEvent: t + 90 * 60000 }, ring([1, 3, 3, 3, 1, 3, 3, 3]), motion, t);
    expect(r.mode).toBe('direzione');
    expect(['nord', 'sud']).toContain(r.name);
  });
  it('non manda mai verso il temporale né lungo il suo percorso', () => {
    const r = chooseEscape({ level: 3, firstEvent: t + 90 * 60000 }, ring([3, 3, 0, 3, 3, 3, 0, 3]), motion, t);
    expect(r.mode).toBe('riparo');
  });
  it('se ovunque è uguale consiglia il riparo', () => {
    const r = chooseEscape({ level: 2, firstEvent: null }, ring([2, 2, 2, 2, 2, 2, 2, 2]), motion, t);
    expect(r.mode).toBe('riparo');
  });
});

describe('ripari', () => {
  it('prepara la richiesta a OpenStreetMap', () => {
    const q = buildShelterQuery(BO.lat, BO.lon);
    expect(q).toContain('multi-storey|underground');
    expect(q).toContain('around:3000');
  });
  it('mette prima i parcheggi coperti, poi i distributori vicini', () => {
    const near = destination(BO.lat, BO.lon, 0, 0.5);
    const mid = destination(BO.lat, BO.lon, 0, 1.5);
    const far = destination(BO.lat, BO.lon, 0, 2.5);
    const json = {
      elements: [
        { type: 'node', lat: near.lat, lon: near.lon, tags: { amenity: 'fuel', brand: 'Eni' } },
        { type: 'way', center: mid, tags: { amenity: 'parking', parking: 'multi-storey', name: 'Parcheggio Centro', maxheight: '2.1' } },
        { type: 'node', lat: far.lat, lon: far.lon, tags: { amenity: 'fuel' } },
        { type: 'way', center: mid, tags: { building: 'parking' } },
      ],
    };
    const s = parseShelters(json, BO);
    expect(s.map((x) => x.name)).toEqual(['Parcheggio Centro', 'Eni']);
    expect(s[0].note).toBe('altezza max 2.1 m');
    expect(s[1].note).toBe('pensilina da verificare');
  });
});

describe('navUrl', () => {
  it('apre il navigatore scelto', () => {
    expect(navUrl('google', 44.5, 11.3)).toContain('google.com/maps/dir/?api=1&destination=44.50000,11.30000');
    expect(navUrl('waze', 44.5, 11.3)).toBe('https://waze.com/ul?ll=44.50000,11.30000&navigate=yes');
    expect(navUrl('apple', 44.5, 11.3)).toContain('maps.apple.com/?daddr=');
  });
});

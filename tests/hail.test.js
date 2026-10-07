import { describe, it, expect } from 'vitest';
import { assessHailRisk, shouldNotify, buildForecastUrl, fetchForecast, alertText, ALERT_COOLDOWN_MS } from '../src/hail.js';

const NOW = new Date('2026-07-15T14:05:00Z');
const H0 = Date.UTC(2026, 6, 15, 14) / 1000;

function forecast(hours, minutely) {
  const n = hours.length;
  const col = (k, d) => hours.map((h) => (h[k] === undefined ? d : h[k]));
  const data = {
    current: { temperature_2m: 27, weather_code: 3, wind_gusts_10m: 20 },
    hourly: {
      time: Array.from({ length: n }, (_, i) => H0 + i * 3600),
      weather_code: col('code', 1),
      precipitation_probability: col('prob', 5),
      precipitation: col('precip', 0),
      cape: col('cape', 100),
      lifted_index: col('li', 2),
      wind_gusts_10m: col('gust', 20),
      freezing_level_height: col('fl', 4000),
    },
  };
  if (minutely) {
    data.minutely_15 = {
      time: minutely.map((_, i) => H0 + i * 900),
      weather_code: minutely.map((m) => m.code),
      precipitation: minutely.map((m) => m.precip || 0),
    };
  }
  return data;
}

describe('assessHailRisk', () => {
  it('dà rischio nullo con tempo stabile', () => {
    const a = assessHailRisk(forecast([{}, {}, {}, {}]), NOW);
    expect(a.level).toBe(0);
    expect(a.firstEvent).toBeNull();
  });

  it('riconosce i codici grandine 96 e 99 che la versione 1.0 ignorava', () => {
    expect(assessHailRisk(forecast([{}, { code: 99 }, {}, {}]), NOW).level).toBe(3);
    expect(assessHailRisk(forecast([{}, { code: 96 }, {}, {}]), NOW).level).toBe(2);
    expect(assessHailRisk(forecast([{}, { code: 96, cape: 1200 }, {}, {}]), NOW).level).toBe(3);
  });

  it('alza il rischio con temporale, CAPE alto e zero termico basso', () => {
    const a = assessHailRisk(forecast([{}, { code: 95, cape: 2500, fl: 3000, gust: 75 }, {}, {}]), NOW);
    expect(a.level).toBe(3);
    expect(a.reasons.join(' ')).toMatch(/Zero termico basso/);
  });

  it('abbassa il rischio con zero termico molto alto', () => {
    const a = assessHailRisk(forecast([{}, { code: 95, cape: 900, fl: 4800 }, {}, {}]), NOW);
    expect(a.level).toBe(1);
  });

  it('usa lo zero termico delle ore di temporale, non il minimo di tutta la finestra', () => {
    const a = assessHailRisk(forecast([{ fl: 2800 }, { code: 95, cape: 900, fl: 4800 }, {}, {}]), NOW);
    expect(a.metrics.freezing).toBe(4800);
  });

  it('ignora le ore oltre le 3 ore', () => {
    const a = assessHailRisk(forecast([{}, {}, {}, {}, { code: 99 }]), NOW);
    expect(a.level).toBe(0);
  });

  it('indica l’orario del primo temporale dai dati a 15 minuti', () => {
    const minutely = Array.from({ length: 16 }, (_, i) => (i === 6 ? { code: 95, precip: 3 } : { code: 2 }));
    const a = assessHailRisk(forecast([{}, { code: 95, cape: 1000 }, {}, {}], minutely), NOW);
    expect(a.firstEvent).toBe((H0 + 6 * 900) * 1000);
    expect(a.timeline).toHaveLength(12);
    expect(a.timeline[0].time).toBe(H0 * 1000);
    expect(a.timeline[6].kind).toBe('temporale');
  });

  it('senza dati a 15 minuti costruisce la barra dalle ore', () => {
    const a = assessHailRisk(forecast([{}, { code: 96, precip: 12 }, {}, {}]), NOW);
    expect(a.timeline.slice(4, 8).every((s) => s.kind === 'grandine')).toBe(true);
    expect(a.timeline[0].kind).toBe('asciutto');
  });

  it('segnala instabilità senza temporale come rischio basso', () => {
    const a = assessHailRisk(forecast([{ prob: 70, cape: 1500 }, {}, {}, {}]), NOW);
    expect(a.level).toBe(1);
  });
});

describe('shouldNotify', () => {
  const a = (level) => ({ level });
  const t = 1_000_000_000_000;
  it('non avvisa sotto il livello moderato', () => {
    expect(shouldNotify(null, a(1), t)).toBe(false);
  });
  it('avvisa la prima volta e quando il livello sale', () => {
    expect(shouldNotify(null, a(2), t)).toBe(true);
    expect(shouldNotify({ level: 2, at: t }, a(3), t + 60_000)).toBe(true);
  });
  it('non ripete lo stesso avviso prima di 3 ore', () => {
    expect(shouldNotify({ level: 3, at: t }, a(3), t + 60_000)).toBe(false);
    expect(shouldNotify({ level: 3, at: t }, a(2), t + ALERT_COOLDOWN_MS)).toBe(true);
  });
});

describe('fetchForecast', () => {
  it('riprova senza le variabili opzionali se l’API risponde 400', async () => {
    const urls = [];
    const fake = async (u) => {
      urls.push(u);
      return urls.length === 1 ? { status: 400, ok: false } : { status: 200, ok: true, json: async () => ({ ok: 1 }) };
    };
    expect(await fetchForecast(44.457, 11.2, fake)).toEqual({ ok: 1 });
    expect(urls[0]).toContain('lifted_index');
    expect(urls[1]).not.toContain('lifted_index');
  });

  it('chiede codici meteo, zero termico e dati a 15 minuti', () => {
    const u = buildForecastUrl(44.457, 11.2);
    expect(u).toContain('freezing_level_height');
    expect(u).toContain('minutely_15=weather_code,precipitation');
    expect(u).toContain('timeformat=unixtime');
  });
});

describe('alertText', () => {
  it('scrive un avviso leggibile', () => {
    const a = assessHailRisk(forecast([{}, { code: 99 }, {}, {}]), NOW);
    const t = alertText(a, 'Monte San Pietro');
    expect(t.title).toBe('Rischio alto di grandine a Monte San Pietro');
    expect(t.body).toMatch(/grandine forte/);
  });
});

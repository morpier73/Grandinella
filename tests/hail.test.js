import { describe, it, expect } from 'vitest';
import {
  assessHailRisk,
  shouldNotify,
  buildForecastUrl,
  fetchForecast,
  alertText,
  planNextCheck,
  isCheckDue,
  nextAlertState,
  ALERT_COOLDOWN_MS,
} from '../src/hail.js';

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
  const a = (level, firstEvent = null) => ({ level, firstEvent });
  const t = 1_000_000_000_000;
  it('non avvisa sotto il livello moderato', () => {
    expect(shouldNotify(null, a(1), t)).toBe(false);
  });
  it('avvisa la prima volta e quando il livello sale', () => {
    expect(shouldNotify(null, a(2), t)).toBe('nuovo');
    expect(shouldNotify({ level: 2, at: t }, a(3), t + 60_000)).toBe('aumento');
  });
  it('non ripete lo stesso avviso prima di 3 ore', () => {
    expect(shouldNotify({ level: 3, at: t }, a(3), t + 60_000)).toBe(false);
    expect(shouldNotify({ level: 3, at: t }, a(2), t + ALERT_COOLDOWN_MS)).toBe('promemoria');
  });
  it('riavvisa una volta quando il temporale è entro 30 minuti', () => {
    const prev = { level: 3, at: t, imminent: false };
    expect(shouldNotify(prev, a(3, t + 20 * 60_000), t + 60_000)).toBe('imminente');
    expect(shouldNotify({ ...prev, imminent: true }, a(3, t + 10 * 60_000), t + 120_000)).toBe(false);
  });
});

describe('nextAlertState', () => {
  const t = 1_000_000_000_000;
  it('azzera il segno imminente quando il temporale non è più vicino', () => {
    const prev = { level: 3, at: t, imminent: true };
    expect(nextAlertState(prev, { level: 1, firstEvent: null }, false, t + 3600_000).imminent).toBe(false);
    expect(nextAlertState(prev, { level: 3, firstEvent: t + 3600_000 }, false, t + 3600_000)).toBe(prev);
  });
  it('salva lo stato quando parte una notifica', () => {
    const s = nextAlertState(null, { level: 2, firstEvent: t + 10 * 60_000 }, 'nuovo', t);
    expect(s).toEqual({ at: t, level: 2, imminent: true });
  });
});

describe('planNextCheck', () => {
  const t = 1_000_000_000_000;
  const a = (level, firstEvent = null) => ({ level, firstEvent });
  it('allunga o accorcia l’intervallo in base al rischio', () => {
    expect(planNextCheck(null, a(0), t).nextAt - t).toBe(3 * 3600_000);
    expect(planNextCheck(null, a(1), t).nextAt - t).toBe(3600_000);
    expect(planNextCheck(null, a(2), t).nextAt - t).toBe(30 * 60_000);
    expect(planNextCheck(null, a(3), t).nextAt - t).toBe(15 * 60_000);
  });
  it('con rischio nullo scarica meno dati', () => {
    expect(planNextCheck(null, a(0), t).detail).toBe('light');
    expect(planNextCheck(null, a(1), t).detail).toBe('full');
  });
  it('ricontrolla entro 15 minuti se il temporale è previsto entro un’ora', () => {
    expect(planNextCheck(null, a(1, t + 50 * 60_000), t).nextAt - t).toBe(15 * 60_000);
  });
  it('scende di livello solo dopo due controlli più bassi', () => {
    const p1 = planNextCheck(null, a(3), t);
    const p2 = planNextCheck(p1, a(0), t);
    expect(p2.level).toBe(3);
    const p3 = planNextCheck(p2, a(0), t);
    expect(p3.level).toBe(0);
    expect(p3.nextAt - t).toBe(3 * 3600_000);
  });
  it('un controllo tornato alto azzera il conteggio', () => {
    const p2 = planNextCheck(planNextCheck(null, a(3), t), a(1), t);
    const p3 = planNextCheck(p2, a(3), t);
    expect(p3.lowerStreak).toBe(0);
    expect(planNextCheck(p3, a(1), t).level).toBe(3);
  });
  it('salta i risvegli prima dell’ora prevista', () => {
    const plan = planNextCheck(null, a(0), t);
    expect(isCheckDue(plan, t + 60 * 60_000)).toBe(false);
    expect(isCheckDue(plan, plan.nextAt - 30_000)).toBe(true);
    expect(isCheckDue(null, t)).toBe(true);
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

  it('con rischio nullo chiede solo i dati orari essenziali', () => {
    const u = buildForecastUrl(44.457, 11.2, true, 'light');
    expect(u).not.toContain('minutely_15');
    expect(u).not.toContain('700hPa');
    expect(u).toContain('forecast_hours=4');
  });

  it('chiede codici meteo, zero termico e dati a 15 minuti', () => {
    const u = buildForecastUrl(44.457, 11.2);
    expect(u).toContain('freezing_level_height');
    expect(u).toContain('minutely_15=weather_code,precipitation');
    expect(u).toContain('timeformat=unixtime');
    expect(u).toContain('wind_direction_500hPa');
  });
});

describe('alertText', () => {
  it('scrive un avviso leggibile', () => {
    const a = assessHailRisk(forecast([{}, { code: 99 }, {}, {}]), NOW);
    const t = alertText(a, 'Monte San Pietro');
    expect(t.title).toBe('Rischio alto di grandine a Monte San Pietro');
    expect(t.body).toMatch(/grandine forte/);
  });

  it('parla dell’auto quando è parcheggiata', () => {
    const a = assessHailRisk(forecast([{}, { code: 99 }, {}, {}]), NOW);
    const t = alertText(a, '', { car: true, reason: 'imminente' });
    expect(t.title).toBe('Grandine in arrivo dove hai lasciato l’auto'.replace('’', "'"));
    expect(t.body).toMatch(/parcheggio coperto/);
  });
});

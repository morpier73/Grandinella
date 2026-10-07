// Gira fuori dalla WebView, lanciato dal sistema circa ogni 15 minuti
// (WorkManager su Android, BGTaskScheduler su iOS). Le funzioni di
// hail.js vengono incollate sopra questo file dallo script di build.

function kvGet(key) {
  try {
    const r = CapacitorKV.get(key);
    return r && r.value ? JSON.parse(r.value) : null;
  } catch (e) {
    return null;
  }
}

function kvSet(key, value) {
  CapacitorKV.set(key, JSON.stringify(value));
}

async function currentLocation(settings) {
  if (settings && settings.followGps) {
    try {
      let p = CapacitorGeolocation.getCurrentPosition();
      if (p && typeof p.then === 'function') p = await p;
      if (p && typeof p.latitude === 'number') {
        const saved = kvGet('location');
        // Il nome salvato vale solo se si è ancora più o meno lì (circa 5 km).
        const near = saved && Math.abs(saved.lat - p.latitude) < 0.05 && Math.abs(saved.lon - p.longitude) < 0.07;
        return { lat: p.latitude, lon: p.longitude, name: near ? saved.name : '' };
      }
    } catch (e) {
      // Senza permesso di posizione in background si usa l'ultima salvata.
    }
  }
  return kvGet('location');
}

addEventListener('checkHail', async (resolve, reject) => {
  try {
    const settings = kvGet('settings') || { alerts: false };
    if (!settings.alerts) return resolve();
    const loc = await currentLocation(settings);
    if (!loc) return resolve();

    const data = await fetchForecast(loc.lat, loc.lon);
    const now = Date.now();
    const assessment = assessHailRisk(data, new Date(now));
    kvSet('lastCheck', { at: now, level: assessment.level, place: loc.name || '' });

    const previous = kvGet('lastAlert');
    if (shouldNotify(previous, assessment, now)) {
      const text = alertText(assessment, loc.name);
      CapacitorNotifications.schedule([
        {
          id: 1000 + assessment.level,
          title: text.title,
          body: text.body,
          channelId: 'grandine',
          autoCancel: true,
        },
      ]);
      kvSet('lastAlert', { at: now, level: assessment.level });
    }
    resolve();
  } catch (e) {
    kvSet('lastError', { at: Date.now(), message: String(e && e.message ? e.message : e) });
    reject(e);
  }
});

// Chiamati dall'app per passare posizione e impostazioni al runner.
addEventListener('saveState', (resolve, reject, args) => {
  try {
    if (args && args.location) kvSet('location', args.location);
    if (args && args.settings) kvSet('settings', args.settings);
    resolve();
  } catch (e) {
    reject(e);
  }
});

addEventListener('getStatus', (resolve) => {
  resolve({
    lastCheck: kvGet('lastCheck'),
    lastAlert: kvGet('lastAlert'),
    lastError: kvGet('lastError'),
  });
});

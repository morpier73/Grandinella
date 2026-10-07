# Grandinella

Allerta grandine per Android e iOS. Stima il rischio di grandine nelle prossime 3 ore dove ti trovi
e manda una notifica, anche ad app chiusa, quando il rischio è moderato o alto.

Nasce dalla versione 1.0 di Antonio, riscritta per correggerne i difetti principali.

## Novità della 1.2

- **Pensata per l'auto.** Con "Ho parcheggiato qui" gli avvisi seguono l'auto anche quando sei altrove.
- **Controlli che si adattano al rischio.** Ogni 3 ore con rischio nullo, ogni ora con rischio basso,
  ogni 30 minuti con rischio moderato, ogni 15 minuti con rischio alto o temporale entro un'ora.
  Con rischio nullo si scarica solo un pacchetto ridotto di dati.
- **Avviso "grandine in arrivo"** quando il temporale è previsto entro 30 minuti.
- **Riparo coperto prima di tutto.** Parcheggi multipiano o sotterranei e distributori vicini da
  OpenStreetMap, con il tasto per aprirli nel navigatore.
- **Direzione dei temporali e direzione consigliata** (da 8 punti a 15 km), solo come stima e mai
  verso il temporale o lungo il suo percorso.
- **Navigatore preferito** nelle impostazioni: Google Maps, Waze o Mappe di Apple.
- **Crediti.** Grandinella è proprietà intellettuale di Antonio Rosetti, indicato nelle impostazioni.

## Cosa cambia rispetto alla 1.0

- **Notifiche vere.** La 1.0 chiedeva il permesso ma non inviava mai nulla. Ora un controllo in
  background (WorkManager su Android, BGTaskScheduler su iOS) gira circa ogni 15 minuti e avvisa.
- **Grandine riconosciuta.** I codici meteo 96 e 99 di Open-Meteo ("temporale con grandine") prima
  erano trattati come un temporale qualsiasi.
- **Zero termico usato.** Veniva scaricato e mai letto. Ora uno zero termico basso alza il rischio e
  uno molto alto lo abbassa.
- **Niente precisione finta.** Al posto di una percentuale inventata ci sono quattro livelli (nessuno,
  basso, moderato, alto) con l'elenco dei motivi, e la barra delle 3 ore usa i dati reali a 15 minuti.
- **Posizione scelta da te.** GPS oppure ricerca del comune; non più un luogo fisso.
- **Build pulite.** Niente accesso universale ai file dalla WebView, niente traffico in chiaro,
  build release al posto della debug.

## Come si calcola il rischio

La logica è in [`src/hail.js`](src/hail.js) ed è coperta dai test in [`tests/`](tests).

| Livello | Quando |
| --- | --- |
| Alto | Il modello prevede grandine forte (99), oppure grandine (96) con atmosfera instabile, oppure temporale con CAPE ≥ 2000 J/kg e zero termico non troppo alto |
| Moderato | Grandine prevista (96), oppure temporale con instabilità moderata |
| Basso | Temporale debole, oppure atmosfera instabile con rovesci probabili |
| Nessuno | Nessun segnale convettivo nelle prossime 3 ore |

È una stima basata sui modelli numerici, non un radar: non sostituisce le allerte ufficiali.

## Sviluppo

```bash
npm install
npm test          # test della logica del rischio
npm run dev       # versione web in locale
npm run sync      # build web + copia nei progetti android/ e ios/
```

Android Studio apre `android/`, Xcode apre `ios/App/App.xcodeproj`.

## Build automatiche

A ogni push su `main`, GitHub Actions ([`build.yml`](.github/workflows/build.yml)) esegue i test e
pubblica nella release **ultima**:

- `Grandinella-Android.apk`, da installare direttamente sul telefono;
- `Grandinella-iOS-unsigned.ipa`, non firmato.

### Firma Android

Senza configurazione l'APK è firmato con `android/app/grandinella-sideload.keystore`, inclusa nel
repository apposta: così ogni nuova build si installa sopra la precedente. Va bene per uso
personale, non per il Play Store. Per una chiave definitiva aggiungi questi secrets al repository:
`GRANDINELLA_KEYSTORE_BASE64`, `GRANDINELLA_KEYSTORE_PASSWORD`, `GRANDINELLA_KEY_ALIAS`,
`GRANDINELLA_KEY_PASSWORD`.

L'APK 1.0 era firmato con un'altra chiave: prima di installare questa versione va disinstallata.

### iOS

Un iPhone installa solo app firmate da Apple. L'IPA non firmato si può installare con
[Sideloadly](https://sideloadly.io) e un Apple ID gratuito (l'app scade dopo 7 giorni e va
reinstallata). Per un'installazione stabile, TestFlight o l'App Store serve l'Apple Developer
Program (99 $/anno); a quel punto si aggiunge la firma al workflow.

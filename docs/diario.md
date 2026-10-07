# Diario di Grandinella

Diario del progetto, dal più recente al più vecchio. Ogni voce dice cosa è stato fatto, cosa è
stato deciso e cosa resta aperto. Il codice sta su GitHub: https://github.com/morpier73/Grandinella
(le app pronte sono nella release "ultima").

Grandinella è proprietà intellettuale di Antonio Rosetti.

---

## 2026-10-07 · Versione 1.2

**Fatto**
- Controlli in background che si adattano al rischio: ogni 3 ore con rischio nullo, ogni ora con
  rischio basso, ogni 30 minuti moderato, ogni 15 minuti alto o con temporale entro un'ora. Il
  livello scende solo dopo due controlli più bassi, per non oscillare.
- Con rischio nullo l'app scarica solo i dati essenziali (meno rete, meno memoria).
- Posizione dell'auto: tasto "Ho parcheggiato qui". Gli avvisi seguono l'auto anche se Pietro è altrove.
- Nuovo avviso "Grandine in arrivo" quando il temporale è previsto entro 30 minuti.
- Pannello "Cosa fare con l'auto": da dove arrivano i temporali, verso dove vanno, e una direzione
  consigliata solo se è chiaramente più sicura. Se il temporale è vicino consiglia il riparo.
- "Trova un riparo coperto": parcheggi multipiano o sotterranei e distributori vicini
  (OpenStreetMap), con tasto "Vai" verso il navigatore.
- Impostazioni: navigatore preferito (Google Maps, Waze, Mappe di Apple), GPS, frequenza controlli
  e la riga "Grandinella · proprietà intellettuale di Antonio Rosetti" (visibile solo lì).
- 39 test automatici passati, schermata verificata con dati simulati, codice caricato su GitHub.

**Deciso**
- Prima il riparo coperto, poi la direzione: guidare sotto la grandine è peggio che restare fermi.
- Mai una direzione verso il temporale o lungo il suo percorso.

**Aperto**
- Monitoraggio intenso ogni 5 minuti: ha senso solo con il radar della Protezione Civile, perché i
  modelli meteo non cambiano così spesso. Da decidere con Pietro.
- Prova su un telefono vero della 1.2.

## 2026-10-07 · Analisi, confronto e report

- Analisi franca della 1.0 di Antonio: le notifiche non partivano mai, la grandine (codici 96 e 99)
  non era riconosciuta, lo zero termico era scaricato ma non usato, la percentuale era inventata.
- Confronto con altre app e possibili altri modelli meteo: vedi confronto-e-spunti.md.
- Report su controlli adattivi, direzione di fuga e protezione dell'auto: vedi
  report-controlli-adattivi-e-fuga.md. Pietro ha approvato e chiesto di procedere.

## 2026-10-07 · Versione 1.1

- Riscritta da zero con Capacitor: una sola base di codice per Android e iOS.
- Notifiche in background vere, quattro livelli di rischio con i motivi, barra delle prossime 3 ore,
  ricerca del comune o GPS.
- Build automatiche su GitHub Actions: APK firmato per l'installazione diretta e IPA non firmato
  (si installa con Sideloadly finché non c'è un account Apple Developer).
- Il file IPA si installa solo su iPhone: sul telefono Android serve l'APK.

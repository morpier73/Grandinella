# Grandinella: controlli adattivi, consumo e direzione di fuga

*Report di progetto, 7 ottobre 2026. Nessuna modifica è stata ancora fatta al codice.*

## 1. Cosa hai chiesto

1. L'app deve usare **poca memoria** e poca batteria.
2. Deve **controllare più spesso quando il rischio sale**: per esempio ogni 3 ore con rischio minimo, sempre più spesso man mano che aumenta.
3. Deve indicare **la direzione da prendere per non essere presi in pieno** e aprire il **navigatore preferito** (Google Maps, Waze, Apple Mappe) verso un punto sicuro.

## 2. Cosa permettono davvero i telefoni

| | Android | iPhone |
| --- | --- | --- |
| Intervallo minimo in background | **15 minuti** (WorkManager); il sistema può ritardarlo se il telefono è in risparmio energetico | **Lo decide iOS**, in base a quanto usi l'app: può essere 15 minuti come diverse ore |
| Controlli più fitti di 15 minuti | Solo con un **servizio in primo piano**, che mostra una notifica fissa ("Grandinella sta monitorando") | Non possibili senza un server che mandi notifiche push silenziose, e quindi senza un account Apple Developer |
| Posizione ad app chiusa | Serve il permesso "Consenti sempre", che va chiesto a parte | Serve "Sempre", e iOS lo ricorda periodicamente all'utente |

**Conseguenza:** su Android lo schema che chiedi si può fare quasi tutto. Su iPhone l'app può solo *chiedere* controlli più frequenti: non c'è garanzia, va detto chiaramente nell'app.

## 3. Controlli adattivi

### Schema proposto

| Livello attuale | Prossimo controllo | Dati scaricati |
| --- | --- | --- |
| Nessuno | ogni **3 ore** | solo dati orari, 6 variabili (circa 3 KB) |
| Basso | ogni **1 ora** | orari + dati a 15 minuti |
| Moderato | ogni **30 minuti** | come sopra + punti intorno (vedi §5) |
| Alto | ogni **15 minuti** (il minimo di Android) | come sopra |
| Alto, con "monitoraggio intenso" attivato dall'utente (solo Android) | ogni **5 minuti** per al massimo 2 ore, poi si spegne da solo | come sopra |

Due regole in più:
- **Anticipo:** se il modello prevede l'inizio del temporale tra meno di 1 ora, il controllo successivo si fa comunque entro 15 minuti, anche se il livello attuale è basso.
- **Rientro graduale:** quando il rischio scende, si torna allo schema più lento solo dopo **2 controlli consecutivi** più bassi, per non "addormentarsi" tra una cella e l'altra.

### Come si realizza

Il sistema sveglia l'app ogni 15 minuti, ma a ogni risveglio l'app **controlla prima l'ora del prossimo controllo dovuto** e, se non è ancora il momento, si chiude subito: nessuna richiesta in rete, un'operazione di pochi millisecondi. Così bastano i meccanismi già presenti, senza servizi aggiuntivi.

- Si salva `prossimoControllo` (data e ora) nella memoria del controllo in background.
- La logica che calcola l'intervallo va nel modulo testato (`src/hail.js`), con i test per ogni livello e per le due regole qui sopra.
- Il "monitoraggio intenso" ogni 5 minuti richiede su Android un servizio in primo piano scritto in nativo (Java/Kotlin). È il pezzo più costoso: propongo di farlo **dopo**, solo se serve.

## 4. Memoria e batteria

Situazione attuale e interventi:

| Punto | Oggi | Correzione |
| --- | --- | --- |
| Dimensione dell'APK | 11 MB, quasi tutto il motore Capacitor | Attivare la riduzione del codice (R8/minify) in release: stima 5–7 MB, da verificare con la build |
| Dati per controllo | sempre 8 variabili orarie + 15 minuti per 5 ore | Scaricare solo quello che serve al livello (tabella §3); con rischio nullo bastano 6 variabili per 4 ore |
| Controlli con app aperta | ogni 10 minuti anche con rischio nullo | Stesso schema adattivo anche ad app aperta |
| Ricerca comuni | una richiesta ogni lettera digitata (dopo 350 ms) | Già limitata; partire da 3 lettere invece di 2 |
| Radar (proposta precedente) | — | **Non** elaborare le immagini radar sul telefono: un piccolo servizio esterno deve restituire solo i numeri del punto. È la parte che peserebbe di più su memoria e batteria |

Con lo schema adattivo, in una giornata serena l'app fa **8 richieste al giorno** invece di circa 96: molta meno batteria e molto meno traffico. Il limite gratuito di Open-Meteo (uso non commerciale) resta lontanissimo.

## 5. Direzione di fuga

### Da dove arriva il temporale

Per dire "spostati verso…" servono due informazioni: **dove sono le celle** e **dove si muovono**.

1. **Direzione di movimento:** i temporali si muovono più o meno con il vento in quota. Open-Meteo fornisce il vento a 700 e 500 hPa (circa 3 e 5,5 km di quota); la media dei due dà la direzione e la velocità di spostamento della cella. È una stima, ma è il metodo usato normalmente.
2. **Dove è più forte:** Open-Meteo accetta **più coordinate nella stessa richiesta**. Si chiede il rischio anche per **8 punti a circa 15 km** intorno (N, NE, E, SE, S, SO, O, NO). Il calcolo è lo stesso di oggi, ripetuto 9 volte: una sola richiesta.
3. **In futuro, con il radar:** la posizione reale della cella dal radar della Protezione Civile sostituisce la stima dei modelli (vedi il report di confronto).

### Come si sceglie la direzione

- Si scartano le direzioni da cui arriva il temporale e quelle verso cui va.
- Tra le restanti si sceglie quella con il rischio più basso, preferendo le **direzioni di lato** rispetto al percorso della cella: allontanarsi di lato è più rapido che scappare davanti.
- Se tutte le direzioni hanno rischio simile, o se la cella è a meno di 10–15 minuti, l'app **non suggerisce di partire** ma di **cercare un riparo vicino**.

### Riparo invece di fuga

Spesso la cosa più sicura non è guidare ma mettere l'auto al coperto. I ripari si trovano gratis da OpenStreetMap (servizio Overpass): parcheggi multipiano e sotterranei, distributori con pensilina, centri commerciali con parcheggio coperto. L'app mostra i 3 più vicini con la distanza.

### Navigatore preferito

Nelle impostazioni l'utente sceglie il navigatore; il pulsante apre direttamente la navigazione verso il punto sicuro o il riparo:

| Navigatore | Link |
| --- | --- |
| Google Maps | `https://www.google.com/maps/dir/?api=1&destination=LAT,LON&travelmode=driving` |
| Waze | `https://waze.com/ul?ll=LAT,LON&navigate=yes` |
| Apple Mappe (solo iPhone) | `https://maps.apple.com/?daddr=LAT,LON&dirflg=d` |

Il punto di destinazione è quello a circa 15 km nella direzione scelta, oppure il riparo.

### Cosa deve apparire nell'app

> **Rischio alto · temporale da ovest, si muove verso est a circa 35 km/h**
> Direzione consigliata: **sud**, circa 15 km. [Apri in Waze]
> Oppure riparati: Parcheggio coperto Via Roma, 1,2 km. [Apri in Waze]
> *Stima dai modelli meteo, non dal radar. Non metterti in viaggio sotto la grandine: se è già vicina, fermati al coperto.*

La notifica di rischio alto può portare lo stesso pulsante.

### Pensata per proteggere l'auto

Chi usa Grandinella lo fa soprattutto per salvare la macchina. Questo cambia le priorità:
- **Posizione dell'auto separata dalla tua.** Un pulsante "Ho parcheggiato qui" salva dove sta l'auto. Gli avvisi valgono per l'auto anche se tu sei in ufficio o a casa: "Grandine prevista verso le 16:40 dove hai lasciato l'auto".
- **Il riparo viene prima della fuga.** L'azione principale è "porta l'auto al coperto": il parcheggio coperto più vicino all'auto, con il pulsante del navigatore. La direzione di fuga resta per chi è già in viaggio e ha tempo.
- **Preavviso utile, non solo allarme.** Per spostare l'auto servono 15–30 minuti, quindi l'avviso di rischio moderato deve arrivare **almeno 1 ora prima** dell'orario previsto, con il riparo già indicato.
- **Ripari pensati per l'auto:** parcheggi multipiano e sotterranei, autorimesse, distributori con pensilina, parcheggi coperti dei centri commerciali (con l'avviso di controllare orari e altezza massima).

## 6. Avvertenze di sicurezza (da non togliere)

- Il suggerimento è una **stima**, e va scritto ogni volta.
- **Mai** suggerire di partire se la cella è già vicina o se sta grandinando nel punto: in quel caso solo il riparo.
- Niente indicazioni durante la guida oltre al pulsante del navigatore, che fa il resto.
- Restano visibili i collegamenti alle allerte ufficiali (Protezione Civile, Allerta Meteo Emilia-Romagna).

## 7. Correzioni da fare in ogni caso

1. **Attribuzione Open-Meteo** con link nell'app (richiesta dalla licenza).
2. **Posizione in background su Android:** oggi il controllo usa l'ultima posizione salvata, perché manca il permesso "Consenti sempre". Va chiesto in modo esplicito, solo se l'utente attiva "Segui la mia posizione".
3. **Avviso che si avvicina:** oggi, se il livello resta "alto", l'app non riavvisa per 3 ore. Deve riavvisare anche quando l'orario previsto si avvicina (per esempio sotto i 30 minuti).
4. **iPhone:** spiegare nell'app che iOS decide quando controllare, e che con l'app aperta i dati sono sempre aggiornati.
5. **Riduzione del codice in release** (R8) per un APK più leggero.
6. **Test** per ogni nuova regola (intervalli, rientro graduale, scelta della direzione, casi "solo riparo").

## 8. Ordine di lavoro proposto

| Passo | Contenuto | Dove funziona |
| --- | --- | --- |
| 1 | Controlli adattivi (3 h → 15 min), dati ridotti per livello, correzioni 1, 3, 4, 5 | Android e iPhone (su iPhone con i limiti di iOS) |
| 2 | "Ho parcheggiato qui" e avvisi sulla posizione dell'auto, ripari coperti da OpenStreetMap con pulsante navigatore, scelta del navigatore nelle impostazioni | Entrambi |
| 3 | Direzione di movimento, 8 punti intorno e direzione consigliata per chi è in viaggio | Entrambi |
| 4 | Monitoraggio intenso ogni 5 minuti con notifica fissa | Solo Android |
| 5 | Radar della Protezione Civile al posto della stima dei modelli | Entrambi, con un piccolo servizio esterno |

## 9. Decisioni che servono da te

1. Gli intervalli della tabella §3 (3 h / 1 h / 30 min / 15 min) vanno bene così?
2. Vuoi il **monitoraggio intenso** ogni 5 minuti su Android, accettando la notifica fissa durante l'allerta?
3. ~~Prima il riparo o prima la direzione?~~ Deciso: **prima il riparo per l'auto**, perché l'app serve a proteggere la macchina. La direzione resta per chi è in viaggio.

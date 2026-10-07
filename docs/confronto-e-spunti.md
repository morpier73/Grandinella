# Grandinella: confronto con altre app e spunti

*7 ottobre 2026*

## In sintesi

Grandinella oggi lavora solo su **previsioni dei modelli** (Open-Meteo): dice se nelle prossime 3 ore ci sono le condizioni per la grandine. Le app migliori fanno un'altra cosa in più: guardano il **radar**, cioè la grandine che c'è davvero adesso e dove si sta muovendo. È questo il salto di qualità da fare, e i dati radar italiani sono pubblici e gratuiti.

## Le app con cui confrontarsi

| App | Da dove prende i dati | Cosa fa meglio di Grandinella | Cosa fa peggio |
| --- | --- | --- | --- |
| **Grandinometro** (Italia, gratuita, Android e iOS) | Radar della Protezione Civile ogni 5 minuti + segnalazioni degli utenti | Avvisa sulla grandine reale vicina (raggio 2–50 km), fino a 3 luoghi, soglia di probabilità, silenzio notturno, mappa dei ripari (parcheggi coperti, pensiline), foto degli utenti | Non guarda le previsioni oltre il radar; il preavviso dichiarato (26 minuti) è una stima del creatore |
| **Radar-DPC** (Protezione Civile, sito web) | Radar nazionale, pluviometri, satellite, fulmini | Dati ufficiali aggiornati ogni 5 minuti | Nessuna notifica, solo da browser |
| **Allerta Meteo Emilia-Romagna / allertaLOM** | Bollettini regionali | Allerte ufficiali per zona | Livelli giornalieri, non dicono "tra 20 minuti grandina qui" |
| **Meteo Aeronautica Militare** | Servizio meteo nazionale | Notifiche push per fenomeni intensi in corso | Previsioni a 3 ore, non specifiche sulla grandine |
| **MeteoSvizzera** | Radar svizzeri, modello ICON-CH | Mappe della grandine molto buone, anche sul nord Italia | La ricerca del luogo funziona solo in Svizzera |
| **Yr / Windy / Meteoblue** | Modelli globali ed europei | Mappe, più modelli a confronto | Generici: niente allerta grandine sul tuo punto |

## Cosa c'è di buono in Grandinella

- Unisce più ingredienti dei modelli (codici grandine, CAPE, indice di sollevamento, zero termico, raffiche) e spiega il perché.
- Notifiche in background con soglia e anti-ripetizione.
- Guarda **avanti di 3 ore**: il radar da solo dà al massimo 20–40 minuti di preavviso.

## Cosa manca, in ordine di importanza

1. **Radar in tempo reale.** È la differenza principale con Grandinometro. Senza radar l'app può dare "rischio alto" con il cielo sereno, oppure non vedere un temporale che il modello ha sbagliato.
2. **Più luoghi** (casa, lavoro, orto, dove sta l'auto) e un **raggio** regolabile.
3. **Silenzio notturno** e scelta dei fenomeni (solo grandine, anche pioggia forte, vento).
4. **Confronto tra modelli**: oggi si usa un solo modello ("best match"); quando due modelli concordano, la stima è più affidabile.
5. **Allerte ufficiali** dentro l'app, non solo un link.
6. **Attribuzione di Open-Meteo**: la licenza (CC BY 4.0) chiede di citare la fonte con un link, va aggiunta.

## Fonti di dati da integrare

### 1. Radar della Protezione Civile: la priorità
L'API pubblica `https://radar-api.protezionecivile.it/` (documentazione su [dpc-radar.readthedocs.io](https://dpc-radar.readthedocs.io/it/radar_v2/api.html)) offre, tra gli altri, questi prodotti:
- **POH** (*Probability of Hail*, probabilità di grandine stimata dal radar), lo stesso concetto della "zona a rischio grandine" di Grandinometro;
- **VMI** (riflettività massima, ogni 5 minuti) e **SRI** (intensità di pioggia al suolo);
- **VIL** ed **ETM** (contenuto d'acqua della colonna e altezza degli echi), utili come conferma.

Non serve una chiave, solo un'intestazione `origin`, e i file arrivano come immagini georeferenziate (.tif). Da qui non sono riuscito a raggiungerla, quindi formato e frequenza del prodotto POH vanno verificati con la prima prova. La pagina non indica la licenza: prima di pubblicare l'app va chiesta o verificata.

**Come usarla:** leggere il valore di POH e VMI nel punto dell'utente e in un cerchio intorno, poi confrontare due immagini a 5–10 minuti di distanza per stimare **direzione e velocità** della cella ("grandine a 12 km, si muove verso di te, arrivo stimato tra 20–30 minuti").

**Attenzione:** leggere un .tif sul telefono ogni 15 minuti è pesante. La soluzione pulita è un piccolo servizio gratuito (per esempio una funzione su Cloudflare o un'Action programmata) che legge il radar e restituisce all'app solo i numeri del punto. Per una prima versione si può leggere solo un ritaglio attorno alla posizione.

### 2. Modelli ad alta risoluzione su Open-Meteo: facile, stessa API
Già usabili con il parametro `models=` e senza costi:
- **ICON-2I di ItaliaMeteo/ARPAE** (`italia_meteo_arpae_icon_2i`): modello italiano a 2 km, 3 giorni, aggiornato ogni 12 ore, con CAPE, potenziale fulmini e zero termico ([documentazione](https://open-meteo.com/en/docs/italia-meteo-arpae-api)). È il modello di riferimento in Italia.
- **ICON-D2 del servizio meteo tedesco**: 2 km, l'unico con dati **nativi a 15 minuti** in Europa; copre il nord Italia (Bologna compresa).
- **MeteoSwiss ICON-CH1/CH2**: 1–2 km sull'Europa centrale; va verificato quanto scende verso sud.
- **API Ensemble** di Open-Meteo: decine di varianti dello stesso modello, da cui ricavare una vera probabilità ("8 scenari su 20 danno temporale").

**Come usarli:** chiedere 2–3 modelli in una sola richiesta e mostrare l'**accordo**: se ICON-2I e ICON-D2 vedono entrambi un temporale con CAPE alto, il livello sale; se uno solo, resta più basso e l'app lo dice ("i modelli non sono d'accordo").

### 3. Fulmini
**Blitzortung** è una rete di volontari con mappa in tempo reale; per usare i loro dati in un'app bisogna chiedere il permesso sul loro forum, e le condizioni non le ho potute verificare. I fulmini vicini sono un ottimo segnale che una cella è attiva.

### 4. Allerte ufficiali
**Meteoalarm** raccoglie le allerte dei servizi europei, anche dell'Italia, in formato CAP. Mostrarle nell'app ("allerta arancione temporali per la tua zona") dà credibilità e non costa nulla.

### 5. Segnalazioni degli utenti (in futuro)
È la forza di Grandinometro, ma richiede un server, moderazione e molti utenti per funzionare. Per un'app di famiglia non vale la pena all'inizio.

## Proposta di lavoro

| Fase | Cosa | Impegno |
| --- | --- | --- |
| 1 | Attribuzione Open-Meteo, ICON-2I + ICON-D2 a confronto con indicatore di accordo, più luoghi, silenzio notturno | Piccolo, nessun server |
| 2 | Radar DPC: POH e VMI nel punto e nel raggio, distanza e direzione della cella, notifica "grandine osservata vicino a te" | Medio, con un piccolo servizio di appoggio |
| 3 | Fulmini (con permesso Blitzortung) e allerte Meteoalarm | Medio |
| 4 | Segnalazioni degli utenti e mappa dei ripari | Grande, solo se l'app si diffonde |

La fase 1 si può fare subito. La fase 2 è quella che trasforma Grandinella da "previsione" ad "allerta vera".

## Fonti
- [Grandinometro su TuttoAndroid](https://www.tuttoandroid.net/news/2026/09/09/grandinometro-app-android-meteo-maltempo-1171683/) · [su Napolike](https://www.napolike.it/grandinometro-app-avvisa-prima-grandine) · [su Autoblog](https://www.autoblog.it/post/grandinometro-lapp-italiana-che-avvisa-se-sta-grandinando-vicino-alla-tua-auto)
- [Quotidiano Motori: radar DPC e app per la grandine](https://www.quotidianomotori.com/automobili/radar-dpc-app-meteo-grandine-anticipo-auto/)
- [API radar DPC](https://dpc-radar.readthedocs.io/it/radar_v2/api.html) · [Piattaforma Radar-DPC](https://mappe.protezionecivile.gov.it/en/risks-maps-and-dashboards/radar-map/)
- [Open-Meteo ICON-2I](https://open-meteo.com/en/docs/italia-meteo-arpae-api) · [Open-Meteo MeteoSwiss](https://open-meteo.com/en/docs/meteoswiss-api) · [Dati a 15 minuti](https://openmeteo.substack.com/p/sub-hourly-15-minutely-weather-forecasts) · [API Ensemble](https://open-meteo.com/en/docs/ensemble-api)
- [MeteoSvizzera app](https://www.meteoswiss.admin.ch/services-and-publications/service/weather-and-climate-products/meteoswiss-app.html)
- [Forum Blitzortung: uso dei dati in app gratuite](https://forum.blitzortung.org/showthread.php?tid=4247)
- [MeteoAlarm (pacchetto per i feed)](https://meteoalarm.readthedocs.io)

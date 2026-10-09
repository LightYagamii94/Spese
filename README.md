# Le mie spese

Web app per registrare le spese personali. I dati restano solo sul tuo dispositivo.

## Dove finiscono i dati

- **Nessun server.** L'app è fatta solo di file statici (`index.html`, `app.js`, `style.css`). Le spese vengono salvate nel browser (localStorage) e non vengono mai inviate da nessuna parte.
- **Nessuna connessione esterna.** Una Content Security Policy blocca qualsiasi richiesta verso altri siti (niente analytics, CDN o font esterni); l'unica richiesta che la pagina fa è `version.json`, sullo stesso sito, per sapere se c'è un aggiornamento.
- **Nessuna password.** Chiunque usi il tuo browser sul tuo dispositivo può aprire l'app e vedere le spese, ma nessun altro via Internet.

## Sezioni

- **Movimenti**: in cima si sceglie il tipo di movimento.
  - **Spesa**: collegata a una sotto area e, se vuoi, al conto con cui è stata pagata (descrizione facoltativa).
  - **Entrata**: soldi in arrivo su un conto (es. stipendio); il saldo del conto sale da solo.
  - **Trasferimento**: soldi spostati da un conto a un altro; un saldo scende e l'altro sale.

  Per il mese scelto mostra le spese, quanto resta del budget, le entrate e quanto hai risparmiato, più l'elenco unico di tutti i movimenti (spese in −, entrate in + verde, trasferimenti in grigio). Budget e statistiche contano solo le spese. Sopra l'elenco c'è la **ricerca** (in descrizione, area, sotto area e conto; scrivendo si cerca in tutti i mesi) e il pulsante **Filtri**: periodo (mese mostrato, tutti i mesi, un anno, un mese, da… a…), tipo, area (anche un'intera macro area), conto e solo spese divise. I filtri attivi compaiono come etichette rimovibili e un riquadro riassume numero di risultati, spese ed entrate. Toccando un movimento dell'elenco lo si modifica con lo stesso modulo (si può cambiare anche il tipo); saldi, budget e debiti si ricalcolano da soli.
- **Spese divise**: con l'interruttore "Da dividere con Laura" una spesa si divide 50/50 o indicando la propria quota in €. Si sceglie chi ha pagato: io tutto, ognuno la sua parte, oppure Laura tutto. Nel budget e nelle statistiche conta solo la propria quota; dal conto esce quanto pagato davvero.
- **Debiti**: quanto Laura ti deve e quanto le devi, con il saldo netto. Ogni debito si segna come saldato, scegliendo su quale conto sono entrati o usciti i soldi, oppure tutti insieme con "Salda tutto"; c'è sempre una conferma prima e si può annullare dopo. Il nome della persona si cambia in fondo alla pagina.
- **Obiettivi**: il "cassetto", cioè i soldi davvero liberi, con la barra verso l'obiettivo (10.000 € di partenza, modificabile). Cassetto = saldo totale − conti esclusi (interruttore "Escludi dal cassetto" sul conto, es. soldi di altre attività) − budget ancora da spendere nel mese in corso (per sotto area, solo residui positivi) − debiti aperti verso Laura; i crediti verso Laura non contano finché non sono saldati. La previsione stima quando lo raggiungerai in base al risparmio medio mensile (entrate − proprie spese, ultimi mesi completi, senza i conti esclusi).
- **Altri obiettivi** (nella pagina Obiettivi): quanti ne vuoi, ognuno con emoji, nome, importo e data facoltativa entro cui raggiungerlo. Vengono riempiti in ordine di priorità (si riordinano trascinandoli) con l'avanzo, cioè la parte del cassetto che supera il suo obiettivo. Ogni obiettivo mostra quanto ha raccolto, la data stimata e, se c'è una scadenza, se ci arrivi in tempo o quanto servirebbe risparmiare al mese. Quando lo usi lo segni come "Completato": passa nello storico e smette di prendere soldi dall'avanzo (si può ripristinare).
- **Statistiche**: per mese, anno o in totale, quanto hai speso e quanto resta del budget, complessivamente e per ogni macro area e sotto area. Il budget annuale è quello mensile × 12; il totale è quello mensile × i mesi trascorsi dalla prima spesa.
- **Aree**: macro aree (es. Casa) con sotto aree (es. Mutuo, Corrente) e relativo budget mensile; macro aree e sotto aree si riordinano trascinandole.
- **Conti**: i tuoi conti (corrente, contanti, carte, risparmi…) con emoji, nome e saldo, e il saldo totale; si riordinano trascinandoli. Il saldo si aggiorna da solo con spese, entrate, trasferimenti e debiti saldati su quel conto e si può correggere a mano in qualsiasi momento.

Le pagine si cambiano dalla barra in basso, pensata per l'uso da telefono; tenendo premuto un pulsante della barra lo si può trascinare per cambiarne l'ordine. Le frecce accanto al mese permettono di passare velocemente al mese precedente o successivo.

## Installazione sul telefono

L'app è una PWA: si installa dal browser e poi si apre dalla schermata Home a tutto schermo, anche senza connessione.

- **Android (Chrome):** menu ⋮ → **Installa app** (o "Aggiungi a schermata Home" → Installa).
- **iPhone (Safari):** pulsante Condividi → **Aggiungi alla schermata Home**.

Il service worker (`sw.js`) salva in cache solo i file dell'app, mai i dati; con connessione scarica sempre la versione più recente.

## Backup e più dispositivi

I dati vivono in un solo browser. Usa **Esporta backup** per scaricare un file da conservare o da importare su un altro dispositivo con **Importa backup** (le spese già presenti vengono mantenute, quelle nuove aggiunte).

Se cancelli i dati di navigazione del browser, le spese vengono eliminate: fai backup regolari.

- **Backup di fine mese:** l'ultimo giorno del mese (o alla prima apertura successiva, se è stato saltato) l'app propone il backup con una finestra: "Scarica sul telefono" oppure "Salva su Drive o altre app" (menu di condivisione del telefono; il file condiviso è un `.txt` perché Chrome su Android non condivide i `.json`, e "Importa" accetta entrambi). Un'app web non può salvare file da sola, quindi serve sempre un tocco; "Più tardi" lo ripropone il giorno dopo.
- **Stato in Conti:** in fondo alla pagina Conti si vede la data dell'ultimo backup e se il browser ha concesso l'archiviazione persistente (i dati non vengono cancellati automaticamente per liberare spazio); l'app la richiede all'avvio.

I backup creati con la vecchia versione protetta da password si possono ancora importare: l'app chiederà quella password una sola volta.

## Pubblicazione

Il sito è pubblicato con GitHub Pages dal branch `main`: ogni modifica a `main` aggiorna automaticamente la pagina.

A ogni modifica di `style.css` o `app.js` va aumentato il numero di versione in tre punti: **entrambi** i `?v=` in `index.html`, `APP_VERSION` in `app.js` e `version.json`. Così i browser non usano file vecchi dalla cache e l'app installata mostra l'avviso "Nuova versione disponibile". Il numero è visibile in fondo alla pagina Conti.

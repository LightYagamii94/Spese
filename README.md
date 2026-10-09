# Le mie spese

Web app per registrare le spese personali. I dati restano solo sul tuo dispositivo.

## Dove finiscono i dati

- **Nessun server.** L'app è fatta solo di file statici (`index.html`, `app.js`, `style.css`). Le spese vengono salvate nel browser (localStorage) e non vengono mai inviate da nessuna parte.
- **Nessuna connessione esterna.** Una Content Security Policy blocca qualsiasi richiesta di rete da parte della pagina (niente analytics, CDN o font esterni).
- **Nessuna password.** Chiunque usi il tuo browser sul tuo dispositivo può aprire l'app e vedere le spese, ma nessun altro via Internet.

## Sezioni

- **Spese**: registrazione delle spese (descrizione facoltativa), ognuna collegata a una sotto area e, se vuoi, al conto con cui è stata pagata. Per il mese scelto mostra il totale, quanto resta del budget e l'elenco dei movimenti.
- **Statistiche**: per mese, anno o in totale, quanto hai speso e quanto resta del budget, complessivamente e per ogni macro area e sotto area. Il budget annuale è quello mensile × 12; il totale è quello mensile × i mesi trascorsi dalla prima spesa.
- **Aree**: macro aree (es. Casa) con sotto aree (es. Mutuo, Corrente) e relativo budget mensile; macro aree e sotto aree si riordinano trascinandole.
- **Conti**: i tuoi conti (corrente, contanti, carte, risparmi…) con emoji, nome e saldo, e il saldo totale; si riordinano trascinandoli. Il saldo si aggiorna da solo con le spese pagate da quel conto e si può correggere a mano in qualsiasi momento.

Le pagine si cambiano dalla barra in basso, pensata per l'uso da telefono.

## Backup e più dispositivi

I dati vivono in un solo browser. Usa **Esporta backup** per scaricare un file da conservare o da importare su un altro dispositivo con **Importa backup** (le spese già presenti vengono mantenute, quelle nuove aggiunte).

Se cancelli i dati di navigazione del browser, le spese vengono eliminate: fai backup regolari.

I backup creati con la vecchia versione protetta da password si possono ancora importare: l'app chiederà quella password una sola volta.

## Pubblicazione

Il sito è pubblicato con GitHub Pages dal branch `main`: ogni modifica a `main` aggiorna automaticamente la pagina.

A ogni modifica di `style.css` o `app.js` va aumentato il numero di versione (`?v=`) nei link di `index.html`, altrimenti i browser possono continuare a usare per qualche minuto i file vecchi dalla cache.

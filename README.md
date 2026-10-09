# Le mie spese

Web app per registrare le spese personali. I dati restano solo sul tuo dispositivo.

## Dove finiscono i dati

- **Nessun server.** L'app è fatta solo di file statici (`index.html`, `app.js`, `style.css`). Le spese vengono salvate nel browser (localStorage) e non vengono mai inviate da nessuna parte.
- **Nessuna connessione esterna.** Una Content Security Policy blocca qualsiasi richiesta di rete da parte della pagina (niente analytics, CDN o font esterni).
- **Nessuna password.** Chiunque usi il tuo browser sul tuo dispositivo può aprire l'app e vedere le spese, ma nessun altro via Internet.

## Sezioni

- **Spese**: registrazione delle spese, ognuna collegata a una sotto area e (facoltativamente) al conto con cui è stata pagata. Per il mese scelto mostra il totale, quanto resta del budget e, per ogni macro area e sotto area, quanto hai speso rispetto al budget.
- **Aree e budget**: macro aree (es. Casa) con sotto aree (es. Mutuo, Corrente) e relativo budget mensile; macro aree e sotto aree si riordinano trascinandole.
- **Conti**: i tuoi conti (corrente, contanti, carte, risparmi…) con emoji, nome e saldo, e il saldo totale; si riordinano trascinandoli. Il saldo si aggiorna da solo con le spese pagate da quel conto e si può correggere a mano in qualsiasi momento.

## Backup e più dispositivi

I dati vivono in un solo browser. Usa **Esporta backup** per scaricare un file da conservare o da importare su un altro dispositivo con **Importa backup** (le spese già presenti vengono mantenute, quelle nuove aggiunte).

Se cancelli i dati di navigazione del browser, le spese vengono eliminate: fai backup regolari.

I backup creati con la vecchia versione protetta da password si possono ancora importare: l'app chiederà quella password una sola volta.

## Pubblicazione

Il sito è pubblicato con GitHub Pages dal branch `main`: ogni modifica a `main` aggiorna automaticamente la pagina.

A ogni modifica di `style.css` o `app.js` va aumentato il numero di versione (`?v=`) nei link di `index.html`, altrimenti i browser possono continuare a usare per qualche minuto i file vecchi dalla cache.

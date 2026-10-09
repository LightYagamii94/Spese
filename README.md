# Le mie spese

Web app per registrare le spese personali. I dati restano solo sul tuo dispositivo.

## Dove finiscono i dati

- **Nessun server.** L'app è fatta solo di file statici (`index.html`, `app.js`, `style.css`). Le spese vengono salvate nel browser (localStorage) e non vengono mai inviate da nessuna parte.
- **Nessuna connessione esterna.** Una Content Security Policy blocca qualsiasi richiesta di rete da parte della pagina (niente analytics, CDN o font esterni).
- **Nessuna password.** Chiunque usi il tuo browser sul tuo dispositivo può aprire l'app e vedere le spese, ma nessun altro via Internet.

## Backup e più dispositivi

I dati vivono in un solo browser. Usa **Esporta backup** per scaricare un file da conservare o da importare su un altro dispositivo con **Importa backup** (le spese già presenti vengono mantenute, quelle nuove aggiunte).

Se cancelli i dati di navigazione del browser, le spese vengono eliminate: fai backup regolari.

I backup creati con la vecchia versione protetta da password si possono ancora importare: l'app chiederà quella password una sola volta.

## Pubblicazione

Il sito è pubblicato con GitHub Pages dal branch `main`: ogni modifica a `main` aggiorna automaticamente la pagina.

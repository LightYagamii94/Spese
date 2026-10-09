# Le mie spese

Web app per registrare le spese personali, pensata perché **nessuno oltre a te possa vedere i dati**.

## Come protegge i tuoi dati

- **Nessun server.** L'app è fatta solo di file statici (`index.html`, `app.js`, `style.css`). Le spese non vengono mai inviate da nessuna parte: restano nel browser del tuo dispositivo.
- **Cifratura con password.** Tutto viene cifrato con AES-GCM a 256 bit; la chiave è derivata dalla tua password con PBKDF2-SHA256 (600.000 iterazioni). Nel browser è salvato solo il testo cifrato.
- **Nessuna connessione esterna.** Una Content Security Policy blocca qualsiasi richiesta di rete da parte della pagina (niente analytics, CDN o font esterni).
- **Blocco automatico** dopo 5 minuti di inattività, oppure con il pulsante "Blocca".

⚠️ La password **non è recuperabile**: se la dimentichi, i dati non si possono più leggere.

## Backup e più dispositivi

I dati vivono in un solo browser. Usa **Esporta backup** per scaricare un file (anch'esso cifrato) da conservare dove vuoi, o da importare su un altro dispositivo con **Importa backup**: per aprirlo servirà la stessa password.

Se cancelli i dati di navigazione del browser, l'archivio locale viene eliminato: fai backup regolari.

## Come usarla

- **In locale:** apri `index.html` con il browser. In alcuni browser è più affidabile servirla da un piccolo server locale, ad esempio `python3 -m http.server` e poi `http://localhost:8000`.
- **Online con GitHub Pages:** Settings → Pages → "Deploy from a branch". Il sito pubblica solo il codice dell'app, **non** le tue spese, che restano cifrate nel tuo browser.

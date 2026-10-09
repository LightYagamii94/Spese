'use strict';

// I dati vengono cifrati nel browser con AES-GCM usando una chiave derivata
// dalla password (PBKDF2-SHA256). Su disco (localStorage) e nei backup finisce
// solo il testo cifrato: senza la password nessuno può leggerlo.

const STORAGE_KEY = 'spese.vault.v1';
const PBKDF2_ITERATIONS = 600000;

const $ = (id) => document.getElementById(id);
const enc = new TextEncoder();
const dec = new TextDecoder();

let key = null;   // CryptoKey non estraibile, vive solo in memoria
let salt = null;
let data = { expenses: [] };

const euro = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });

// ---------- Crittografia ----------

const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(password, saltBytes) {
  const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptVault() {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(data)));
  return { v: 1, kdf: 'PBKDF2-SHA256', iter: PBKDF2_ITERATIONS, salt: toB64(salt), iv: toB64(iv), ct: toB64(ct) };
}

async function decryptVault(vault, password) {
  const s = fromB64(vault.salt);
  const k = await deriveKey(password, s);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(vault.iv) }, k, fromB64(vault.ct));
  return { key: k, salt: s, data: JSON.parse(dec.decode(plain)) };
}

function readVault() {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

async function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(await encryptVault()));
}

function isValidVault(v) {
  return v && v.v === 1 && typeof v.salt === 'string' && typeof v.iv === 'string' && typeof v.ct === 'string';
}

// ---------- Blocco / sblocco ----------

function showLockScreen() {
  const exists = !!readVault();
  $('lock-intro').textContent = exists
    ? 'Inserisci la password per sbloccare le tue spese.'
    : 'Prima configurazione: scegli una password (almeno 8 caratteri). Non è recuperabile: se la perdi, i dati non si possono più leggere.';
  $('confirm-wrap').hidden = exists;
  $('password-confirm').required = !exists;
  $('password').autocomplete = exists ? 'current-password' : 'new-password';
  $('lock-submit').textContent = exists ? 'Sblocca' : 'Crea archivio cifrato';
  $('lock-error').textContent = '';
  $('password').value = '';
  $('password-confirm').value = '';
  $('lock-screen').hidden = false;
  $('app').hidden = true;
  $('password').focus();
}

function lock() {
  key = null;
  salt = null;
  data = { expenses: [] };
  $('rows').replaceChildren();
  showLockScreen();
}

$('lock-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = $('password').value;
  const vault = readVault();
  $('lock-submit').disabled = true;
  $('lock-error').textContent = '';
  try {
    if (vault) {
      const res = await decryptVault(vault, password);
      key = res.key; salt = res.salt; data = res.data;
    } else {
      if (password !== $('password-confirm').value) {
        $('lock-error').textContent = 'Le password non coincidono.';
        return;
      }
      salt = crypto.getRandomValues(new Uint8Array(16));
      key = await deriveKey(password, salt);
      data = { expenses: [] };
      await save();
    }
    $('password').value = '';
    $('password-confirm').value = '';
    $('lock-screen').hidden = true;
    $('app').hidden = false;
    render();
  } catch {
    $('lock-error').textContent = 'Password errata.';
  } finally {
    $('lock-submit').disabled = false;
  }
});

$('lock').addEventListener('click', lock);

// Blocco automatico dopo 5 minuti di inattività.
let idleTimer;
function resetIdle() {
  clearTimeout(idleTimer);
  if (key) idleTimer = setTimeout(lock, 5 * 60 * 1000);
}
['click', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, resetIdle, { passive: true }));

// ---------- Spese ----------

function render() {
  resetIdle();
  const month = $('month').value;
  const items = data.expenses
    .filter((x) => x.date.startsWith(month))
    .sort((a, b) => b.date.localeCompare(a.date));

  const rows = items.map((x) => {
    const tr = document.createElement('tr');
    for (const [text, cls] of [[x.date.split('-').reverse().join('/')], [x.description], [x.category], [euro.format(x.amount), 'num']]) {
      const td = document.createElement('td');
      td.textContent = text;
      if (cls) td.className = cls;
      tr.append(td);
    }
    const td = document.createElement('td');
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'link';
    del.textContent = 'Elimina';
    del.setAttribute('aria-label', `Elimina ${x.description}`);
    del.addEventListener('click', async () => {
      if (!confirm(`Eliminare "${x.description}"?`)) return;
      data.expenses = data.expenses.filter((y) => y.id !== x.id);
      await save();
      render();
    });
    td.append(del);
    tr.append(td);
    return tr;
  });
  $('rows').replaceChildren(...rows);
  $('empty').hidden = items.length > 0;

  const total = items.reduce((s, x) => s + x.amount, 0);
  $('total').textContent = euro.format(total);

  const byCat = {};
  for (const x of items) byCat[x.category] = (byCat[x.category] || 0) + x.amount;
  const max = Math.max(0, ...Object.values(byCat));
  const bars = Object.entries(byCat)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, sum]) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = cat;
      const bar = document.createElement('div');
      bar.className = 'bar';
      bar.style.width = `${(sum / max) * 100}%`;
      const val = document.createElement('span');
      val.className = 'num';
      val.textContent = euro.format(sum);
      li.append(name, bar, val);
      return li;
    });
  $('by-category').replaceChildren(...bars);

  const cats = [...new Set(data.expenses.map((x) => x.category))].sort();
  $('categories').replaceChildren(...cats.map((c) => Object.assign(document.createElement('option'), { value: c })));
}

$('expense-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const amount = Math.round(parseFloat($('amount').value) * 100) / 100;
  if (!(amount > 0)) return;
  data.expenses.push({
    id: crypto.randomUUID(),
    date: $('date').value,
    description: $('description').value.trim(),
    category: $('category').value.trim(),
    amount,
  });
  await save();
  $('month').value = $('date').value.slice(0, 7);
  $('description').value = '';
  $('amount').value = '';
  $('description').focus();
  render();
});

$('month').addEventListener('change', render);

// ---------- Backup ----------

$('export').addEventListener('click', async () => {
  const blob = new Blob([JSON.stringify(await encryptVault())], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `spese-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

async function importFile(file) {
  let vault;
  try {
    vault = JSON.parse(await file.text());
  } catch {
    vault = null;
  }
  if (!isValidVault(vault)) {
    alert('Il file non è un backup valido.');
    return;
  }
  if (readVault() && !confirm('Il backup sostituirà i dati presenti su questo dispositivo. Continuare?')) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(vault));
  alert('Backup importato. Sblocca con la password con cui era stato creato.');
  lock();
}

$('import').addEventListener('change', (e) => { if (e.target.files[0]) importFile(e.target.files[0]); e.target.value = ''; });
$('import-locked').addEventListener('change', (e) => { if (e.target.files[0]) importFile(e.target.files[0]); e.target.value = ''; });

// ---------- Avvio ----------

const today = new Date();
const iso = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString();
$('date').value = iso.slice(0, 10);
$('month').value = iso.slice(0, 7);
showLockScreen();

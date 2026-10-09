'use strict';

// Le spese restano solo nel browser di questo dispositivo (localStorage):
// non vengono mai inviate a nessun server.

const STORAGE_KEY = 'spese.data.v2';
const LEGACY_VAULT_KEY = 'spese.vault.v1'; // vecchia versione cifrata con password

const $ = (id) => document.getElementById(id);

let data = load();

const euro = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && Array.isArray(parsed.expenses)) {
      if (!Array.isArray(parsed.areas)) parsed.areas = [];
      return parsed;
    }
  } catch {}
  return { expenses: [], areas: [] };
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// ---------- Vecchi dati cifrati (versione con password) ----------

const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function isLegacyVault(v) {
  return v && v.v === 1 && typeof v.salt === 'string' && typeof v.iv === 'string' && typeof v.ct === 'string';
}

async function decryptLegacy(vault, password) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: fromB64(vault.salt), iterations: vault.iter || 600000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(vault.iv) }, key, fromB64(vault.ct));
  return JSON.parse(new TextDecoder().decode(plain));
}

function readLegacyVault() {
  try {
    const v = JSON.parse(localStorage.getItem(LEGACY_VAULT_KEY));
    return isLegacyVault(v) ? v : null;
  } catch {
    return null;
  }
}

function finishMigration() {
  localStorage.removeItem(LEGACY_VAULT_KEY);
  $('migrate').hidden = true;
  $('app').hidden = false;
  showPage();
}

$('migrate-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('migrate-submit').disabled = true;
  $('migrate-error').textContent = '';
  try {
    const old = await decryptLegacy(readLegacyVault(), $('old-password').value);
    mergeExpenses(old.expenses || []);
    finishMigration();
  } catch {
    $('migrate-error').textContent = 'Password errata.';
  } finally {
    $('migrate-submit').disabled = false;
  }
});

$('migrate-skip').addEventListener('click', () => {
  if (confirm('Le spese salvate con la vecchia versione verranno eliminate definitivamente. Continuare?')) finishMigration();
});

// ---------- Spese ----------

function mergeExpenses(list) {
  const ids = new Set(data.expenses.map((x) => x.id));
  for (const x of list) {
    if (x && x.id && !ids.has(x.id) && typeof x.date === 'string' && typeof x.amount === 'number') {
      data.expenses.push({
        id: String(x.id),
        date: x.date,
        description: String(x.description ?? ''),
        category: String(x.category ?? ''),
        amount: x.amount,
      });
      ids.add(x.id);
    }
  }
  save();
}

function render() {
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
    del.addEventListener('click', () => {
      if (!confirm(`Eliminare "${x.description}"?`)) return;
      data.expenses = data.expenses.filter((y) => y.id !== x.id);
      save();
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

$('expense-form').addEventListener('submit', (e) => {
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
  save();
  $('month').value = $('date').value.slice(0, 7);
  $('description').value = '';
  $('amount').value = '';
  $('description').focus();
  render();
});

$('month').addEventListener('change', render);

// ---------- Macro aree e sotto aree ----------

const parseBudget = (v) => {
  const n = Math.round(parseFloat(String(v).replace(',', '.')) * 100) / 100;
  return n >= 0 ? n : 0;
};

const macroBudget = (m) => m.subs.reduce((s, x) => s + x.budget, 0);

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function renderAreas() {
  $('macro-empty').hidden = data.areas.length > 0;
  $('budget-total').textContent = euro.format(data.areas.reduce((s, m) => s + macroBudget(m), 0));

  const cards = data.areas.map((m) => {
    const name = el('input', { className: 'rename name', value: m.name, maxLength: 40, required: true });
    name.setAttribute('aria-label', 'Nome macro area');
    name.addEventListener('change', () => {
      const v = name.value.trim();
      if (v) { m.name = v; save(); }
      renderAreas();
    });

    const del = el('button', { type: 'button', className: 'link', textContent: 'Elimina macro area' });
    del.addEventListener('click', () => {
      const extra = m.subs.length ? ` e le sue ${m.subs.length} sotto aree` : '';
      if (!confirm(`Eliminare la macro area "${m.name}"${extra}?`)) return;
      data.areas = data.areas.filter((x) => x.id !== m.id);
      save();
      renderAreas();
    });

    const head = el('div', { className: 'macro-head' },
      name,
      el('span', { className: 'macro-budget', textContent: `${euro.format(macroBudget(m))} / mese` }),
      del);

    const subs = m.subs.map((sub) => {
      const subName = el('input', { className: 'rename', value: sub.name, maxLength: 40, required: true });
      subName.setAttribute('aria-label', 'Nome sotto area');
      subName.addEventListener('change', () => {
        const v = subName.value.trim();
        if (v) { sub.name = v; save(); }
        renderAreas();
      });

      const budget = el('input', { type: 'number', step: '0.01', min: '0', inputMode: 'decimal', value: sub.budget.toFixed(2) });
      budget.setAttribute('aria-label', `Budget mensile ${sub.name}`);
      budget.addEventListener('change', () => {
        sub.budget = parseBudget(budget.value);
        save();
        renderAreas();
      });

      const subDel = el('button', { type: 'button', className: 'link', textContent: 'Elimina' });
      subDel.setAttribute('aria-label', `Elimina ${sub.name}`);
      subDel.addEventListener('click', () => {
        if (!confirm(`Eliminare la sotto area "${sub.name}"?`)) return;
        m.subs = m.subs.filter((x) => x.id !== sub.id);
        save();
        renderAreas();
      });

      return el('li', {}, subName, el('label', { className: 'budget' }, budget), subDel);
    });

    const newName = el('input', { type: 'text', placeholder: 'Nuova sotto area (es. Mutuo)', maxLength: 40, required: true });
    newName.setAttribute('aria-label', 'Nome nuova sotto area');
    const newBudget = el('input', { type: 'number', step: '0.01', min: '0', inputMode: 'decimal', placeholder: 'Budget €' });
    newBudget.setAttribute('aria-label', 'Budget mensile nuova sotto area');
    const form = el('form', { className: 'sub-form' }, newName, newBudget, el('button', { type: 'submit', textContent: 'Aggiungi' }));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = newName.value.trim();
      if (!v) return;
      m.subs.push({ id: crypto.randomUUID(), name: v, budget: parseBudget(newBudget.value || 0) });
      save();
      renderAreas();
      // Rimette il cursore nel campo della stessa macro area per inserimenti in serie.
      document.querySelector(`[data-macro="${m.id}"] .sub-form input`)?.focus();
    });

    const card = el('div', { className: 'card' }, head,
      subs.length ? el('ul', { className: 'sub-list' }, ...subs) : el('p', { className: 'hint', textContent: 'Nessuna sotto area.' }),
      form);
    card.dataset.macro = m.id;
    return card;
  });
  $('macro-list').replaceChildren(...cards);
}

$('macro-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('macro-name').value.trim();
  if (!v) return;
  const m = { id: crypto.randomUUID(), name: v, subs: [] };
  data.areas.push(m);
  save();
  $('macro-name').value = '';
  renderAreas();
  document.querySelector(`[data-macro="${m.id}"] .sub-form input`)?.focus();
});

function mergeAreas(list) {
  for (const m of list) {
    if (!m || !m.id || typeof m.name !== 'string' || !Array.isArray(m.subs)) continue;
    let target = data.areas.find((x) => x.id === m.id);
    if (!target) {
      target = { id: String(m.id), name: m.name, subs: [] };
      data.areas.push(target);
    }
    const ids = new Set(target.subs.map((x) => x.id));
    for (const sub of m.subs) {
      if (sub && sub.id && !ids.has(sub.id) && typeof sub.name === 'string') {
        target.subs.push({ id: String(sub.id), name: sub.name, budget: parseBudget(sub.budget ?? 0) });
        ids.add(sub.id);
      }
    }
  }
  save();
}

// ---------- Navigazione ----------

function showPage() {
  const page = location.hash === '#aree' ? 'aree' : 'spese';
  for (const p of document.querySelectorAll('.page')) p.hidden = p.id !== `page-${page}`;
  for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t.dataset.page === page);
  if (page === 'aree') renderAreas(); else render();
}

window.addEventListener('hashchange', showPage);

// ---------- Backup ----------

$('export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `spese-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    parsed = null;
  }
  let list;
  let areas = [];
  if (parsed && Array.isArray(parsed.expenses)) {
    list = parsed.expenses;
    if (Array.isArray(parsed.areas)) areas = parsed.areas;
  } else if (isLegacyVault(parsed)) {
    // Backup creato con la vecchia versione protetta da password.
    const password = prompt('Questo backup è protetto da password. Inseriscila per importarlo:');
    if (password === null) return;
    try {
      list = (await decryptLegacy(parsed, password)).expenses || [];
    } catch {
      alert('Password errata.');
      return;
    }
  } else {
    alert('Il file non è un backup valido.');
    return;
  }
  const before = data.expenses.length;
  mergeExpenses(list);
  mergeAreas(areas);
  showPage();
  alert(`Importate ${data.expenses.length - before} spese.`);
});

// ---------- Avvio ----------

const today = new Date();
const iso = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString();
$('date').value = iso.slice(0, 10);
$('month').value = iso.slice(0, 7);

if (readLegacyVault()) {
  $('app').hidden = true;
  $('migrate').hidden = false;
} else {
  showPage();
}

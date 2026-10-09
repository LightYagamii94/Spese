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

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

// Icone SVG disegnate a mano (nessuna libreria esterna).
const ICONS = {
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  plus: 'M12 5v14M5 12h14',
};

function icon(name) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', ICONS[name]);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', name === 'grip' ? '3' : '2');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

function iconButton(name, label, extraClass = '') {
  const b = el('button', { type: 'button', className: `icon-btn ${extraClass}`.trim(), title: label }, icon(name));
  b.setAttribute('aria-label', label);
  return b;
}

// Campo numerico con il simbolo € a destra.
function moneyInput(props) {
  const input = el('input', { type: 'number', step: '0.01', min: '0', inputMode: 'decimal', ...props });
  return { input, wrap: el('span', { className: 'money' }, input, el('span', { className: 'suffix', textContent: '€' })) };
}

const MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

function render() {
  const month = $('month').value;
  const items = data.expenses
    .filter((x) => x.date.startsWith(month))
    .sort((a, b) => b.date.localeCompare(a.date));

  const rows = items.map((x) => {
    const [, mo, d] = x.date.split('-');
    const del = iconButton('trash', `Elimina ${x.description}`, 'danger');
    del.addEventListener('click', () => {
      if (!confirm(`Eliminare "${x.description}"?`)) return;
      data.expenses = data.expenses.filter((y) => y.id !== x.id);
      save();
      render();
    });
    return el('li', {},
      el('span', { className: 'date-badge' }, el('b', { textContent: d }), el('small', { textContent: MONTHS[Number(mo) - 1] })),
      el('div', { className: 'expense-main' },
        el('div', { className: 'desc', textContent: x.description }),
        el('span', { className: 'chip', textContent: x.category })),
      el('span', { className: 'expense-amount', textContent: euro.format(x.amount) }),
      del);
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
      const bar = el('div', { className: 'bar' });
      bar.style.width = `${(sum / max) * 100}%`;
      return el('li', {},
        el('span', { className: 'cat', textContent: cat }),
        el('span', { className: 'num', textContent: euro.format(sum) }),
        el('div', { className: 'track' }, bar));
    });
  $('by-category').replaceChildren(...bars);
  $('by-category-card').hidden = bars.length === 0;

  const cats = [...new Set(data.expenses.map((x) => x.category))].sort();
  $('categories').replaceChildren(...cats.map((c) => el('option', { value: c })));
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


// Macro aree chiuse a tendina: è solo una preferenza di visualizzazione,
// per questo non finisce nei dati né nei backup.
const COLLAPSED_KEY = 'spese.ui.collapsed';
const collapsed = (() => {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY)) || []);
  } catch {
    return new Set();
  }
})();

function saveCollapsed() {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]));
  } catch {}
}

const AVATAR_COLORS = ['#5b5bf0', '#8b5cf6', '#ec4899', '#f97316', '#10b981', '#0ea5e9', '#eab308', '#ef4444'];

// Trascinamento con il "manico" a sinistra di ogni riga. Usa i pointer events,
// così funziona sia col mouse sia col dito su telefono e tablet.
function makeDraggable(handle, li, onDrop) {
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const list = li.parentElement;
    const before = [...list.children].map((c) => c.dataset.id).join();
    handle.setPointerCapture(e.pointerId);
    li.classList.add('dragging');
    document.body.classList.add('is-dragging');

    const mid = (c) => {
      const r = c.getBoundingClientRect();
      return r.top + r.height / 2;
    };
    // Si spostano le righe vicine e non quella trascinata: staccarla dalla
    // pagina, anche per un istante, farebbe perdere il puntatore al browser.
    const move = (ev) => {
      let prev = li.previousElementSibling;
      while (prev && ev.clientY < mid(prev)) {
        li.after(prev);
        prev = li.previousElementSibling;
      }
      let next = li.nextElementSibling;
      while (next && ev.clientY > mid(next)) {
        li.before(next);
        next = li.nextElementSibling;
      }
      // Scorre la pagina se si trascina vicino ai bordi dello schermo.
      if (ev.clientY < 80) window.scrollBy(0, -12);
      else if (ev.clientY > window.innerHeight - 60) window.scrollBy(0, 12);
    };
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      li.classList.remove('dragging');
      document.body.classList.remove('is-dragging');
      const ids = [...list.children].map((c) => c.dataset.id);
      if (ids.join() !== before) onDrop(ids);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  });
}

function renderAreas() {
  $('macro-empty').hidden = data.areas.length > 0;
  $('budget-total').textContent = euro.format(data.areas.reduce((s, m) => s + macroBudget(m), 0));

  const cards = data.areas.map((m, index) => {
    const name = el('input', { className: 'rename', value: m.name, maxLength: 40, required: true });
    name.setAttribute('aria-label', 'Nome macro area');
    name.addEventListener('change', () => {
      const v = name.value.trim();
      if (v) { m.name = v; save(); }
      renderAreas();
    });

    const del = iconButton('trash', `Elimina la macro area ${m.name}`, 'danger');
    del.addEventListener('click', () => {
      const extra = m.subs.length ? ` e le sue ${m.subs.length} sotto aree` : '';
      if (!confirm(`Eliminare la macro area "${m.name}"${extra}?`)) return;
      data.areas = data.areas.filter((x) => x.id !== m.id);
      collapsed.delete(m.id);
      saveCollapsed();
      save();
      renderAreas();
    });

    const isOpen = !collapsed.has(m.id);
    const toggle = el('button', { type: 'button', className: 'icon-btn toggle' });
    toggle.setAttribute('aria-expanded', String(isOpen));
    toggle.setAttribute('aria-label', `Mostra o nascondi le sotto aree di ${m.name}`);

    const avatar = el('span', { className: 'avatar', textContent: m.name.charAt(0).toUpperCase() });
    avatar.style.background = AVATAR_COLORS[index % AVATAR_COLORS.length];
    avatar.setAttribute('aria-hidden', 'true');

    const count = m.subs.length === 1 ? '1 sotto area' : `${m.subs.length} sotto aree`;
    const total = `${euro.format(macroBudget(m))} / mese`;
    const head = el('div', { className: 'macro-head' },
      toggle,
      avatar,
      el('div', { className: 'macro-title' }, name, el('div', { className: 'macro-meta', textContent: `${count} · ${total}` })),
      el('span', { className: 'macro-total', textContent: euro.format(macroBudget(m)) }),
      del);

    const subs = m.subs.map((sub, i) => {
      const handle = iconButton('grip', `Trascina per riordinare ${sub.name} (o usa le frecce su e giù)`, 'handle');

      const subName = el('input', { className: 'rename', value: sub.name, maxLength: 40, required: true });
      subName.setAttribute('aria-label', 'Nome sotto area');
      subName.addEventListener('change', () => {
        const v = subName.value.trim();
        if (v) { sub.name = v; save(); }
        renderAreas();
      });

      const budget = moneyInput({ value: sub.budget.toFixed(2) });
      budget.input.setAttribute('aria-label', `Budget mensile ${sub.name}`);
      budget.input.addEventListener('change', () => {
        sub.budget = parseBudget(budget.input.value);
        save();
        renderAreas();
      });

      const subDel = iconButton('trash', `Elimina ${sub.name}`, 'danger');
      subDel.addEventListener('click', () => {
        if (!confirm(`Eliminare la sotto area "${sub.name}"?`)) return;
        m.subs = m.subs.filter((x) => x.id !== sub.id);
        save();
        renderAreas();
      });

      const li = el('li', {}, handle, subName, budget.wrap, subDel);
      li.dataset.id = sub.id;

      makeDraggable(handle, li, (ids) => {
        m.subs.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
        save();
        renderAreas();
      });

      // Alternativa da tastiera: frecce su/giù sul manico.
      handle.addEventListener('keydown', (e) => {
        const j = e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowDown' ? i + 1 : -1;
        if (j < 0 || j >= m.subs.length) return;
        e.preventDefault();
        [m.subs[i], m.subs[j]] = [m.subs[j], m.subs[i]];
        save();
        renderAreas();
        document.querySelector(`li[data-id="${sub.id}"] .handle`)?.focus();
      });

      return li;
    });

    const newName = el('input', { type: 'text', placeholder: 'Nuova sotto area (es. Mutuo)', maxLength: 40, required: true });
    newName.setAttribute('aria-label', 'Nome nuova sotto area');
    const newBudget = moneyInput({ placeholder: 'Budget' });
    newBudget.input.setAttribute('aria-label', 'Budget mensile nuova sotto area');
    const form = el('form', { className: 'sub-form' }, newName, newBudget.wrap,
      el('button', { type: 'submit', className: 'btn primary' }, icon('plus'), 'Aggiungi'));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = newName.value.trim();
      if (!v) return;
      m.subs.push({ id: crypto.randomUUID(), name: v, budget: parseBudget(newBudget.input.value || 0) });
      save();
      renderAreas();
      // Rimette il cursore nel campo della stessa macro area per inserimenti in serie.
      document.querySelector(`[data-macro="${m.id}"] .sub-form input`)?.focus();
    });

    const body = el('div', { className: 'macro-body', hidden: !isOpen },
      subs.length ? el('ul', { className: 'sub-list' }, ...subs) : el('p', { className: 'sub-empty', textContent: 'Nessuna sotto area: aggiungine una qui sotto.' }),
      form);

    // Apre/chiude senza ridisegnare, così non si perde quanto scritto nei campi.
    toggle.addEventListener('click', () => {
      const open = body.hidden;
      body.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      if (open) collapsed.delete(m.id); else collapsed.add(m.id);
      saveCollapsed();
    });

    const card = el('div', { className: 'card' }, head, body);
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

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
      if (!Array.isArray(parsed.accounts)) parsed.accounts = [];
      return parsed;
    }
  } catch {}
  return { expenses: [], areas: [], accounts: [] };
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
        // Collegamenti a sotto area e conto (le spese più vecchie hanno solo `category`).
        ...(x.subId ? { subId: String(x.subId) } : {}),
        ...(x.accountId ? { accountId: String(x.accountId) } : {}),
        ...(x.category ? { category: String(x.category) } : {}),
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
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
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

// ---------- Collegamenti tra spese, aree e conti ----------

function findSub(subId) {
  for (const macro of data.areas) {
    const sub = macro.subs.find((x) => x.id === subId);
    if (sub) return { macro, sub };
  }
  return null;
}

const findAccount = (id) => data.accounts.find((a) => a.id === id);

// Il saldo salvato di un conto è il "saldo di partenza": quello mostrato è
// il saldo di partenza meno tutte le spese pagate con quel conto.
const spentFromAccount = (a) => data.expenses.reduce((s, x) => (x.accountId === a.id ? s + x.amount : s), 0);
const currentBalance = (a) => Math.round((a.balance - spentFromAccount(a)) * 100) / 100;

// Ultima area e ultimo conto usati: proposti di nuovo alla spesa successiva.
const LAST_KEY = 'spese.ui.last';
function readLast() {
  try {
    return JSON.parse(localStorage.getItem(LAST_KEY)) || {};
  } catch {
    return {};
  }
}
function saveLast(v) {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(v));
  } catch {}
}

function fillExpenseSelects() {
  const last = readLast();
  const areaSel = $('expense-area');
  const prevArea = areaSel.value || last.subId;
  const groups = data.areas
    .filter((m) => m.subs.length)
    .map((m) => el('optgroup', { label: m.name }, ...m.subs.map((sub) => el('option', { value: sub.id, textContent: `${m.name} › ${sub.name}` }))));
  areaSel.replaceChildren(el('option', { value: '', textContent: 'Scegli un\'area…', disabled: true }), ...groups);
  areaSel.value = findSub(prevArea) ? prevArea : '';

  const acctSel = $('expense-account');
  const prevAcct = acctSel.dataset.touched ? acctSel.value : last.accountId ?? acctSel.value;
  acctSel.replaceChildren(
    el('option', { value: '', textContent: 'Nessun conto' }),
    ...data.accounts.map((a) => el('option', { value: a.id, textContent: `${a.emoji} ${a.name}` })));
  acctSel.value = findAccount(prevAcct) ? prevAcct : '';

  const hasAreas = groups.length > 0;
  $('no-areas').hidden = hasAreas;
  for (const c of $('expense-form').querySelectorAll('input, select, button')) c.disabled = !hasAreas;
}

$('expense-account').addEventListener('change', (e) => { e.target.dataset.touched = '1'; });

const MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

function budgetRow(label, spent, budget, extra) {
  // Senza budget non c'è un limite da sforare: barra neutra.
  const ratio = budget > 0 ? spent / budget : spent > 0 ? 1 : 0;
  const state = budget <= 0 ? 'none' : ratio > 1 ? 'over' : ratio >= 0.8 ? 'warn' : '';
  const bar = el('div', { className: 'bar' });
  bar.style.width = `${Math.min(ratio, 1) * 100}%`;
  const left = budget <= 0 ? 'nessun budget'
    : spent <= budget ? `restano ${euro.format(budget - spent)}` : `sforato di ${euro.format(spent - budget)}`;
  const detail = budget > 0 ? `Speso ${euro.format(spent)} di ${euro.format(budget)}` : `Speso ${euro.format(spent)}`;
  const labelEl = el('span', { className: 'label' }, ...(extra ? [extra] : []), label);
  labelEl.title = label;
  return el('div', { className: `budget-row ${state}`.trim() },
    labelEl,
    el('span', { className: 'left', textContent: left }),
    el('div', { className: 'track' }, bar),
    el('span', { className: 'detail', textContent: detail }));
}

// Nome da mostrare per una spesa: la descrizione, oppure (se vuota) la sotto area.
function expenseTitle(x) {
  if (x.description) return x.description;
  const found = x.subId ? findSub(x.subId) : null;
  return found ? found.sub.name : x.category || 'Spesa';
}

function render() {
  fillExpenseSelects();
  const month = $('month').value;
  const items = data.expenses
    .filter((x) => x.date.startsWith(month))
    .sort((a, b) => b.date.localeCompare(a.date));

  const rows = items.map((x) => {
    const [, mo, d] = x.date.split('-');
    const found = x.subId ? findSub(x.subId) : null;
    const account = x.accountId ? findAccount(x.accountId) : null;
    const tags = [];
    if (found) tags.push(el('span', { className: 'chip', textContent: `${found.macro.name} › ${found.sub.name}` }));
    else if (x.category) tags.push(el('span', { className: 'chip muted', textContent: x.category }));
    else tags.push(el('span', { className: 'chip muted', textContent: x.subId ? 'Area eliminata' : 'Senza area' }));
    if (account) tags.push(el('span', { className: 'chip', textContent: `${account.emoji} ${account.name}` }));

    const title = expenseTitle(x);
    const del = iconButton('trash', `Elimina ${title}`, 'danger');
    del.addEventListener('click', () => {
      const back = account ? `\n${euro.format(x.amount)} torneranno sul conto "${account.name}".` : '';
      if (!confirm(`Eliminare "${title}"?${back}`)) return;
      data.expenses = data.expenses.filter((y) => y.id !== x.id);
      save();
      render();
    });
    return el('li', {},
      el('span', { className: 'date-badge' }, el('b', { textContent: d }), el('small', { textContent: MONTHS[Number(mo) - 1] })),
      el('div', { className: 'expense-main' },
        el('div', { className: 'desc', textContent: title }),
        el('div', { className: 'tags' }, ...tags)),
      el('span', { className: 'expense-amount', textContent: euro.format(x.amount) }),
      del);
  });
  $('rows').replaceChildren(...rows);
  $('empty').hidden = items.length > 0;

  const total = items.reduce((s, x) => s + x.amount, 0);
  $('total').textContent = euro.format(total);

  const totalBudget = data.areas.reduce((s, m) => s + macroBudget(m), 0);
  $('budget-hint').textContent = totalBudget > 0
    ? `su ${euro.format(totalBudget)} di budget · ${total <= totalBudget ? `restano ${euro.format(totalBudget - total)}` : `sforato di ${euro.format(total - totalBudget)}`}`
    : '';
}

// ---------- Statistiche ----------

const stats = { period: 'month' };
const monthIndex = (ym) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;
const MONTH_NAMES = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

function renderStats() {
  const nowYm = $('month').dataset.today;
  if (!$('stats-month').value) $('stats-month').value = nowYm;

  // Anni disponibili: dal primo anno con spese a quello corrente.
  const firstYm = data.expenses.reduce((m, x) => (x.date.slice(0, 7) < m ? x.date.slice(0, 7) : m), nowYm);
  const lastYm = data.expenses.reduce((m, x) => (x.date.slice(0, 7) > m ? x.date.slice(0, 7) : m), nowYm);
  const years = [];
  for (let y = Number(lastYm.slice(0, 4)); y >= Number(firstYm.slice(0, 4)); y--) years.push(String(y));
  const yearSel = $('stats-year');
  const prevYear = yearSel.value || nowYm.slice(0, 4);
  yearSel.replaceChildren(...years.map((y) => el('option', { value: y, textContent: y })));
  yearSel.value = years.includes(prevYear) ? prevYear : years[0];

  for (const b of document.querySelectorAll('.segmented button')) b.setAttribute('aria-pressed', String(b.dataset.period === stats.period));
  $('stats-month').closest('.stepper').hidden = stats.period !== 'month';
  yearSel.closest('.stepper').hidden = stats.period !== 'year';
  updateSteppers();

  // Spese del periodo e quante volte va contato il budget mensile.
  let inPeriod;
  let months;
  let label;
  let note;
  if (stats.period === 'month') {
    const ym = $('stats-month').value || nowYm;
    inPeriod = (x) => x.date.startsWith(ym);
    months = 1;
    label = `Rimanente a ${MONTH_NAMES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
    note = 'Budget mensile delle aree confrontato con le spese del mese scelto.';
  } else if (stats.period === 'year') {
    const y = yearSel.value;
    inPeriod = (x) => x.date.startsWith(`${y}-`);
    months = 12;
    label = `Rimanente nel ${y}`;
    note = 'Budget annuale = budget mensile × 12 mesi.';
  } else {
    inPeriod = () => true;
    months = monthIndex(lastYm) - monthIndex(firstYm) + 1;
    label = 'Rimanente totale';
    const from = `${MONTH_NAMES[Number(firstYm.slice(5, 7)) - 1]} ${firstYm.slice(0, 4)}`;
    note = `Budget totale = budget mensile × ${months} ${months === 1 ? 'mese' : 'mesi'} (da ${from}, mese della prima spesa, a oggi).`;
  }

  const spentBySub = {};
  let unassigned = 0;
  let spentTotal = 0;
  for (const x of data.expenses) {
    if (!inPeriod(x)) continue;
    spentTotal += x.amount;
    if (x.subId && findSub(x.subId)) spentBySub[x.subId] = (spentBySub[x.subId] || 0) + x.amount;
    else unassigned += x.amount;
  }
  const budgetTotal = data.areas.reduce((s, m) => s + macroBudget(m), 0) * months;
  const remaining = budgetTotal - spentTotal;

  $('stats-label').textContent = label;
  $('stats-remaining').textContent = euro.format(remaining);
  $('stats-sub').textContent = `Speso ${euro.format(spentTotal)} su ${euro.format(budgetTotal)} di budget`;
  $('stats-note').textContent = note;

  const blocks = data.areas
    .filter((m) => m.subs.length)
    .map((m) => {
      const spent = m.subs.reduce((s, sub) => s + (spentBySub[sub.id] || 0), 0);
      const dot = el('span', { className: 'dot' });
      dot.style.background = AVATAR_COLORS[data.areas.indexOf(m) % AVATAR_COLORS.length];
      return el('li', { className: 'budget-macro' },
        budgetRow(m.name, spent, macroBudget(m) * months, dot),
        el('ul', { className: 'budget-subs' },
          ...m.subs.map((sub) => el('li', {}, budgetRow(sub.name, spentBySub[sub.id] || 0, sub.budget * months)))));
    });
  if (unassigned > 0) blocks.push(el('li', { className: 'budget-macro' }, budgetRow('Senza area', unassigned, 0)));
  $('budget-list').replaceChildren(...blocks);
  $('stats-empty').hidden = blocks.length > 0;
}

for (const b of document.querySelectorAll('.segmented button')) {
  b.addEventListener('click', () => {
    stats.period = b.dataset.period;
    renderStats();
  });
}
$('stats-month').addEventListener('change', renderStats);
$('stats-year').addEventListener('change', renderStats);

$('expense-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const amount = Math.round(parseFloat($('amount').value) * 100) / 100;
  const subId = $('expense-area').value;
  if (!(amount > 0) || !findSub(subId)) return;
  // La descrizione è facoltativa: se vuota, nell'elenco si vede il nome della sotto area.
  const accountId = $('expense-account').value;
  data.expenses.push({
    id: crypto.randomUUID(),
    date: $('date').value,
    description: $('description').value.trim(),
    subId,
    ...(findAccount(accountId) ? { accountId } : {}),
    amount,
  });
  save();
  saveLast({ subId, accountId });
  // La pagina resta sul mese che si sta guardando: se la spesa è di un altro
  // mese lo si segnala, con la possibilità di andarci.
  const expenseMonth = $('date').value.slice(0, 7);
  if (expenseMonth !== $('month').value) {
    const [yy, mm] = expenseMonth.split('-');
    showToast(`Spesa salvata a ${MONTH_NAMES[Number(mm) - 1]} ${yy}`, 'Vedi', () => {
      $('month').value = expenseMonth;
      render();
    });
  }
  $('description').value = '';
  $('amount').value = '';
  $('description').focus();
  render();
});

$('month').addEventListener('change', render);

// Avviso temporaneo in basso, con un pulsante facoltativo.
let toastTimer;
function showToast(text, actionLabel, onAction) {
  const toast = $('toast');
  const action = el('button', { type: 'button', className: 'toast-action', textContent: actionLabel });
  action.addEventListener('click', () => {
    toast.hidden = true;
    onAction();
  });
  toast.replaceChildren(el('span', { textContent: text }), ...(actionLabel ? [action] : []));
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 6000);
}

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

// Trascinamento con il "manico" di un elemento (riga, scheda...). Usa i pointer
// events, così funziona sia col mouse sia col dito su telefono e tablet, e
// funziona sia con elenchi verticali sia con griglie a più colonne.
function makeDraggable(handle, item, onDrop) {
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    startDrag(handle, item, e.pointerId, onDrop);
  });
}

// Avvia il trascinamento di `item` seguendo il puntatore `pointerId`.
function startDrag(handle, item, pointerId, onDrop) {
  {
    const list = item.parentElement;
    const before = [...list.children].map((c) => c.dataset.id).join();
    handle.setPointerCapture(pointerId);
    item.classList.add('dragging');
    document.body.classList.add('is-dragging');

    const move = (ev) => {
      // Elemento dell'elenco che si trova sotto il puntatore.
      let over = document.elementFromPoint(ev.clientX, ev.clientY);
      while (over && over.parentElement !== list) over = over.parentElement;
      if (over && over !== item) {
        const kids = [...list.children];
        const from = kids.indexOf(item);
        const to = kids.indexOf(over);
        // Si scambia solo dopo aver superato la metà dell'elemento sorvolato
        // (in orizzontale se sono sulla stessa riga della griglia), così
        // elementi di altezze diverse non "rimbalzano" avanti e indietro.
        const r = over.getBoundingClientRect();
        const sameRow = Math.abs(r.top - item.getBoundingClientRect().top) < r.height / 2;
        const pos = sameRow ? ev.clientX : ev.clientY;
        const half = sameRow ? r.left + r.width / 2 : r.top + r.height / 2;
        // Si spostano gli elementi vicini e non quello trascinato: staccarlo dalla
        // pagina, anche per un istante, farebbe perdere il puntatore al browser.
        if (to > from && pos > half) {
          for (let k = from + 1; k <= to; k++) item.before(kids[k]);
        } else if (to < from && pos < half) {
          for (let k = from - 1; k >= to; k--) item.after(kids[k]);
        }
      }
      // Scorre la pagina se si trascina vicino ai bordi dello schermo.
      if (ev.clientY < 80) window.scrollBy(0, -12);
      else if (ev.clientY > window.innerHeight - 60) window.scrollBy(0, 12);
    };
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      item.classList.remove('dragging');
      document.body.classList.remove('is-dragging');
      const ids = [...list.children].map((c) => c.dataset.id);
      if (ids.join() !== before) onDrop(ids);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }
}

// Collega a un manico sia il trascinamento sia lo spostamento con le frecce
// su/giù (alternativa da tastiera). `getList` restituisce l'array da riordinare.
function makeSortable(handle, item, getList, id, rerender) {
  item.dataset.id = id;
  makeDraggable(handle, item, (ids) => {
    getList().sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    save();
    rerender();
  });
  handle.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : 0;
    if (!step) return;
    const list = getList();
    const i = list.findIndex((x) => x.id === id);
    const j = i + step;
    if (i < 0 || j < 0 || j >= list.length) return;
    e.preventDefault();
    [list[i], list[j]] = [list[j], list[i]];
    save();
    rerender();
    document.querySelector(`[data-id="${id}"] .handle`)?.focus();
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
      const subIds = new Set(m.subs.map((x) => x.id));
      const linked = data.expenses.filter((x) => subIds.has(x.subId)).length;
      const note = linked ? `\nLe ${linked} spese collegate resteranno registrate, ma senza area.` : '';
      if (!confirm(`Eliminare la macro area "${m.name}"${extra}?${note}`)) return;
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
    const macroHandle = iconButton('grip', `Trascina per riordinare ${m.name} (o usa le frecce su e giù)`, 'handle');
    const head = el('div', { className: 'macro-head' },
      macroHandle,
      toggle,
      avatar,
      el('div', { className: 'macro-title' }, name, el('div', { className: 'macro-meta', textContent: `${count} · ${total}` })),
      el('span', { className: 'macro-total', textContent: euro.format(macroBudget(m)) }),
      del);

    const subs = m.subs.map((sub) => {
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
        const linked = data.expenses.filter((x) => x.subId === sub.id).length;
        const note = linked ? `\nLe ${linked} spese collegate resteranno registrate, ma senza area.` : '';
        if (!confirm(`Eliminare la sotto area "${sub.name}"?${note}`)) return;
        m.subs = m.subs.filter((x) => x.id !== sub.id);
        save();
        renderAreas();
      });

      const li = el('li', {}, handle, subName, budget.wrap, subDel);
      makeSortable(handle, li, () => m.subs, sub.id, renderAreas);
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
    makeSortable(macroHandle, card, () => data.areas, m.id, renderAreas);
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

// ---------- Conti ----------

const DEFAULT_ACCOUNT_EMOJI = '🏦';
const EMOJIS = [
  '🏦', '💳', '💰', '💵', '💶', '🪙', '🐷', '👛', '👜', '💼', '📈', '📊', '💎', '🔒', '🧾', '🏧',
  '🏠', '🚗', '✈️', '🏖️', '🧳', '🎓', '🏥', '🛒', '🎁', '🎉', '🍕', '☕', '🎮', '🎵', '📚', '🏋️',
  '📱', '💻', '🔧', '⚡', '🔥', '🌱', '🍀', '☀️', '🌍', '🌈', '⭐', '❤️', '🎯', '🐶', '🐱', '👶',
  '🔵', '🟢', '🟡', '🟠', '🔴', '🟣', '⚫', '⚪',
];

// Gli importi dei conti possono essere negativi (es. carta di credito, scoperto).
const parseAmount = (v) => {
  const n = Math.round(parseFloat(String(v).replace(',', '.')) * 100) / 100;
  return Number.isFinite(n) ? n : 0;
};

// Prende solo il primo "carattere visibile" (un'emoji può essere fatta di più codepoint).
function firstGrapheme(text) {
  const t = text.trim();
  if (!t) return '';
  if (typeof Intl.Segmenter === 'function') {
    const first = new Intl.Segmenter('it', { granularity: 'grapheme' }).segment(t)[Symbol.iterator]().next().value;
    return first ? first.segment : '';
  }
  return Array.from(t)[0];
}

let emojiCallback = null;

function openEmojiPicker(current, onPick) {
  emojiCallback = onPick;
  const buttons = EMOJIS.map((e) => {
    const b = el('button', { type: 'button', textContent: e });
    b.setAttribute('aria-label', `Usa ${e}`);
    b.setAttribute('aria-pressed', String(e === current));
    b.addEventListener('click', () => pickEmoji(e));
    return b;
  });
  $('emoji-grid').replaceChildren(...buttons);
  $('emoji-input').value = EMOJIS.includes(current) ? '' : current;
  $('emoji-dialog').showModal();
  (buttons.find((b) => b.getAttribute('aria-pressed') === 'true') || buttons[0]).focus();
}

function pickEmoji(e) {
  const cb = emojiCallback;
  emojiCallback = null;
  $('emoji-dialog').close();
  if (cb && e) cb(e);
}

$('emoji-close').addEventListener('click', () => $('emoji-dialog').close());
// Clic fuori dal riquadro (sullo sfondo scuro) = chiudi.
$('emoji-dialog').addEventListener('click', (e) => {
  if (e.target === $('emoji-dialog')) $('emoji-dialog').close();
});
$('emoji-custom').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = firstGrapheme($('emoji-input').value);
  if (v) pickEmoji(v);
});

let newAccountEmoji = DEFAULT_ACCOUNT_EMOJI;
$('account-emoji').addEventListener('click', () => {
  openEmojiPicker(newAccountEmoji, (e) => {
    newAccountEmoji = e;
    $('account-emoji').textContent = e;
  });
});

function renderAccounts() {
  const total = data.accounts.reduce((s, a) => s + currentBalance(a), 0);
  $('accounts-total').textContent = euro.format(total);
  const n = data.accounts.length;
  $('accounts-count').textContent = n === 0 ? '' : n === 1 ? '1 conto' : `${n} conti`;
  $('account-empty').hidden = n > 0;

  const items = data.accounts.map((a) => {
    const emoji = el('button', { type: 'button', className: 'emoji-btn', textContent: a.emoji });
    emoji.setAttribute('aria-label', `Cambia emoji di ${a.name}`);
    emoji.addEventListener('click', () => {
      openEmojiPicker(a.emoji, (e) => {
        a.emoji = e;
        save();
        renderAccounts();
      });
    });

    const name = el('input', { className: 'rename', value: a.name, maxLength: 40, required: true });
    name.setAttribute('aria-label', 'Nome conto');
    name.addEventListener('change', () => {
      const v = name.value.trim();
      if (v) { a.name = v; save(); }
      renderAccounts();
    });

    const now = currentBalance(a);
    const balance = el('input', { type: 'number', step: '0.01', inputMode: 'decimal', value: now.toFixed(2) });
    balance.setAttribute('aria-label', `Saldo di ${a.name}`);
    const wrap = el('span', { className: `money${now < 0 ? ' negative' : ''}` }, balance, el('span', { className: 'suffix', textContent: '€' }));
    balance.addEventListener('change', () => {
      // Il valore scritto diventa il saldo attuale: si ricalcola il saldo di partenza.
      a.balance = Math.round((parseAmount(balance.value) + spentFromAccount(a)) * 100) / 100;
      save();
      renderAccounts();
    });

    const del = iconButton('trash', `Elimina il conto ${a.name}`, 'danger');
    del.addEventListener('click', () => {
      const linked = data.expenses.filter((x) => x.accountId === a.id).length;
      const note = linked ? `\nLe ${linked} spese pagate con questo conto resteranno registrate.` : '';
      if (!confirm(`Eliminare il conto "${a.name}"?${note}`)) return;
      data.accounts = data.accounts.filter((x) => x.id !== a.id);
      save();
      renderAccounts();
    });

    const handle = iconButton('grip', `Trascina per riordinare ${a.name} (o usa le frecce)`, 'handle');
    const li = el('li', {}, handle, emoji, name, del, wrap);
    makeSortable(handle, li, () => data.accounts, a.id, renderAccounts);
    return li;
  });
  $('account-list').replaceChildren(...items);
}

$('account-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('account-name').value.trim();
  if (!v) return;
  data.accounts.push({
    id: crypto.randomUUID(),
    name: v,
    emoji: newAccountEmoji,
    balance: parseAmount($('account-balance').value || 0),
  });
  save();
  $('account-name').value = '';
  $('account-balance').value = '';
  newAccountEmoji = DEFAULT_ACCOUNT_EMOJI;
  $('account-emoji').textContent = newAccountEmoji;
  renderAccounts();
});

function mergeAccounts(list) {
  const ids = new Set(data.accounts.map((x) => x.id));
  for (const a of list) {
    if (a && a.id && !ids.has(a.id) && typeof a.name === 'string') {
      data.accounts.push({
        id: String(a.id),
        name: a.name,
        emoji: firstGrapheme(String(a.emoji ?? '')) || DEFAULT_ACCOUNT_EMOJI,
        balance: parseAmount(a.balance ?? 0),
      });
      ids.add(a.id);
    }
  }
  save();
}

// ---------- Frecce per cambiare mese / anno ----------

function shiftMonth(ym, delta) {
  const i = Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1 + delta;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}

// Disattiva le frecce dell'anno quando non ci sono anni precedenti/successivi.
function updateSteppers() {
  const sel = $('stats-year');
  for (const b of document.querySelectorAll('.step-btn[data-target="stats-year"]')) {
    // Gli anni sono in ordine decrescente: "precedente" = opzione successiva.
    const j = sel.selectedIndex - Number(b.dataset.step);
    b.disabled = j < 0 || j >= sel.options.length;
  }
}

for (const b of document.querySelectorAll('.step-btn')) {
  b.addEventListener('click', () => {
    const target = $(b.dataset.target);
    const step = Number(b.dataset.step);
    if (target.tagName === 'SELECT') {
      const j = target.selectedIndex - step;
      if (j < 0 || j >= target.options.length) return;
      target.selectedIndex = j;
    } else {
      target.value = shiftMonth(target.value || $('month').dataset.today, step);
    }
    target.dispatchEvent(new Event('change'));
  });
}

// ---------- Ordine dei pulsanti della barra in basso ----------
// Tenendo premuto un pulsante per mezzo secondo lo si può trascinare.
// L'ordine è una preferenza di questo browser (non finisce nei backup).

const NAV_ORDER_KEY = 'spese.ui.navOrder';
const nav = document.querySelector('.bottom-nav');
for (const t of nav.children) {
  t.dataset.id = t.dataset.page;
  t.draggable = false; // evita il trascinamento nativo dei link col mouse
}

try {
  const order = JSON.parse(localStorage.getItem(NAV_ORDER_KEY)) || [];
  for (const id of order) {
    const t = nav.querySelector(`[data-id="${id}"]`);
    if (t) nav.append(t);
  }
} catch {}

// Pulsante appena trascinato: il "clic" che il browser genera al rilascio
// non deve aprire la pagina. Gli altri pulsanti restano subito utilizzabili.
let draggedTab = null;
for (const tab of nav.children) {
  tab.addEventListener('contextmenu', (e) => e.preventDefault());
  tab.addEventListener('click', (e) => {
    if (tab === draggedTab) {
      e.preventDefault();
      draggedTab = null;
    }
  });
  tab.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let timer = null;
    const cancel = () => {
      clearTimeout(timer);
      tab.removeEventListener('pointermove', onMove);
      tab.removeEventListener('pointerup', cancel);
      tab.removeEventListener('pointercancel', cancel);
    };
    const onMove = (ev) => {
      // Se il dito si sposta subito non è una pressione prolungata.
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 8) cancel();
    };
    tab.addEventListener('pointermove', onMove);
    tab.addEventListener('pointerup', cancel);
    tab.addEventListener('pointercancel', cancel);
    timer = setTimeout(() => {
      cancel();
      draggedTab = tab;
      navigator.vibrate?.(15);
      nav.classList.add('reordering');
      startDrag(tab, tab, e.pointerId, (ids) => {
        try {
          localStorage.setItem(NAV_ORDER_KEY, JSON.stringify(ids));
        } catch {}
      });
      const done = () => {
        nav.classList.remove('reordering');
        // Se il browser non genera il clic (dito spostato), non lo si aspetta oltre.
        setTimeout(() => { if (draggedTab === tab) draggedTab = null; }, 400);
      };
      tab.addEventListener('pointerup', done, { once: true });
      tab.addEventListener('pointercancel', done, { once: true });
    }, 450);
  });
}

// ---------- Navigazione ----------

const PAGES = { spese: render, statistiche: renderStats, aree: renderAreas, conti: renderAccounts };

function showPage() {
  const requested = location.hash.slice(1);
  const page = Object.hasOwn(PAGES, requested) ? requested : 'spese';
  for (const p of document.querySelectorAll('.page')) p.hidden = p.id !== `page-${page}`;
  for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t.dataset.page === page);
  PAGES[page]();
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
  let accounts = [];
  if (parsed && Array.isArray(parsed.expenses)) {
    list = parsed.expenses;
    if (Array.isArray(parsed.areas)) areas = parsed.areas;
    if (Array.isArray(parsed.accounts)) accounts = parsed.accounts;
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
  mergeAccounts(accounts);
  showPage();
  alert(`Importate ${data.expenses.length - before} spese.`);
});

// ---------- Avvio ----------

const today = new Date();
const iso = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString();
$('date').value = iso.slice(0, 10);
$('month').value = iso.slice(0, 7);
$('month').dataset.today = iso.slice(0, 7);

if (readLegacyVault()) {
  $('app').hidden = true;
  $('migrate').hidden = false;
} else {
  showPage();
}

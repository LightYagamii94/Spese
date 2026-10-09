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
      if (!Array.isArray(parsed.incomes)) parsed.incomes = [];
      if (!Array.isArray(parsed.transfers)) parsed.transfers = [];
      if (typeof parsed.partner !== 'string' || !parsed.partner) parsed.partner = 'Laura';
      if (!parsed.goal || !(parsed.goal.target > 0)) parsed.goal = { target: 10000 };
      if (!Array.isArray(parsed.goals)) parsed.goals = [];
      if (!Array.isArray(parsed.goalsDone)) parsed.goalsDone = [];
      return parsed;
    }
  } catch {}
  return { expenses: [], incomes: [], transfers: [], areas: [], accounts: [], partner: 'Laura', goal: { target: 10000 }, goals: [], goalsDone: [] };
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  updateDebtBadge();
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

// Dati di divisione di una spesa importata, controllati.
function cleanSplit(sp, amount) {
  if (!sp || typeof sp.mine !== 'number' || !['me', 'both', 'partner'].includes(sp.paidBy)) return null;
  if (sp.mine < 0 || sp.mine > amount) return null;
  return {
    mode: sp.mode === 'manual' ? 'manual' : 'half',
    mine: sp.mine,
    paidBy: sp.paidBy,
    settled: Boolean(sp.settled),
    ...(sp.settled && sp.settleAccountId ? { settleAccountId: String(sp.settleAccountId) } : {}),
    ...(sp.settled && sp.settledAt ? { settledAt: String(sp.settledAt) } : {}),
  };
}

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
        ...(cleanSplit(x.split, x.amount) ? { split: cleanSplit(x.split, x.amount) } : {}),
        amount: x.amount,
        ...(typeof x.at === 'number' ? { at: x.at } : {}),
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
// ---------- Spese divise con il/la partner ----------

const round2 = (n) => Math.round(n * 100) / 100;
const partnerName = () => data.partner || 'Laura';
// Quota a carico mio: conta nel budget e nelle statistiche.
const myShare = (x) => (x.split ? x.split.mine : x.amount);
const partnerShare = (x) => (x.split ? round2(x.amount - x.split.mine) : 0);

// Debito generato da una spesa divisa: "owed" = il/la partner mi deve,
// "owe" = devo io al/la partner. null se nessuno deve niente.
function debtOf(x) {
  if (!x.split) return null;
  if (x.split.paidBy === 'me' && partnerShare(x) > 0) return { dir: 'owed', amount: partnerShare(x) };
  if (x.split.paidBy === 'partner' && x.split.mine > 0) return { dir: 'owe', amount: x.split.mine };
  return null;
}

// Effetto di una spesa sul saldo di un conto (negativo = soldi usciti).
function accountFlow(x, accountId) {
  let flow = 0;
  if (x.accountId === accountId) {
    const paid = !x.split ? x.amount : x.split.paidBy === 'me' ? x.amount : x.split.paidBy === 'both' ? x.split.mine : 0;
    flow -= paid;
  }
  const debt = debtOf(x);
  if (debt && x.split.settled && x.split.settleAccountId === accountId) flow += debt.dir === 'owed' ? debt.amount : -debt.amount;
  return flow;
}

const openDebts = () => data.expenses.filter((x) => debtOf(x) && !x.split.settled);

function updateDebtBadge() {
  const badge = document.getElementById('debt-badge');
  if (!badge) return;
  const n = openDebts().length;
  badge.hidden = n === 0;
  badge.textContent = n > 9 ? '9+' : String(n);
}

// Somma di tutto ciò che è entrato (+) e uscito (−) da un conto.
function netFlow(a) {
  let flow = data.expenses.reduce((s, x) => s + accountFlow(x, a.id), 0);
  for (const x of data.incomes) if (x.accountId === a.id) flow += x.amount;
  for (const x of data.transfers) {
    if (x.toId === a.id) flow += x.amount;
    if (x.fromId === a.id) flow -= x.amount;
  }
  return flow;
}

const spentFromAccount = (a) => -netFlow(a);
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

// Tipo di movimento scelto nel modulo: 'expense' | 'income' | 'transfer'.
let formType = 'expense';
// Conto scelto per ogni tipo, così cambiando tipo non si perde la scelta.
const formAccounts = {};

function accountOption(a) {
  return el('option', { value: a.id, textContent: `${a.emoji} ${a.name}` });
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
  updateAreaButton();

  const acctSel = $('expense-account');
  const toSel = $('transfer-to');
  const accounts = data.accounts;
  if (formType === 'expense') {
    acctSel.replaceChildren(el('option', { value: '', textContent: 'Nessun conto' }), ...accounts.map(accountOption));
    const v = formAccounts.expense ?? last.accountId;
    acctSel.value = findAccount(v) ? v : '';
  } else {
    acctSel.replaceChildren(el('option', { value: '', textContent: 'Scegli un conto…', disabled: true }), ...accounts.map(accountOption));
    const v = formType === 'income' ? formAccounts.income ?? last.incomeAccountId : formAccounts.from ?? last.transferFrom;
    acctSel.value = findAccount(v) ? v : accounts[0]?.id ?? '';
  }
  toSel.replaceChildren(el('option', { value: '', textContent: 'Scegli un conto…', disabled: true }), ...accounts.map(accountOption));
  const to = formAccounts.to ?? last.transferTo;
  toSel.value = findAccount(to) && to !== acctSel.value ? to : accounts.find((a) => a.id !== acctSel.value)?.id ?? '';

  // Cosa serve per poter registrare il movimento scelto.
  const notice = $('no-areas');
  let missing = null;
  if (formType === 'expense' && !groups.length) missing = ['Per registrare una spesa crea prima almeno una macro area con una sotto area nella pagina ', 'Aree', '#aree'];
  if (formType === 'income' && !accounts.length) missing = ['Per registrare un\'entrata crea prima un conto nella pagina ', 'Conti', '#conti'];
  if (formType === 'transfer' && accounts.length < 2) missing = ['Per trasferire soldi servono almeno due conti: creali nella pagina ', 'Conti', '#conti'];
  notice.hidden = !missing;
  if (missing) notice.replaceChildren(missing[0], el('a', { href: missing[2], textContent: missing[1] }), '.');
  for (const c of $('expense-form').querySelectorAll('input, select, button')) {
    if (!c.closest('.type-switch')) c.disabled = Boolean(missing);
  }
}

function setFormType(type) {
  formType = type;
  const form = $('expense-form');
  form.dataset.type = type;
  for (const b of form.querySelectorAll('.type-switch button')) b.setAttribute('aria-pressed', String(b.dataset.type === type));
  $('acct-label').textContent = { expense: 'Pagata con', income: 'Sul conto', transfer: 'Dal conto' }[type];
  $('submit-label').textContent = editing ? 'Salva modifiche' : { expense: 'Aggiungi spesa', income: 'Aggiungi entrata', transfer: 'Trasferisci' }[type];
  $('description').placeholder = type === 'income' ? 'Es. Stipendio (facoltativa)' : 'Facoltativa';
  fillExpenseSelects();
  updateSplitUI();
}

for (const b of document.querySelectorAll('.type-switch button')) {
  b.addEventListener('click', () => setFormType(b.dataset.type));
}

$('expense-account').addEventListener('change', (e) => {
  formAccounts[{ expense: 'expense', income: 'income', transfer: 'from' }[formType]] = e.target.value;
  // Nel trasferimento i due conti devono essere diversi.
  if (formType === 'transfer' && $('transfer-to').value === e.target.value) {
    $('transfer-to').value = data.accounts.find((a) => a.id !== e.target.value)?.id ?? '';
    formAccounts.to = $('transfer-to').value;
  }
});
$('transfer-to').addEventListener('change', (e) => { formAccounts.to = e.target.value; });


// ---------- Selettore dell'area (macro aree a tendina) ----------

function updateAreaButton() {
  const found = findSub($('expense-area').value);
  $('area-btn').replaceChildren(...(found
    ? [el('span', { className: 'macro', textContent: found.macro.name }), el('span', { className: 'sub', textContent: found.sub.name })]
    : [el('span', { className: 'placeholder', textContent: 'Scegli un\'area…' })]));
}

function chooseArea(subId) {
  $('expense-area').value = subId;
  updateAreaButton();
  $('area-dialog').close();
  $('area-btn').focus();
}

function openAreaPicker() {
  const current = $('expense-area').value;
  const macros = data.areas.filter((m) => m.subs.length);
  const groups = macros.map((m) => {
    // Aperta solo la macro area della scelta attuale (o l'unica presente).
    const open = macros.length === 1 || m.subs.some((x) => x.id === current);
    const dot = el('span', { className: 'dot' });
    dot.style.background = AVATAR_COLORS[data.areas.indexOf(m) % AVATAR_COLORS.length];
    const head = el('button', { type: 'button', className: 'area-group-head' },
      dot,
      el('span', { className: 'name', textContent: m.name }),
      el('span', { className: 'count', textContent: String(m.subs.length) }),
      el('span', { className: 'chevron' }));
    head.setAttribute('aria-expanded', String(open));
    const subs = el('div', { className: 'area-subs', hidden: !open }, ...m.subs.map((sub) => {
      const b = el('button', { type: 'button', className: 'area-sub', textContent: sub.name });
      b.setAttribute('role', 'menuitemradio');
      b.setAttribute('aria-checked', String(sub.id === current));
      b.addEventListener('click', () => chooseArea(sub.id));
      return b;
    }));
    head.addEventListener('click', () => {
      subs.hidden = !subs.hidden;
      head.setAttribute('aria-expanded', String(!subs.hidden));
    });
    return el('div', { className: 'area-group' }, head, subs);
  });
  $('area-list').replaceChildren(...groups);
  $('area-dialog').showModal();
  ($('area-list').querySelector('[aria-checked="true"]') || $('area-list').querySelector('button'))?.focus();
}

$('area-btn').addEventListener('click', openAreaPicker);
$('expense-area').addEventListener('change', updateAreaButton);
$('area-close').addEventListener('click', () => $('area-dialog').close());
$('area-dialog').addEventListener('click', (e) => {
  if (e.target === $('area-dialog')) $('area-dialog').close();
});

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

// Importo nell'elenco: per le spese divise la mia quota, con il totale sotto.
function amountCell(x) {
  const cell = el('span', { className: 'expense-amount', textContent: `−${euro.format(myShare(x))}` });
  if (x.split) cell.append(el('small', { textContent: `di ${euro.format(x.amount)}` }));
  return cell;
}

function splitChips(x) {
  if (!x.split) return [];
  const chips = [el('span', { className: 'chip', textContent: `👥 con ${partnerName()}` })];
  const debt = debtOf(x);
  if (debt) {
    const text = x.split.settled ? 'saldato ✓'
      : debt.dir === 'owed' ? `${partnerName()} ti deve ${euro.format(debt.amount)}` : `devi ${euro.format(debt.amount)} a ${partnerName()}`;
    chips.push(el('span', { className: `chip ${x.split.settled ? 'ok' : 'debt'}`, textContent: text }));
  }
  return chips;
}

// Nome da mostrare per una spesa: la descrizione, oppure (se vuota) la sotto area.
function expenseTitle(x) {
  if (x.description) return x.description;
  const found = x.subId ? findSub(x.subId) : null;
  return found ? found.sub.name : x.category || 'Spesa';
}

function dateBadge(date, kind = '') {
  const [, mo, d] = date.split('-');
  return el('span', { className: `date-badge ${kind}`.trim() }, el('b', { textContent: d }), el('small', { textContent: MONTHS[Number(mo) - 1] }));
}

const accountChip = (a) => el('span', { className: 'chip', textContent: a ? `${a.emoji} ${a.name}` : 'Conto eliminato' });

// Riga dell'elenco: toccandola si apre la modifica (il cestino resta a parte).
function editableRow(kind, x, ...children) {
  const li = el('li', { className: `editable${editing?.id === x.id ? ' is-editing' : ''}` }, ...children);
  li.tabIndex = 0;
  li.setAttribute('role', 'button');
  li.setAttribute('aria-label', `Modifica ${kind === 'expense' ? expenseTitle(x) : x.description || KIND_NAME[kind]}`);
  li.addEventListener('click', (e) => {
    if (!e.target.closest('.icon-btn')) startEdit(kind, x);
  });
  li.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target === li) {
      e.preventDefault();
      startEdit(kind, x);
    }
  });
  return li;
}

function expenseRow(x) {
  const found = x.subId ? findSub(x.subId) : null;
  const account = x.accountId ? findAccount(x.accountId) : null;
  const tags = [];
  if (found) tags.push(el('span', { className: 'chip', textContent: `${found.macro.name} › ${found.sub.name}` }));
  else if (x.category) tags.push(el('span', { className: 'chip muted', textContent: x.category }));
  else tags.push(el('span', { className: 'chip muted', textContent: x.subId ? 'Area eliminata' : 'Senza area' }));
  if (account && !(x.split && x.split.paidBy === 'partner')) tags.push(accountChip(account));
  tags.push(...splitChips(x));

  const title = expenseTitle(x);
  const del = iconButton('trash', `Elimina ${title}`, 'danger');
  del.addEventListener('click', () => {
    const back = account && accountFlow(x, account.id) < 0 ? `\n${euro.format(-accountFlow(x, account.id))} torneranno sul conto "${account.name}".` : '';
    const debt = debtOf(x);
    const debtNote = debt && !x.split.settled ? '\nVerrà eliminato anche il debito collegato.' : '';
    if (!confirm(`Eliminare "${title}"?${back}${debtNote}`)) return;
    data.expenses = data.expenses.filter((y) => y.id !== x.id);
    if (editing?.id === x.id) stopEdit();
    save();
    render();
  });
  return editableRow('expense', x, dateBadge(x.date),
    el('div', { className: 'expense-main' }, el('div', { className: 'desc', textContent: title }), el('div', { className: 'tags' }, ...tags)),
    amountCell(x), del);
}

function incomeRow(x) {
  const account = findAccount(x.accountId);
  const title = x.description || 'Entrata';
  const del = iconButton('trash', `Elimina ${title}`, 'danger');
  del.addEventListener('click', () => {
    const note = account ? `\n${euro.format(x.amount)} verranno tolti dal conto "${account.name}".` : '';
    if (!confirm(`Eliminare l'entrata "${title}"?${note}`)) return;
    data.incomes = data.incomes.filter((y) => y.id !== x.id);
    if (editing?.id === x.id) stopEdit();
    save();
    render();
  });
  return editableRow('income', x, dateBadge(x.date, 'in'),
    el('div', { className: 'expense-main' }, el('div', { className: 'desc', textContent: title }),
      el('div', { className: 'tags' }, el('span', { className: 'chip ok', textContent: 'Entrata' }), accountChip(account))),
    el('span', { className: 'expense-amount in', textContent: `+${euro.format(x.amount)}` }), del);
}

function transferRow(x) {
  const from = findAccount(x.fromId);
  const to = findAccount(x.toId);
  const title = x.description || 'Trasferimento';
  const del = iconButton('trash', `Elimina ${title}`, 'danger');
  del.addEventListener('click', () => {
    const note = from && to ? `\n${euro.format(x.amount)} torneranno da "${to.name}" a "${from.name}".` : '';
    if (!confirm(`Annullare il trasferimento "${title}"?${note}`)) return;
    data.transfers = data.transfers.filter((y) => y.id !== x.id);
    if (editing?.id === x.id) stopEdit();
    save();
    render();
  });
  const route = `${from ? `${from.emoji} ${from.name}` : '?'} → ${to ? `${to.emoji} ${to.name}` : '?'}`;
  return editableRow('transfer', x, dateBadge(x.date, 'move'),
    el('div', { className: 'expense-main' }, el('div', { className: 'desc', textContent: title }),
      el('div', { className: 'tags' }, el('span', { className: 'chip', textContent: route }))),
    el('span', { className: 'expense-amount move', textContent: euro.format(x.amount) }), del);
}

function render() {
  fillExpenseSelects();
  const month = $('month').value;
  const inMonth = (x) => x.date.startsWith(month);
  const expenses = data.expenses.filter(inMonth);
  const incomes = data.incomes.filter(inMonth);
  const transfers = data.transfers.filter(inMonth);

  // Un unico elenco, dal più recente; a parità di data prima l'ultimo inserito
  // (`at` = momento dell'inserimento; i movimenti più vecchi non ce l'hanno).
  const rows = [
    ...expenses.map((x) => ({ x, row: expenseRow })),
    ...incomes.map((x) => ({ x, row: incomeRow })),
    ...transfers.map((x) => ({ x, row: transferRow })),
  ].sort((a, b) => b.x.date.localeCompare(a.x.date) || (b.x.at || 0) - (a.x.at || 0)).map((r) => r.row(r.x));
  $('rows').replaceChildren(...rows);
  $('empty').hidden = rows.length > 0;

  const total = round2(expenses.reduce((s, x) => s + myShare(x), 0));
  $('total').textContent = euro.format(total);

  const totalBudget = data.areas.reduce((s, m) => s + macroBudget(m), 0);
  $('budget-hint').textContent = totalBudget > 0
    ? `su ${euro.format(totalBudget)} di budget · ${total <= totalBudget ? `restano ${euro.format(totalBudget - total)}` : `sforato di ${euro.format(total - totalBudget)}`}`
    : '';

  const income = round2(incomes.reduce((s, x) => s + x.amount, 0));
  const balance = round2(income - total);
  $('income-hint').textContent = income > 0
    ? `Entrate ${euro.format(income)} · ${balance >= 0 ? `risparmiati ${euro.format(balance)}` : `in negativo di ${euro.format(-balance)}`}`
    : '';
}

// ---------- Statistiche ----------

const stats = { period: 'month' };
const monthIndex = (ym) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;
const MONTH_NAMES = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

// Macro aree chiuse a tendina nelle statistiche (preferenza di questo browser).
const STATS_COLLAPSED_KEY = 'spese.ui.statsCollapsed';
const statsCollapsed = (() => {
  try {
    return new Set(JSON.parse(localStorage.getItem(STATS_COLLAPSED_KEY)) || []);
  } catch {
    return new Set();
  }
})();

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

  for (const b of document.querySelectorAll('#page-statistiche .segmented button')) b.setAttribute('aria-pressed', String(b.dataset.period === stats.period));
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
    const mine = myShare(x);
    spentTotal += mine;
    if (x.subId && findSub(x.subId)) spentBySub[x.subId] = (spentBySub[x.subId] || 0) + mine;
    else unassigned += mine;
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
      const subs = el('ul', { className: 'budget-subs', hidden: statsCollapsed.has(m.id) },
        ...m.subs.map((sub) => el('li', {}, budgetRow(sub.name, spentBySub[sub.id] || 0, sub.budget * months))));
      // Tutta la riga della macro area apre/chiude l'elenco delle sotto aree.
      const head = el('div', { className: 'budget-head', tabIndex: 0 },
        el('span', { className: 'chevron', ariaHidden: 'true' }),
        budgetRow(m.name, spent, macroBudget(m) * months, dot));
      head.setAttribute('role', 'button');
      head.setAttribute('aria-expanded', String(!subs.hidden));
      head.setAttribute('aria-label', `${m.name}: mostra o nascondi le sotto aree`);
      const toggle = () => {
        subs.hidden = !subs.hidden;
        head.setAttribute('aria-expanded', String(!subs.hidden));
        if (subs.hidden) statsCollapsed.add(m.id); else statsCollapsed.delete(m.id);
        try {
          localStorage.setItem(STATS_COLLAPSED_KEY, JSON.stringify([...statsCollapsed]));
        } catch {}
      };
      head.addEventListener('click', toggle);
      head.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
        }
      });
      return el('li', { className: 'budget-macro' }, head, subs);
    });
  if (unassigned > 0) blocks.push(el('li', { className: 'budget-macro' }, budgetRow('Senza area', unassigned, 0)));
  $('budget-list').replaceChildren(...blocks);
  $('stats-empty').hidden = blocks.length > 0;
}

for (const b of document.querySelectorAll('#page-statistiche .segmented button')) {
  b.addEventListener('click', () => {
    stats.period = b.dataset.period;
    renderStats();
  });
}
$('stats-month').addEventListener('change', renderStats);
$('stats-year').addEventListener('change', renderStats);

// ---------- Inserimento e modifica dei movimenti ----------

const KIND_KEY = { expense: 'expenses', income: 'incomes', transfer: 'transfers' };
const KIND_NAME = { expense: 'Spesa', income: 'Entrata', transfer: 'Trasferimento' };

// Movimento in modifica: { kind, id } oppure null se si sta inserendo.
let editing = null;

function findMovement(kind, id) {
  return data[KIND_KEY[kind]].find((x) => x.id === id);
}

// Riempie il modulo con un movimento esistente per modificarlo.
function startEdit(kind, x) {
  editing = { kind, id: x.id };
  if (kind === 'expense') {
    formAccounts.expense = x.accountId || '';
    $('expense-area').value = x.subId || '';
  } else if (kind === 'income') {
    formAccounts.income = x.accountId;
  } else {
    formAccounts.from = x.fromId;
    formAccounts.to = x.toId;
  }
  setFormType(kind);
  if (kind === 'expense') {
    // Una spesa con area eliminata: si sceglie di nuovo l'area.
    $('expense-area').value = findSub(x.subId) ? x.subId : '';
    updateAreaButton();
    $('split-on').checked = Boolean(x.split);
    if (x.split) {
      splitState.mode = x.split.mode === 'manual' ? 'manual' : 'half';
      splitState.paid = x.split.paidBy;
      $('split-mine').value = x.split.mode === 'manual' ? x.split.mine : '';
    }
    updateSplitUI();
  } else {
    $('split-on').checked = false;
    updateSplitUI();
  }
  $('description').value = x.description || '';
  $('date').value = x.date;
  $('amount').value = x.amount;
  if (kind === 'expense' && x.split) updateSplitSummary();
  $('edit-title').textContent = `Stai modificando: ${kind === 'expense' ? expenseTitle(x) : x.description || KIND_NAME[kind]}`;
  $('edit-bar').hidden = false;
  $('expense-form').classList.add('editing');
  $('submit-label').textContent = 'Salva modifiche';
  $('edit-bar').scrollIntoView({ behavior: 'smooth', block: 'start' });
  render();
}

// Data di oggi (fuso orario locale) nel formato AAAA-MM-GG.
function todayIso() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function stopEdit() {
  editing = null;
  $('edit-bar').hidden = true;
  $('expense-form').classList.remove('editing');
  // Finita la modifica il modulo torna pronto per un nuovo movimento di oggi.
  $('date').value = todayIso();
  $('description').value = '';
  $('amount').value = '';
  $('split-mine').value = '';
  $('split-on').checked = false;
  setFormType(formType);
}

$('edit-cancel').addEventListener('click', () => {
  stopEdit();
  render();
});

// Salva un nuovo movimento, oppure sostituisce quello in modifica (anche se
// cambia tipo: es. da spesa a entrata) mantenendone id e ordine.
function storeMovement(kind, item) {
  const key = KIND_KEY[kind];
  if (!editing) {
    data[key].push({ id: crypto.randomUUID(), ...item, at: Date.now() });
  } else {
    const oldKey = KIND_KEY[editing.kind];
    const old = findMovement(editing.kind, editing.id);
    const updated = { id: editing.id, ...item, ...(old?.at ? { at: old.at } : {}) };
    const i = data[key].findIndex((x) => x.id === editing.id);
    if (oldKey === key && i >= 0) data[key][i] = updated;
    else {
      data[oldKey] = data[oldKey].filter((x) => x.id !== editing.id);
      data[key].push(updated);
    }
  }
  save();
}

// Dopo il salvataggio: avviso se il movimento è di un altro mese e pulizia dei campi.
function afterSave(kind) {
  const wasEditing = Boolean(editing);
  const savedMonth = $('date').value.slice(0, 7);
  if (wasEditing) stopEdit();
  if (savedMonth !== $('month').value) {
    const [yy, mm] = savedMonth.split('-');
    showToast(`${kind} salvat${kind === 'Trasferimento' ? 'o' : 'a'} a ${MONTH_NAMES[Number(mm) - 1]} ${yy}`, 'Vedi', () => {
      $('month').value = savedMonth;
      render();
    });
  } else if (wasEditing) {
    showToast('Modifica salvata', '', () => {});
  }
  $('description').value = '';
  $('amount').value = '';
  if (!wasEditing) $('amount').focus();
  render();
}

$('expense-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const amount = Math.round(parseFloat($('amount').value) * 100) / 100;
  const date = $('date').value;
  const description = $('description').value.trim();
  if (formType === 'income') {
    const accountId = $('expense-account').value;
    if (!findAccount(accountId) || !(amount > 0)) return;
    storeMovement('income', { date, description, accountId, amount });
    saveLast({ ...readLast(), incomeAccountId: accountId });
    afterSave('Entrata');
    return;
  }
  if (formType === 'transfer') {
    const fromId = $('expense-account').value;
    const toId = $('transfer-to').value;
    if (!findAccount(fromId) || !findAccount(toId) || !(amount > 0)) return;
    if (fromId === toId) {
      showToast('Scegli due conti diversi', '', () => {});
      return;
    }
    storeMovement('transfer', { date, description, fromId, toId, amount });
    saveLast({ ...readLast(), transferFrom: fromId, transferTo: toId });
    afterSave('Trasferimento');
    return;
  }
  const subId = $('expense-area').value;
  if (!findSub(subId)) {
    openAreaPicker();
    return;
  }
  if (!(amount > 0)) return;
  // La descrizione è facoltativa: se vuota, nell'elenco si vede il nome della sotto area.
  let split = null;
  if ($('split-on').checked) {
    const mine = splitMine(amount);
    if (mine === null) {
      updateSplitSummary();
      $('split-mine').focus();
      return;
    }
    split = { mode: splitState.mode, mine, paidBy: splitState.paid, settled: false };
    // In modifica, un debito già saldato resta saldato se chi ha pagato non cambia.
    const old = editing && editing.kind === 'expense' ? findMovement('expense', editing.id) : null;
    if (old?.split?.settled && old.split.paidBy === split.paidBy && debtOf({ amount, split })) {
      split.settled = true;
      if (old.split.settledAt) split.settledAt = old.split.settledAt;
      if (old.split.settleAccountId) split.settleAccountId = old.split.settleAccountId;
    }
  }
  // Se ha pagato tutto il/la partner, dai miei conti non esce nulla (per ora).
  const accountId = split && split.paidBy === 'partner' ? '' : $('expense-account').value;
  storeMovement('expense', {
    date,
    description,
    subId,
    ...(findAccount(accountId) ? { accountId } : {}),
    ...(split ? { split } : {}),
    amount,
  });
  saveLast({ ...readLast(), subId, accountId });
  $('split-mine').value = '';
  $('split-on').checked = false;
  updateSplitUI();
  afterSave('Spesa');
});

// ---------- Modulo: divisione della spesa ----------

const splitState = { mode: 'half', paid: 'me' };

// Mia quota in base alla scelta; null se l'importo manuale non è valido.
function splitMine(amount) {
  if (splitState.mode === 'half') return round2(amount / 2);
  const v = $('split-mine').value;
  if (v === '') return null;
  const mine = round2(parseFloat(v));
  return Number.isFinite(mine) && mine >= 0 && mine <= amount ? mine : null;
}

function updateSplitSummary() {
  const out = $('split-summary');
  const amount = round2(parseFloat($('amount').value));
  if (!(amount > 0)) {
    out.replaceChildren('Inserisci l\'importo per vedere la divisione.');
    return;
  }
  const mine = splitMine(amount);
  if (mine === null) {
    out.replaceChildren(el('span', { className: 'error', textContent: `La tua parte deve essere tra 0 e ${euro.format(amount)}.` }));
    return;
  }
  const other = round2(amount - mine);
  const name = partnerName();
  let debt = 'nessun debito';
  if (splitState.paid === 'me' && other > 0) debt = `${name} ti deve ${euro.format(other)}`;
  if (splitState.paid === 'partner' && mine > 0) debt = `devi ${euro.format(mine)} a ${name}`;
  out.replaceChildren(`Tu ${euro.format(mine)} · ${name} ${euro.format(other)} → `, el('span', { className: 'debt', textContent: debt }));
}

function updateSplitUI() {
  const on = $('split-on').checked;
  $('split-box').hidden = !on;
  $('split-mine-field').hidden = splitState.mode !== 'manual';
  $('split-mine').required = on && splitState.mode === 'manual';
  for (const b of document.querySelectorAll('.choice button')) {
    const group = b.parentElement.dataset.group;
    b.setAttribute('aria-pressed', String(b.dataset.value === splitState[group]));
  }
  // Se paga tutto il/la partner il conto non serve.
  document.querySelector('.f-acct').hidden = formType === 'expense' && on && splitState.paid === 'partner';
  if (on) updateSplitSummary();
}

for (const b of document.querySelectorAll('.choice button')) {
  b.addEventListener('click', () => {
    splitState[b.parentElement.dataset.group] = b.dataset.value;
    updateSplitUI();
    if (b.dataset.value === 'manual') $('split-mine').focus();
  });
}
$('split-on').addEventListener('change', updateSplitUI);
$('amount').addEventListener('input', () => { if ($('split-on').checked) updateSplitSummary(); });
$('split-mine').addEventListener('input', updateSplitSummary);

$('month').addEventListener('change', render);

// Avviso temporaneo in basso, con un pulsante facoltativo.
let toastTimer;
// `duration` in millisecondi; 0 = resta finché non si preme il pulsante.
function showToast(text, actionLabel, onAction, duration = 6000) {
  const toast = $('toast');
  const action = el('button', { type: 'button', className: 'toast-action', textContent: actionLabel });
  action.addEventListener('click', () => {
    toast.hidden = true;
    onAction();
  });
  toast.replaceChildren(el('span', { textContent: text }), ...(actionLabel ? [action] : []));
  toast.hidden = false;
  clearTimeout(toastTimer);
  if (duration) toastTimer = setTimeout(() => { toast.hidden = true; }, duration);
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
      const linked = data.expenses.filter((x) => x.accountId === a.id).length
        + data.incomes.filter((x) => x.accountId === a.id).length
        + data.transfers.filter((x) => x.fromId === a.id || x.toId === a.id).length;
      const note = linked ? `\nI ${linked} movimenti collegati a questo conto resteranno registrati.` : '';
      if (!confirm(`Eliminare il conto "${a.name}"?${note}`)) return;
      data.accounts = data.accounts.filter((x) => x.id !== a.id);
      save();
      renderAccounts();
    });

    const handle = iconButton('grip', `Trascina per riordinare ${a.name} (o usa le frecce)`, 'handle');
    // Conti con soldi non "miei" (es. altre attività): esclusi dal cassetto.
    const exclInput = el('input', { type: 'checkbox', checked: Boolean(a.excluded) });
    exclInput.addEventListener('change', () => {
      if (exclInput.checked) a.excluded = true;
      else delete a.excluded;
      save();
      renderAccounts();
    });
    const excl = el('label', { className: 'switch small' }, exclInput, el('span', { className: 'switch-ui', ariaHidden: 'true' }), el('span', { textContent: 'Escludi dal cassetto' }));
    const li = el('li', { className: a.excluded ? 'excluded' : '' }, handle, emoji, name, del, wrap, excl);
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

// Aggiunge gli elementi importati non ancora presenti (stesso id), dopo averli controllati.
function mergeById(key, list, clean) {
  const ids = new Set(data[key].map((x) => x.id));
  for (const x of list) {
    if (!x || !x.id || ids.has(x.id) || typeof x.date !== 'string' || typeof x.amount !== 'number' || !(x.amount > 0)) continue;
    const item = clean(x);
    if (!item) continue;
    data[key].push(item);
    ids.add(item.id);
  }
}

function mergeAccounts(list) {
  const ids = new Set(data.accounts.map((x) => x.id));
  for (const a of list) {
    if (a && a.id && !ids.has(a.id) && typeof a.name === 'string') {
      data.accounts.push({
        id: String(a.id),
        name: a.name,
        emoji: firstGrapheme(String(a.emoji ?? '')) || DEFAULT_ACCOUNT_EMOJI,
        balance: parseAmount(a.balance ?? 0),
        ...(a.excluded ? { excluded: true } : {}),
      });
      ids.add(a.id);
    }
  }
  save();
}

// ---------- Debiti ----------

function applyPartnerName() {
  for (const n of document.querySelectorAll('.partner-name')) n.textContent = partnerName();
  if (document.activeElement !== $('partner-input')) $('partner-input').value = partnerName();
}

$('partner-input').addEventListener('change', () => {
  const v = $('partner-input').value.trim();
  if (v) {
    data.partner = v;
    save();
  }
  applyPartnerName();
  renderDebts();
});

function accountOptions(selected) {
  const sel = $('settle-account');
  sel.replaceChildren(
    el('option', { value: '', textContent: 'Nessun conto (non tracciato)' }),
    ...data.accounts.map((a) => el('option', { value: a.id, textContent: `${a.emoji} ${a.name}` })));
  sel.value = findAccount(selected) ? selected : '';
}

// Finestra di conferma: niente viene modificato finché non si preme "Conferma".
let settleAction = null;
function openSettleDialog({ title, text, accountLabel, account, onConfirm }) {
  $('settle-title').textContent = title;
  $('settle-text').replaceChildren(...text);
  $('settle-account-label').textContent = accountLabel;
  accountOptions(account);
  settleAction = onConfirm;
  $('settle-dialog').showModal();
}
$('settle-cancel').addEventListener('click', () => {
  settleAction = null;
  $('settle-dialog').close();
});
$('settle-dialog').addEventListener('close', () => { settleAction = null; });
$('settle-form').addEventListener('submit', () => {
  const action = settleAction;
  const accountId = $('settle-account').value;
  settleAction = null;
  if (action) action(accountId);
});

function markSettled(list, accountId) {
  const when = new Date().toISOString().slice(0, 10);
  for (const x of list) {
    x.split.settled = true;
    x.split.settledAt = when;
    if (findAccount(accountId)) x.split.settleAccountId = accountId;
    else delete x.split.settleAccountId;
  }
  save();
  renderDebts();
}

function debtItem(x, settled) {
  const debt = debtOf(x);
  const [, mo, d] = x.date.split('-');
  const found = x.subId ? findSub(x.subId) : null;
  const tags = [];
  if (found) tags.push(el('span', { className: 'chip', textContent: `${found.macro.name} › ${found.sub.name}` }));
  tags.push(el('span', { className: 'chip', textContent: `totale ${euro.format(x.amount)}` }));
  let action;
  if (settled) {
    const acc = x.split.settleAccountId ? findAccount(x.split.settleAccountId) : null;
    const [sy, sm, sd] = (x.split.settledAt || '').split('-');
    tags.push(el('span', { className: 'chip ok', textContent: `saldato${sd ? ` il ${sd}/${sm}/${sy}` : ''}${acc ? ` · ${acc.emoji} ${acc.name}` : ''}` }));
    action = el('button', { type: 'button', className: 'btn ghost', textContent: 'Annulla' });
    action.title = 'Segna di nuovo come da saldare';
    action.addEventListener('click', () => {
      if (!confirm(`Segnare di nuovo "${expenseTitle(x)}" come da saldare?${acc ? `\nIl movimento sul conto "${acc.name}" verrà annullato.` : ''}`)) return;
      x.split.settled = false;
      delete x.split.settleAccountId;
      delete x.split.settledAt;
      save();
      renderDebts();
    });
  } else {
    action = el('button', { type: 'button', className: 'btn primary', textContent: 'Saldato' });
    action.addEventListener('click', () => {
      const name = partnerName();
      const owed = debt.dir === 'owed';
      openSettleDialog({
        title: owed ? `${name} ti ha restituito i soldi?` : `Hai restituito i soldi a ${name}?`,
        text: [owed ? `${name} ti restituisce ` : `Restituisci a ${name} `, el('b', { textContent: euro.format(debt.amount) }), ` per "${expenseTitle(x)}".`],
        accountLabel: owed ? 'Su quale conto sono arrivati?' : 'Da quale conto sono usciti?',
        account: x.accountId || readLast().accountId,
        onConfirm: (accountId) => markSettled([x], accountId),
      });
    });
  }
  return el('li', {},
    el('span', { className: 'date-badge' }, el('b', { textContent: d }), el('small', { textContent: MONTHS[Number(mo) - 1] })),
    el('div', { className: 'expense-main' }, el('div', { className: 'desc', textContent: expenseTitle(x) }), el('div', { className: 'tags' }, ...tags)),
    el('div', { className: 'debt-side' }, el('span', { className: 'expense-amount', textContent: euro.format(debt.amount) }), action));
}

function renderDebts() {
  applyPartnerName();
  const name = partnerName();
  const byDate = (a, b) => b.date.localeCompare(a.date);
  const open = openDebts().sort(byDate);
  const owed = open.filter((x) => debtOf(x).dir === 'owed');
  const owe = open.filter((x) => debtOf(x).dir === 'owe');
  const settled = data.expenses.filter((x) => debtOf(x) && x.split.settled)
    .sort((a, b) => (b.split.settledAt || '').localeCompare(a.split.settledAt || '') || byDate(a, b));

  const owedTotal = round2(owed.reduce((s, x) => s + debtOf(x).amount, 0));
  const oweTotal = round2(owe.reduce((s, x) => s + debtOf(x).amount, 0));
  const net = round2(owedTotal - oweTotal);
  $('debt-label').textContent = net > 0 ? `${name} ti deve` : net < 0 ? `Devi a ${name}` : 'Siete in pari';
  $('debt-net').textContent = euro.format(Math.abs(net));
  $('debt-sub').textContent = owed.length && owe.length
    ? `${name} ti deve ${euro.format(owedTotal)} · tu le devi ${euro.format(oweTotal)}`
    : open.length ? `${open.length} ${open.length === 1 ? 'spesa da saldare' : 'spese da saldare'}` : 'Nessun debito da saldare';
  $('settle-all').disabled = open.length === 0;

  $('owed-list').replaceChildren(...owed.map((x) => debtItem(x, false)));
  $('owed-empty').hidden = owed.length > 0;
  $('owe-list').replaceChildren(...owe.map((x) => debtItem(x, false)));
  $('owe-empty').hidden = owe.length > 0;
  $('settled-list').replaceChildren(...settled.map((x) => debtItem(x, true)));
  $('settled-count').textContent = String(settled.length);
  $('settled-list').closest('details').hidden = settled.length === 0;
}

$('settle-all').addEventListener('click', () => {
  const open = openDebts();
  if (!open.length) return;
  const name = partnerName();
  const owedTotal = round2(open.filter((x) => debtOf(x).dir === 'owed').reduce((s, x) => s + debtOf(x).amount, 0));
  const oweTotal = round2(open.filter((x) => debtOf(x).dir === 'owe').reduce((s, x) => s + debtOf(x).amount, 0));
  const net = round2(owedTotal - oweTotal);
  const details = [];
  if (owedTotal) details.push(el('li', { textContent: `${name} ti deve ${euro.format(owedTotal)}` }));
  if (oweTotal) details.push(el('li', { textContent: `Tu devi ${euro.format(oweTotal)} a ${name}` }));
  const outcome = net > 0 ? [`${name} ti dà `, el('b', { textContent: euro.format(net) })]
    : net < 0 ? ['Tu dai ', el('b', { textContent: euro.format(-net) }), ` a ${name}`] : ['Vi compensate: nessuno deve dare soldi.'];
  openSettleDialog({
    title: `Saldare tutti i ${open.length} debiti?`,
    text: [...outcome, el('ul', {}, ...details)],
    accountLabel: net >= 0 ? 'Su quale conto arrivano i soldi?' : 'Da quale conto escono i soldi?',
    account: readLast().accountId,
    onConfirm: (accountId) => markSettled(open, accountId),
  });
});

// ---------- Obiettivi: il cassetto ----------
// Cassetto = saldo totale − conti esclusi − budget ancora da spendere nel mese
// in corso (per sotto area, solo residui positivi) − debiti aperti verso il/la partner.

function stashBreakdown() {
  const nowYm = $('month').dataset.today;
  const total = round2(data.accounts.reduce((s, a) => s + currentBalance(a), 0));
  const excludedAccounts = data.accounts.filter((a) => a.excluded);
  const excluded = round2(excludedAccounts.reduce((s, a) => s + currentBalance(a), 0));

  const spentBySub = {};
  for (const x of data.expenses) {
    if (x.date.startsWith(nowYm) && x.subId) spentBySub[x.subId] = (spentBySub[x.subId] || 0) + myShare(x);
  }
  let reserved = 0;
  for (const m of data.areas) for (const sub of m.subs) reserved += Math.max(0, sub.budget - (spentBySub[sub.id] || 0));
  reserved = round2(reserved);

  const owe = round2(openDebts().filter((x) => debtOf(x).dir === 'owe').reduce((s, x) => s + debtOf(x).amount, 0));
  const owed = round2(openDebts().filter((x) => debtOf(x).dir === 'owed').reduce((s, x) => s + debtOf(x).amount, 0));
  return { nowYm, total, excludedAccounts, excluded, reserved, owe, owed, stash: round2(total - excluded - reserved - owe) };
}

// Risparmio medio mensile (entrate − mie spese), senza i conti esclusi.
// Si usano gli ultimi mesi completi (fino a 6); se non ce ne sono ancora, il mese in corso.
function monthlySavings(nowYm) {
  const isExcluded = (id) => Boolean(id && findAccount(id)?.excluded);
  const byMonth = {};
  const add = (date, v) => { const ym = date.slice(0, 7); byMonth[ym] = (byMonth[ym] || 0) + v; };
  for (const x of data.incomes) if (!isExcluded(x.accountId)) add(x.date, x.amount);
  for (const x of data.expenses) if (!isExcluded(x.accountId)) add(x.date, -myShare(x));
  const months = Object.keys(byMonth).filter((ym) => ym < nowYm).sort().slice(-6);
  if (months.length) return { avg: round2(months.reduce((s, ym) => s + byMonth[ym], 0) / months.length), months: months.length, partial: false };
  if (byMonth[nowYm] !== undefined) return { avg: round2(byMonth[nowYm]), months: 0, partial: true };
  return null;
}

function renderGoals() {
  const b = stashBreakdown();
  const target = data.goal.target;
  const progress = Math.max(0, Math.min(1, b.stash / target));
  const reached = b.stash >= target;
  $('stash-value').textContent = euro.format(b.stash);
  $('goal-percent').textContent = `${Math.floor(progress * 100)}%`;
  $('goal-bar').style.width = `${progress * 100}%`;
  document.querySelector('.goal-hero').classList.toggle('reached', reached);
  $('goal-sub').textContent = reached
    ? `🎉 Obiettivo di ${euro.format(target)} raggiunto!`
    : `Obiettivo ${euro.format(target)} · mancano ${euro.format(target - b.stash)}`;
  if (document.activeElement !== $('goal-target')) $('goal-target').value = target;

  const monthName = `${MONTH_NAMES[Number(b.nowYm.slice(5, 7)) - 1]}`;
  const row = (what, val, note, cls = '') => el('li', { className: cls },
    el('span', { className: 'what', textContent: what }),
    el('span', { className: 'val', textContent: val }),
    ...(note ? [el('span', { className: 'note', textContent: note })] : []));
  const rows = [
    row('Saldo totale dei conti', euro.format(b.total), data.accounts.length ? '' : 'Nessun conto: aggiungili nella pagina Conti.'),
    row('Conti esclusi', `− ${euro.format(b.excluded)}`, b.excludedAccounts.length ? b.excludedAccounts.map((a) => `${a.emoji} ${a.name}`).join(', ') : 'Nessun conto escluso', 'minus'),
    row(`Budget ancora da spendere a ${monthName}`, `− ${euro.format(b.reserved)}`, 'Quanto resta in ogni sotto area questo mese (le aree sforate contano zero)', 'minus'),
    row(`Debiti verso ${partnerName()}`, `− ${euro.format(b.owe)}`, b.owed ? `Non contati: i ${euro.format(b.owed)} che ${partnerName()} ti deve, finché non li restituisce` : '', 'minus'),
    row('Cassetto', euro.format(b.stash), '', 'result'),
  ];
  $('stash-calc').replaceChildren(...rows);

  const sav = monthlySavings(b.nowYm);
  let main;
  let note = '';
  if (reached) {
    main = ['Hai già raggiunto l\'obiettivo. Puoi alzarlo qui sotto.'];
  } else if (!sav) {
    main = ['Registra entrate e spese per avere una previsione.'];
  } else if (sav.avg <= 0) {
    main = ['Al ritmo attuale l\'obiettivo non si avvicina: le spese superano le entrate.'];
    note = `Media: ${euro.format(sav.avg)} al mese.`;
  } else {
    const n = Math.ceil((target - b.stash) / sav.avg);
    const when = shiftMonth(b.nowYm, n);
    main = ['Lo raggiungi circa a ', el('b', { textContent: `${MONTH_NAMES[Number(when.slice(5, 7)) - 1]} ${when.slice(0, 4)}` }), ` (tra ${n} ${n === 1 ? 'mese' : 'mesi'})`];
    note = sav.partial
      ? `Stima provvisoria basata sul mese in corso (risparmiati finora ${euro.format(sav.avg)}): diventerà più precisa con i mesi.`
      : `Risparmi in media ${euro.format(sav.avg)} al mese (entrate − tue spese, ${sav.months === 1 ? 'ultimo mese completo' : `ultimi ${sav.months} mesi completi`}, senza i conti esclusi).`;
  }
  $('forecast-main').replaceChildren(...main);
  $('forecast-note').textContent = note;
  renderOtherGoals(b, sav);
}

// ---------- Altri obiettivi ----------
// Vengono riempiti in ordine (priorità = posizione nell'elenco) con l'avanzo,
// cioè la parte del cassetto che supera il suo obiettivo.

const ymLabel = (ym) => `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

function renderOtherGoals(b, sav) {
  const cassettoTarget = data.goal.target;
  const surplus = round2(Math.max(0, b.stash - cassettoTarget));
  let available = surplus;
  // Quanto manca, in totale, prima che ogni obiettivo sia pieno (cassetto compreso).
  let missingBefore = Math.max(0, cassettoTarget - b.stash);
  $('surplus-hint').textContent = b.stash >= cassettoTarget
    ? `Avanzo del cassetto: ${euro.format(surplus)}`
    : `Partono quando il cassetto supera ${euro.format(cassettoTarget)}`;

  const items = data.goals.map((g, index) => {
    const funded = round2(Math.min(g.target, available));
    available = round2(available - funded);
    missingBefore += g.target - funded;
    const reached = funded >= g.target;

    const emoji = el('button', { type: 'button', className: 'emoji-btn', textContent: g.emoji });
    emoji.setAttribute('aria-label', `Cambia emoji di ${g.name}`);
    emoji.addEventListener('click', () => openEmojiPicker(g.emoji, (e) => { g.emoji = e; save(); renderGoals(); }));

    const name = el('input', { className: 'rename', value: g.name, maxLength: 40, required: true });
    name.setAttribute('aria-label', 'Nome obiettivo');
    name.addEventListener('change', () => {
      const v = name.value.trim();
      if (v) { g.name = v; save(); }
      renderGoals();
    });

    const del = iconButton('trash', `Elimina l'obiettivo ${g.name}`, 'danger');
    del.addEventListener('click', () => {
      if (!confirm(`Eliminare l'obiettivo "${g.name}"?`)) return;
      data.goals = data.goals.filter((x) => x.id !== g.id);
      save();
      renderGoals();
    });

    const handle = iconButton('grip', `Trascina per cambiare la priorità di ${g.name} (o usa le frecce)`, 'handle');
    const fill = el('div', { className: 'goal-fill' });
    fill.style.width = `${(funded / g.target) * 100}%`;

    const target = el('input', { type: 'number', step: '0.01', min: '1', inputMode: 'decimal', value: g.target.toFixed(2) });
    target.addEventListener('change', () => {
      const v = round2(parseFloat(target.value));
      if (v > 0) { g.target = v; save(); }
      renderGoals();
    });
    const deadline = el('input', { type: 'month', value: g.deadline || '' });
    deadline.addEventListener('change', () => {
      if (deadline.value) g.deadline = deadline.value;
      else delete g.deadline;
      save();
      renderGoals();
    });

    // Stato: raggiunto, previsione e confronto con la scadenza.
    const status = [];
    let doneBtn = null;
    if (reached) {
      status.push(el('span', { className: 'ok', textContent: '🎉 Raggiunto!' }), ' Quando lo usi, premi Completato: smetterà di prendere soldi dall\'avanzo.');
      doneBtn = el('button', { type: 'button', className: 'btn primary done', textContent: 'Completato' });
      doneBtn.addEventListener('click', () => {
        if (!confirm(`Segnare "${g.name}" come completato?\nPasserà tra i completati e i suoi ${euro.format(g.target)} torneranno disponibili per gli obiettivi successivi.`)) return;
        data.goals = data.goals.filter((x) => x.id !== g.id);
        data.goalsDone.unshift({ ...g, completed: todayIso() });
        save();
        renderGoals();
      });
    } else if (!sav || sav.avg <= 0) {
      status.push(sav ? 'Al ritmo attuale non si avvicina: le spese superano le entrate.' : 'Registra entrate e spese per avere una previsione.');
    } else {
      const months = Math.ceil(missingBefore / sav.avg);
      const when = shiftMonth(b.nowYm, months);
      status.push('Circa a ', el('b', { textContent: ymLabel(when) }));
      if (g.deadline) {
        const left = Math.max(1, monthIndex(g.deadline) - monthIndex(b.nowYm));
        if (when <= g.deadline) status.push(' · ', el('span', { className: 'ok', textContent: `in tempo per ${ymLabel(g.deadline)}` }));
        else status.push(' · ', el('span', { className: 'warn', textContent: `per ${ymLabel(g.deadline)} servono ${euro.format(Math.ceil(missingBefore / left))} al mese` }), ` (ora ${euro.format(sav.avg)})`);
      }
    }

    const li = el('li', { className: `goal-item${reached ? ' reached' : ''}` },
      el('div', { className: 'goal-head' }, handle, emoji, name, el('span', { className: 'goal-rank', textContent: `${index + 1}°` }), del),
      el('div', { className: 'goal-track' }, fill),
      el('div', { className: 'goal-meta' },
        el('div', { className: 'goal-amounts' }, el('span', {}, el('b', { textContent: euro.format(funded) }), ` di ${euro.format(g.target)}`), el('span', { textContent: `${Math.floor((funded / g.target) * 100)}%` })),
        el('label', { className: 'field' }, 'Importo', el('span', { className: 'money' }, target, el('span', { className: 'suffix', textContent: '€' }))),
        el('label', { className: 'field' }, 'Entro (facoltativo)', deadline)),
      el('p', { className: 'goal-status' }, ...status),
      ...(doneBtn ? [doneBtn] : []));
    makeSortable(handle, li, () => data.goals, g.id, renderGoals);
    return li;
  });
  $('goal-list').replaceChildren(...items);
  $('goal-empty').hidden = data.goals.length > 0;

  const done = data.goalsDone.map((g) => {
    const [y, m, d] = (g.completed || '').split('-');
    const restore = el('button', { type: 'button', className: 'btn ghost', textContent: 'Ripristina' });
    restore.addEventListener('click', () => {
      data.goalsDone = data.goalsDone.filter((x) => x.id !== g.id);
      const { completed, ...rest } = g;
      data.goals.push(rest);
      save();
      renderGoals();
    });
    const del = iconButton('trash', `Elimina ${g.name}`, 'danger');
    del.addEventListener('click', () => {
      if (!confirm(`Eliminare "${g.name}" dai completati?`)) return;
      data.goalsDone = data.goalsDone.filter((x) => x.id !== g.id);
      save();
      renderGoals();
    });
    return el('li', {}, el('span', { className: 'emoji', textContent: g.emoji }),
      el('div', { className: 'expense-main' }, el('div', { className: 'desc', textContent: g.name }),
        el('div', { className: 'tags' }, el('span', { className: 'chip ok', textContent: `${euro.format(g.target)}${d ? ` · ${d}/${m}/${y}` : ''}` }))),
      restore, del);
  });
  $('goals-done').replaceChildren(...done);
  $('goals-done-count').textContent = String(done.length);
  $('goals-done-card').hidden = done.length === 0;
}

let newGoalEmoji = '🎯';
$('goal-emoji').addEventListener('click', () => {
  openEmojiPicker(newGoalEmoji, (e) => { newGoalEmoji = e; $('goal-emoji').textContent = e; });
});

$('goal-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('goal-name').value.trim();
  const target = round2(parseFloat($('goal-amount').value));
  if (!name || !(target > 0)) return;
  data.goals.push({ id: crypto.randomUUID(), name, emoji: newGoalEmoji, target, ...($('goal-deadline').value ? { deadline: $('goal-deadline').value } : {}) });
  save();
  $('goal-name').value = '';
  $('goal-amount').value = '';
  $('goal-deadline').value = '';
  newGoalEmoji = '🎯';
  $('goal-emoji').textContent = newGoalEmoji;
  renderGoals();
});

$('goal-target').addEventListener('change', () => {
  const v = round2(parseFloat($('goal-target').value));
  if (v > 0) {
    data.goal.target = v;
    save();
  }
  renderGoals();
});

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
  if (order.length) {
    // Prima i pulsanti nell'ordine salvato, poi quelli aggiunti dopo (es. nuove pagine).
    const tabs = [...nav.children];
    for (const id of order) {
      const t = tabs.find((x) => x.dataset.id === id);
      if (t) nav.append(t);
    }
    for (const t of tabs) if (!order.includes(t.dataset.id)) nav.append(t);
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

const PAGES = { spese: render, statistiche: renderStats, debiti: renderDebts, obiettivi: renderGoals, aree: renderAreas, conti: renderAccounts };

function showPage() {
  const requested = location.hash.slice(1);
  const page = Object.hasOwn(PAGES, requested) ? requested : 'spese';
  for (const p of document.querySelectorAll('.page')) p.hidden = p.id !== `page-${page}`;
  for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t.dataset.page === page);
  PAGES[page]();
}

window.addEventListener('hashchange', showPage);

// ---------- Backup ----------

// ---------- Backup ----------
// Il telefono non permette a una web app di salvare file da sola: il backup
// richiede sempre un tocco. L'app però ricorda quando è stato fatto l'ultimo
// e a fine mese lo propone con una finestra.

const LAST_BACKUP_KEY = 'spese.ui.lastBackup';
const BACKUP_SNOOZE_KEY = 'spese.ui.backupSnooze';

function readUi(key) {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}
function writeUi(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

function backupFile() {
  const json = JSON.stringify(data, null, 2);
  const name = `spese-backup-${todayIso()}.json`;
  return { json, name };
}

function markBackupDone() {
  writeUi(LAST_BACKUP_KEY, todayIso());
  renderBackupStatus();
}

function downloadBackup() {
  const { json, name } = backupFile();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  markBackupDone();
}

// Condivisione (es. Google Drive) quando il telefono la supporta.
// Chrome su Android condivide solo alcuni tipi di file e i .json non sono tra
// questi: per la condivisione il backup diventa un file di testo (.txt) con lo
// stesso contenuto, che "Importa" accetta come il .json.
function shareableBackup() {
  const { json, name } = backupFile();
  return new File([json], name.replace(/\.json$/, '.txt'), { type: 'text/plain' });
}

function canShareBackup() {
  try {
    return Boolean(navigator.share && navigator.canShare && navigator.canShare({ files: [shareableBackup()] }));
  } catch {
    return false;
  }
}

async function shareBackup() {
  const file = shareableBackup();
  try {
    await navigator.share({ files: [file], title: file.name });
    markBackupDone();
    return true;
  } catch (err) {
    if (err?.name === 'AbortError') return false; // condivisione annullata: si può riprovare
    // Condivisione rifiutata dal telefono: si scarica il file, così il backup c'è comunque.
    downloadBackup();
    showToast('Condivisione non disponibile: backup scaricato nella cartella Download', '', () => {});
    return true;
  }
}

// Ultimo giorno del mese (AAAA-MM-GG) del mese di `iso`.
function lastDayOfMonth(iso) {
  const [y, m] = iso.split('-').map(Number);
  return `${iso.slice(0, 7)}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
}

// Backup dovuto: oggi è l'ultimo giorno del mese e non è stato fatto oggi,
// oppure manca quello di fine del mese scorso (es. l'app non è stata aperta).
function backupDue() {
  const today = todayIso();
  const last = readUi(LAST_BACKUP_KEY);
  const endPrev = lastDayOfMonth(`${shiftMonth(today.slice(0, 7), -1)}-01`);
  if (today === lastDayOfMonth(today) && last < today) return { month: today.slice(0, 7) };
  if (last < endPrev && data.expenses.length + data.incomes.length > 0) return { month: endPrev.slice(0, 7) };
  return null;
}

function maybeShowBackupDialog() {
  const due = backupDue();
  if (!due || readUi(BACKUP_SNOOZE_KEY) === todayIso() || $('backup-dialog').open) return;
  const last = readUi(LAST_BACKUP_KEY);
  $('backup-title').textContent = last ? `Backup di ${ymLabel(due.month)}` : 'Fai il tuo primo backup';
  $('backup-text').replaceChildren(
    'Salva una copia dei tuoi dati: se il telefono o il browser li cancellassero, potrai recuperarli con Importa. ',
    last ? `Ultimo backup: ${last.split('-').reverse().join('/')}.` : 'Non hai ancora fatto nessun backup.');
  $('backup-share').hidden = !canShareBackup();
  $('backup-dialog').showModal();
}

$('backup-download').addEventListener('click', () => {
  downloadBackup();
  $('backup-dialog').close();
  showToast('Backup scaricato nella cartella Download', '', () => {});
});
$('backup-share').addEventListener('click', async () => {
  const toastBefore = $('toast').textContent;
  if (await shareBackup()) {
    $('backup-dialog').close();
    if ($('toast').hidden || $('toast').textContent === toastBefore) showToast('Backup salvato', '', () => {});
  }
});
$('backup-later').addEventListener('click', () => {
  writeUi(BACKUP_SNOOZE_KEY, todayIso());
  $('backup-dialog').close();
});
$('backup-now').addEventListener('click', () => {
  writeUi(BACKUP_SNOOZE_KEY, '');
  $('backup-title').textContent = 'Backup';
  $('backup-text').replaceChildren('Salva una copia dei tuoi dati sul telefono oppure su Google Drive o un\'altra app.');
  $('backup-share').hidden = !canShareBackup();
  $('backup-dialog').showModal();
});

// Archiviazione persistente: chiede al browser di non cancellare i dati dell'app.
let persisted = null;
async function ensurePersistence() {
  try {
    if (!navigator.storage?.persist) return;
    persisted = await navigator.storage.persisted();
    if (!persisted) persisted = await navigator.storage.persist();
  } catch {
    persisted = null;
  }
  renderBackupStatus();
}

function renderBackupStatus() {
  const last = readUi(LAST_BACKUP_KEY);
  const days = last ? Math.round((new Date(todayIso()) - new Date(last)) / 86400000) : null;
  const when = last ? last.split('-').reverse().join('/') : null;
  $('backup-status').replaceChildren(
    'Ultimo backup: ',
    last
      ? el('b', { textContent: days === 0 ? `oggi (${when})` : `${when} · ${days} ${days === 1 ? 'giorno' : 'giorni'} fa` })
      : el('span', { className: 'warn', textContent: 'mai fatto' }),
    ...(days !== null && days > 35 ? [' · ', el('span', { className: 'warn', textContent: 'conviene farne uno' })] : []));
  $('persist-status').replaceChildren(
    'Protezione dalla cancellazione automatica: ',
    persisted === true ? el('span', { className: 'ok', textContent: 'attiva' })
      : persisted === false ? el('span', { className: 'warn', textContent: 'non concessa dal browser (installa l\'app e fai backup regolari)' })
      : el('span', { textContent: 'non disponibile su questo browser' }));
}

$('export').addEventListener('click', downloadBackup);

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
  const before = data.expenses.length + data.incomes.length + data.transfers.length;
  mergeExpenses(list);
  mergeAreas(areas);
  mergeAccounts(accounts);
  if (parsed && Array.isArray(parsed.incomes)) mergeById('incomes', parsed.incomes, (x) => typeof x.accountId === 'string'
    && ({ id: String(x.id), date: x.date, description: String(x.description ?? ''), accountId: x.accountId, amount: x.amount, ...(typeof x.at === 'number' ? { at: x.at } : {}) }));
  if (parsed && Array.isArray(parsed.transfers)) mergeById('transfers', parsed.transfers, (x) => typeof x.fromId === 'string' && typeof x.toId === 'string'
    && ({ id: String(x.id), date: x.date, description: String(x.description ?? ''), fromId: x.fromId, toId: x.toId, amount: x.amount, ...(typeof x.at === 'number' ? { at: x.at } : {}) }));
  if (typeof parsed?.partner === 'string' && parsed.partner) data.partner = parsed.partner;
  if (parsed?.goal?.target > 0) data.goal = { target: Number(parsed.goal.target) };
  const cleanGoal = (g) => (g && g.id && typeof g.name === 'string' && g.target > 0
    ? { id: String(g.id), name: g.name, emoji: firstGrapheme(String(g.emoji ?? '')) || '🎯', target: Number(g.target),
      ...(typeof g.deadline === 'string' && /^\d{4}-\d{2}$/.test(g.deadline) ? { deadline: g.deadline } : {}),
      ...(typeof g.completed === 'string' ? { completed: g.completed } : {}) }
    : null);
  for (const key of ['goals', 'goalsDone']) {
    if (!Array.isArray(parsed?.[key])) continue;
    const known = new Set([...data.goals, ...data.goalsDone].map((g) => g.id));
    for (const g of parsed[key].map(cleanGoal)) if (g && !known.has(g.id)) data[key].push(g);
  }
  save();
  showPage();
  alert(`Importati ${data.expenses.length + data.incomes.length + data.transfers.length - before} movimenti.`);
});

// ---------- Avvio ----------

const today = new Date();
const iso = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString();
$('date').value = iso.slice(0, 10);
$('month').value = iso.slice(0, 7);
$('month').dataset.today = iso.slice(0, 7);
applyPartnerName();
updateSplitUI();
updateDebtBadge();

// ---------- Versione e aggiornamenti ----------
// Da aumentare insieme a version.json e ai ?v= di index.html a ogni modifica.
const APP_VERSION = 24;
$('app-version').textContent = `Versione ${APP_VERSION}`;

// L'app installata può restare aperta in memoria per giorni: quando torna in
// primo piano controlla se online c'è una versione più nuova e lo segnala.
let lastUpdateCheck = 0;
async function checkForUpdate() {
  if (Date.now() - lastUpdateCheck < 60000) return;
  lastUpdateCheck = Date.now();
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    const { version } = await res.json();
    if (Number(version) > APP_VERSION) {
      showToast('Nuova versione disponibile', 'Aggiorna', () => location.reload(), 0);
    }
  } catch {
    // Offline o file non raggiungibile: si riproverà più tardi.
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    checkForUpdate();
    maybeShowBackupDialog();
  }
});
checkForUpdate();
renderBackupStatus();
ensurePersistence();

// Service worker: permette di installare l'app e di aprirla anche offline.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

if (readLegacyVault()) {
  $('app').hidden = true;
  $('migrate').hidden = false;
} else {
  showPage();
  maybeShowBackupDialog();
}

// ── Config / State ─────────────────────────────────────────

const SCRIPT_URL_KEY = 'budget-tracker-script-url';

let scriptUrl = localStorage.getItem(SCRIPT_URL_KEY) || '';
let categories = CATEGORIES.slice();
let cache = null;
let pendingFetch = null;
let currentPage = 'dashboard';
let toastTimer = null;

const CATEGORY_COLOR_PALETTE = [
  '#3b6e4a', '#c47a3e', '#3d5b8a', '#7a5a8e', '#b04f74',
  '#a07026', '#7a786e', '#4f7a6a', '#8a6f3e', '#5e5b8a',
];

// ── Categories model ───────────────────────────────────────

function rebuildCategories() {
  const custom = (cache && cache.categories) ? cache.categories : [];
  const seen = new Set();
  const merged = [];
  CATEGORIES.forEach(c => {
    if (c.id === 'other') return;
    seen.add(c.id);
    merged.push(c);
  });
  custom.forEach(c => {
    if (!c || !c.id || seen.has(c.id)) return;
    seen.add(c.id);
    merged.push({ id: c.id, name: c.name, color: c.color || '#7a786e', keywords: [] });
  });
  const other = CATEGORIES.find(c => c.id === 'other');
  if (other) merged.push(other);
  categories = merged;
}

function categoryById(id) {
  return categories.find(c => c.id === id) || categories[categories.length - 1];
}

function getBudgetMap() {
  const map = {};
  ((cache && cache.budgets) || []).forEach(b => {
    const amt = parseFloat(b.amount);
    if (!isNaN(amt) && amt > 0) map[b.category_id] = amt;
  });
  return map;
}

// ── Utility ────────────────────────────────────────────────

function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '');
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function fmt(amount, opts) {
  opts = opts || {};
  if (amount == null || isNaN(amount)) return '—';
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  const v = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: opts.whole ? 0 : 2,
    minimumFractionDigits: opts.whole ? 0 : 2,
  }).format(abs);
  return sign + v;
}

function fmtParts(amount) {
  if (amount == null || isNaN(amount)) return { sign: '', whole: '—', cents: '' };
  const fixed = Math.abs(amount).toFixed(2);
  const [whole, cents] = fixed.split('.');
  const withCommas = new Intl.NumberFormat('en-US').format(parseInt(whole, 10));
  return { sign: amount < 0 ? '-' : '', whole: withCommas, cents };
}

function formatISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayISO() { return formatISO(new Date()); }

function monthRange(date) {
  const dt = date || new Date();
  const y = dt.getFullYear();
  const m = dt.getMonth();
  return {
    year: y,
    monthIdx: m,
    monthName: dt.toLocaleString('en-US', { month: 'long' }),
    monthShort: dt.toLocaleString('en-US', { month: 'short' }),
    today: dt.getDate(),
    total: new Date(y, m + 1, 0).getDate(),
  };
}

function pacePercent(range) {
  return range.today / range.total;
}

function isThisMonth(dateStr, range) {
  if (!dateStr) return false;
  const d = new Date(dateStr + 'T00:00:00');
  return d.getFullYear() === range.year && d.getMonth() === range.monthIdx;
}

// ── Smart-parse for the quickbar ───────────────────────────

function parseQuickInput(text, today) {
  const ref = today || new Date();
  const original = (text || '').trim();
  if (!original) return null;

  let s = original;
  let amount = null;
  const dollarMatch = s.match(/\$\s*(\d+(?:\.\d{1,2})?)/);
  if (dollarMatch) {
    amount = parseFloat(dollarMatch[1]);
    s = (s.slice(0, dollarMatch.index) + s.slice(dollarMatch.index + dollarMatch[0].length)).replace(/\s+/g, ' ').trim();
  } else {
    const numMatch = s.match(/(?:^|\s)(\d+(?:\.\d{1,2})?)(?=\s|$)/);
    if (numMatch) {
      amount = parseFloat(numMatch[1]);
      s = (s.slice(0, numMatch.index) + s.slice(numMatch.index + numMatch[0].length)).replace(/\s+/g, ' ').trim();
    }
  }

  let date = formatISO(ref);
  let dateLabel = 'today';
  const lower = ' ' + s.toLowerCase() + ' ';
  if (/\byesterday\b/.test(lower)) {
    const d = new Date(ref); d.setDate(d.getDate() - 1);
    date = formatISO(d); dateLabel = 'yesterday';
    s = s.replace(/\byesterday\b/i, '').replace(/\s+/g, ' ').trim();
  } else if (/\btoday\b/.test(lower)) {
    s = s.replace(/\btoday\b/i, '').replace(/\s+/g, ' ').trim();
  } else {
    const m = s.match(/(\d+)\s+days?\s+ago/i);
    if (m) {
      const d = new Date(ref); d.setDate(d.getDate() - parseInt(m[1], 10));
      date = formatISO(d);
      dateLabel = `${m[1]} day${m[1] === '1' ? '' : 's'} ago`;
      s = s.replace(m[0], '').replace(/\s+/g, ' ').trim();
    }
  }

  const cleaned = s.replace(/^(at|for|on|@)\s+/i, '').replace(/\s+(for|at|on)\s+$/i, '').trim();
  const store = cleaned;

  const lc = (store || '').toLowerCase();
  let category = 'other';
  for (const c of categories) {
    if (c.keywords && c.keywords.some(k => lc.includes(k))) { category = c.id; break; }
  }
  if (category === 'other') {
    if (/\b(coffee|latte|espresso)\b/i.test(lc)) category = 'dining';
    else if (/\b(lunch|dinner|breakfast|takeout|takeaway)\b/i.test(lc)) category = 'dining';
    else if (/\b(gas|fuel|fill[\s-]?up)\b/i.test(lc)) category = 'gas';
    else if (/\b(groceries|grocery)\b/i.test(lc)) category = 'groceries';
  }

  return { raw: original, amount, store: store || '', date, dateLabel, category };
}

// ── Boot ───────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  buildNav();
  bindGlobalHotkeys();
  bindQuickbar();
  if (!scriptUrl) {
    showSetup();
  } else {
    showApp();
    refreshData();
  }
});

function buildNav() {
  const nav = document.getElementById('nav');
  const items = [
    { id: 'dashboard',    label: 'Overview',     kbd: '1' },
    { id: 'transactions', label: 'Transactions', kbd: '2' },
    { id: 'income',       label: 'Income',       kbd: '3' },
    { id: 'budgets',      label: 'Budgets',      kbd: '4' },
    { id: 'settings',     label: 'Settings',     kbd: '5' },
    { id: 'meals',        label: 'Meals',        kbd: '6' },
  ];
  nav.innerHTML = '';
  items.forEach(it => {
    const btn = document.createElement('button');
    btn.className = 'nav-item' + (it.id === currentPage ? ' active' : '');
    btn.dataset.tab = it.id;
    btn.innerHTML = `<span>${it.label}</span><span class="nav-shortcut">${it.kbd}</span>`;
    btn.addEventListener('click', () => showTab(it.id));
    nav.appendChild(btn);
  });
}

function showSetup() {
  document.getElementById('setup-overlay').classList.remove('hidden');
  document.getElementById('app-root').classList.add('hidden');
  document.getElementById('setup-url').value = scriptUrl || '';
  setTimeout(() => document.getElementById('setup-url').focus(), 0);
}

function showApp() {
  document.getElementById('setup-overlay').classList.add('hidden');
  document.getElementById('app-root').classList.remove('hidden');
  document.getElementById('settings-url').textContent = scriptUrl;
  updateSidebarMonth();
  renderDashboard();
}

function updateSidebarMonth() {
  const r = monthRange();
  document.getElementById('sidebar-month').textContent = `${r.monthName} ${r.year}`;
  document.getElementById('sidebar-day').textContent = `Day ${r.today} of ${r.total}`;
}

async function saveScriptUrl() {
  const input = document.getElementById('setup-url');
  const err = document.getElementById('setup-error');
  const btn = document.getElementById('setup-save-btn');
  const url = input.value.trim();

  err.classList.add('hidden');

  if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec/.test(url)) {
    err.textContent = 'That doesn\'t look like an Apps Script web app URL. It should end with /exec.';
    err.classList.remove('hidden');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Testing…';
  try {
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    if (!Array.isArray(data.receipts)) throw new Error('Unexpected response shape');
    scriptUrl = url;
    localStorage.setItem(SCRIPT_URL_KEY, url);
    cache = {
      receipts: data.receipts || [],
      items: data.items || [],
      budgets: data.budgets || [],
      categories: data.categories || [],
      income: data.income || [],
      settings: data.settings || [],
    };
    rebuildCategories();
    showApp();
  } catch (e) {
    err.textContent = 'Could not reach the script: ' + e.message + '. Double-check the URL and that "Who has access" is set to "Anyone".';
    err.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Connect';
  }
}

function changeScriptUrl() {
  showSetup();
}

// ── API layer ──────────────────────────────────────────────

function setSyncIndicator(state, text) {
  const el = document.getElementById('sync-indicator');
  if (!el) return;
  el.className = 'sync-indicator ' + (state || '');
  el.textContent = text || '';
}

async function apiGet() {
  if (pendingFetch) return pendingFetch;
  setSyncIndicator('loading', 'Syncing…');
  pendingFetch = (async () => {
    try {
      const res = await fetch(scriptUrl, { method: 'GET' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      cache = {
        receipts: data.receipts || [],
        items: data.items || [],
        budgets: data.budgets || [],
        categories: data.categories || [],
        income: data.income || [],
        settings: data.settings || [],
        meals: data.meals || [],
        meal_allocations: data.meal_allocations || [],
      };
      rebuildCategories();
      setSyncIndicator('ok', 'Synced');
      setTimeout(() => setSyncIndicator('', ''), 1500);
      return cache;
    } catch (e) {
      setSyncIndicator('error', 'Sync error');
      throw e;
    } finally {
      pendingFetch = null;
    }
  })();
  return pendingFetch;
}

async function apiPost(body) {
  setSyncIndicator('loading', 'Saving…');
  try {
    const res = await fetch(scriptUrl, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    setSyncIndicator('ok', 'Saved');
    setTimeout(() => setSyncIndicator('', ''), 1500);
    return data;
  } catch (e) {
    setSyncIndicator('error', 'Save failed');
    throw e;
  }
}

async function getData(forceFresh) {
  if (cache && !forceFresh) return cache;
  return apiGet();
}

async function refreshData() {
  try {
    await apiGet();
    renderCurrent();
  } catch (e) {
    showToast('Could not load: ' + e.message, { error: true });
  }
}

// ── Tab navigation ─────────────────────────────────────────

function showTab(name) {
  currentPage = name;
  document.querySelectorAll('.tab').forEach(t => t.classList.add('hidden'));
  const tab = document.getElementById(`tab-${name}`);
  if (tab) tab.classList.remove('hidden');
  document.querySelectorAll('.nav-item').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === name);
  });
  renderCurrent();
}

function renderCurrent() {
  if (currentPage === 'dashboard') renderDashboard();
  else if (currentPage === 'transactions') renderTransactionsPage();
  else if (currentPage === 'income') renderIncomePage();
  else if (currentPage === 'budgets') renderBudgetsPage();
  else if (currentPage === 'settings') renderSettingsPage();
  else if (currentPage === 'meals') renderMealsPage();
}

// ── Hotkeys ────────────────────────────────────────────────

function bindGlobalHotkeys() {
  window.addEventListener('keydown', e => {
    const tag = e.target.tagName;
    const inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if (inField) return;
    if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      focusQuickAdd();
    }
    if (e.key === '1') showTab('dashboard');
    if (e.key === '2') showTab('transactions');
    if (e.key === '3') showTab('income');
    if (e.key === '4') showTab('budgets');
    if (e.key === '5') showTab('settings');
    if (e.key === '6') showTab('meals');
  });
}

function focusQuickAdd() {
  if (currentPage !== 'dashboard') showTab('dashboard');
  const inp = document.getElementById('quickbar-input');
  if (inp) inp.focus();
}

// ── Quickbar ──────────────────────────────────────────────

function bindQuickbar() {
  const input = document.getElementById('quickbar-input');
  if (!input) return;
  input.addEventListener('input', updateQuickbarPreview);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commitQuickAdd(); }
    if (e.key === 'Escape') { input.value = ''; updateQuickbarPreview(); }
  });
}

function updateQuickbarPreview() {
  const input = document.getElementById('quickbar-input');
  const chips = document.getElementById('quickbar-chips');
  const btn = document.getElementById('quickbar-add-btn');
  const parsed = parseQuickInput(input.value);
  chips.innerHTML = '';

  const canAdd = parsed && parsed.amount != null && parsed.amount > 0 && parsed.store;
  btn.disabled = !canAdd;

  if (!parsed) return;

  if (parsed.amount != null) {
    const chip = document.createElement('span');
    chip.className = 'parse-chip';
    chip.innerHTML = `<span class="dot"></span>${fmt(parsed.amount)}`;
    chips.appendChild(chip);
  }
  if (parsed.store) {
    const cat = categoryById(parsed.category);
    const chip = document.createElement('span');
    chip.className = 'parse-chip';
    chip.style.background = 'transparent';
    chip.style.color = cat.color;
    chip.style.borderColor = cat.color + '55';
    chip.innerHTML = `<span class="dot" style="background:${cat.color}"></span>${cat.name}`;
    chips.appendChild(chip);
  }
  if (parsed.dateLabel && parsed.dateLabel !== 'today') {
    const chip = document.createElement('span');
    chip.className = 'parse-chip muted';
    chip.textContent = parsed.dateLabel;
    chips.appendChild(chip);
  }
}

async function commitQuickAdd() {
  const input = document.getElementById('quickbar-input');
  const parsed = parseQuickInput(input.value);
  if (!parsed || parsed.amount == null || parsed.amount <= 0 || !parsed.store) return;

  const receipt = {
    id: uid(),
    date: parsed.date,
    store: parsed.store,
    total: Math.round(parsed.amount * 100) / 100,
    uploaded_at: new Date().toISOString(),
    category: parsed.category,
  };

  input.value = '';
  updateQuickbarPreview();
  if (!cache) cache = { receipts: [], items: [], budgets: [], categories: [], income: [], settings: [], meals: [], meal_allocations: [] };
  cache.receipts.push(receipt);
  renderDashboard();

  try {
    await apiPost({ action: 'add_receipt', receipt, items: [] });
    showToast(`Added ${fmt(receipt.total)} · ${categoryById(receipt.category).name}`);
  } catch (e) {
    cache.receipts = cache.receipts.filter(r => r.id !== receipt.id);
    renderDashboard();
    showToast('Save failed: ' + e.message, { error: true });
  }
  input.focus();
}

// ── Dashboard render ───────────────────────────────────────

function computeMonthStats(range) {
  const receipts = (cache && cache.receipts) || [];
  const items = (cache && cache.items) || [];
  const itemsByReceipt = {};
  items.forEach(it => {
    (itemsByReceipt[it.receipt_id] = itemsByReceipt[it.receipt_id] || []).push(it);
  });
  const catIds = new Set(categories.map(c => c.id));
  const spendByCat = {};
  categories.forEach(c => { spendByCat[c.id] = 0; });
  let total = 0;
  const monthReceipts = [];

  receipts.forEach(r => {
    if (!isThisMonth(r.date, range)) return;
    monthReceipts.push(r);
    const t = parseFloat(r.total);
    if (isNaN(t)) return;
    total += t;
    let receiptCat = r.category || 'other';
    if (!catIds.has(receiptCat)) receiptCat = 'other';
    const its = itemsByReceipt[r.id] || [];
    let itemSum = 0;
    its.forEach(it => {
      const ip = parseFloat(it.total_price);
      if (isNaN(ip)) return;
      let ic = it.category || receiptCat;
      if (!catIds.has(ic)) ic = 'other';
      spendByCat[ic] += ip;
      itemSum += ip;
    });
    const remainder = t - itemSum;
    if (Math.abs(remainder) > 0.005) spendByCat[receiptCat] += remainder;
  });

  return { total, spendByCat, monthReceipts };
}

function renderDashboard() {
  if (!cache) return;
  updateSidebarMonth();
  const range = monthRange();
  const stats = computeMonthStats(range);
  const budgets = getBudgetMap();
  const totalBudget = Object.values(budgets).reduce((s, v) => s + v, 0);

  document.getElementById('dash-sub').textContent =
    `${range.monthName} ${range.year} — day ${range.today} of ${range.total}`;
  document.getElementById('hero-month-label').textContent = range.monthName;

  renderHero(stats.total, totalBudget, range);
  renderSavingsCard(stats.total, range);
  renderCatGrid(stats.spendByCat, budgets, range);
  renderHeatmap(stats.monthReceipts, range);
  renderRecent(stats.monthReceipts);
}

function monthIncome(range) {
  return ((cache && cache.income) || []).reduce((sum, e) => {
    if (!isThisMonth(e.date, range)) return sum;
    const amt = parseFloat(e.amount);
    return isNaN(amt) ? sum : sum + amt;
  }, 0);
}

function getSetting(key) {
  const row = ((cache && cache.settings) || []).find(s => s.key === key);
  return row ? row.value : '';
}

function renderSavingsCard(totalSpent, range) {
  const income = monthIncome(range);
  const saved = income - totalSpent;
  const rate = income > 0 ? saved / income : 0;
  const targetRaw = parseFloat(getSetting('savings_target_pct'));
  const target = isNaN(targetRaw) ? 0 : Math.max(0, targetRaw) / 100;

  document.getElementById('savings-month-label').textContent = range.monthName;
  document.getElementById('savings-meta').textContent =
    target > 0 ? `TARGET ${Math.round(target * 100)}%` : 'SET A TARGET IN SETTINGS';

  const pctEl = document.getElementById('savings-pct');
  const overspent = income > 0 && saved < 0;
  const meetingTarget = income > 0 && target > 0 && rate >= target;
  const noIncome = income <= 0;

  let stateClass = '';
  if (overspent) stateClass = ' red';
  else if (target > 0 && !meetingTarget) stateClass = ' amber';
  pctEl.className = 'hero-num' + stateClass;

  if (noIncome) {
    pctEl.innerHTML = `<span style="font-size:32px;color:var(--ink-3);font-family:var(--font-sans);letter-spacing:0">No income logged yet</span>`;
  } else {
    const shown = Math.round(rate * 100);
    pctEl.textContent = shown + '%';
  }

  const bar = document.getElementById('savings-progress');
  bar.className = 'pace-spent' + stateClass;
  bar.style.width = Math.min(Math.max(rate, 0), 1) * 100 + '%';

  const marker = document.getElementById('savings-target-marker');
  if (target > 0) {
    marker.style.display = '';
    marker.style.left = Math.min(target, 1) * 100 + '%';
  } else {
    marker.style.display = 'none';
  }

  document.getElementById('savings-progress-label').textContent =
    noIncome ? '—' : `${fmt(Math.max(saved, 0), { whole: true })} of ${fmt(income, { whole: true })} saved`;

  const status = document.getElementById('savings-status');
  if (noIncome) {
    status.className = 'pace-status';
    status.textContent = '';
  } else if (overspent) {
    status.className = 'pace-status over';
    status.textContent = `${fmt(-saved, { whole: true })} over income`;
  } else if (target > 0 && meetingTarget) {
    status.className = 'pace-status ok';
    status.textContent = `On target`;
  } else if (target > 0) {
    const gap = (target - rate) * 100;
    status.className = 'pace-status warn';
    status.textContent = `${gap.toFixed(1)}% short`;
  } else {
    status.className = 'pace-status ok';
    status.textContent = `${Math.round(rate * 100)}% saved`;
  }

  document.getElementById('savings-income').textContent = income > 0 ? fmt(income) : '—';
  document.getElementById('savings-spent').textContent = fmt(totalSpent);
  const amt = document.getElementById('savings-amount');
  amt.textContent = noIncome ? '—' : fmt(saved);
  amt.className = 'val' + (overspent ? ' red' : '');
  document.getElementById('savings-target-label').textContent =
    target > 0 ? Math.round(target * 100) + '%' : '—';
}

function renderHero(totalSpent, totalBudget, range) {
  const pacePct = pacePercent(range);
  const spentPct = totalBudget > 0 ? totalSpent / totalBudget : 0;
  const expected = totalBudget * pacePct;
  const over = spentPct > 1;
  const ahead = !over && totalSpent > expected + 1;
  const onTrack = !over && !ahead;

  const heroNum = document.getElementById('hero-num');
  const parts = fmtParts(totalSpent);
  heroNum.className = 'hero-num' + (over ? ' red' : (ahead ? ' amber' : ''));
  heroNum.innerHTML = `<span class="currency">$</span>${parts.whole}<span class="cents">.${parts.cents}</span>`;

  const spentBar = document.getElementById('pace-spent');
  spentBar.className = 'pace-spent' + (over ? ' red' : (ahead ? ' amber' : ''));
  spentBar.style.width = Math.min(Math.max(spentPct, 0), 1) * 100 + '%';

  const marker = document.getElementById('pace-marker');
  if (totalBudget > 0) {
    marker.style.display = '';
    marker.style.left = Math.min(pacePct, 1) * 100 + '%';
  } else {
    marker.style.display = 'none';
  }

  document.getElementById('pace-spent-label').textContent =
    totalBudget > 0
      ? `${fmt(totalSpent, { whole: true })} of ${fmt(totalBudget, { whole: true })} budget`
      : `${fmt(totalSpent, { whole: true })} spent · no budget yet`;

  const status = document.getElementById('pace-status');
  if (totalBudget <= 0) {
    status.className = 'pace-status';
    status.textContent = '';
  } else if (over) {
    status.className = 'pace-status over';
    status.textContent = `${fmt(totalSpent - totalBudget, { whole: true })} over`;
  } else if (ahead) {
    status.className = 'pace-status warn';
    status.textContent = `${fmt(totalSpent - expected, { whole: true })} ahead of pace`;
  } else {
    status.className = 'pace-status ok';
    status.textContent = 'On pace';
  }

  const remaining = Math.max(totalBudget - totalSpent, 0);
  const daysLeft = Math.max(range.total - range.today, 0);
  const dailyAllowance = daysLeft > 0 ? remaining / daysLeft : remaining;
  const projection = (totalBudget > 0 && range.today > 0)
    ? totalSpent * (range.total / range.today)
    : 0;
  const projOver = projection > totalBudget && totalBudget > 0;

  document.getElementById('allowance-days-label').textContent =
    `For the next ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
  document.getElementById('allowance-amount').innerHTML =
    totalBudget > 0
      ? `${fmt(dailyAllowance)}<span style="font-size:14px;color:var(--ink-3);margin-left:6px">/ day</span>`
      : `<span style="color:var(--ink-3);font-size:18px">Set a budget →</span>`;
  document.getElementById('allowance-remaining').textContent = totalBudget > 0 ? fmt(remaining) : '—';
  const proj = document.getElementById('allowance-projection');
  proj.textContent = totalBudget > 0 ? fmt(projection, { whole: true }) : '—';
  proj.className = 'val small' + (projOver ? ' red' : '');
}

function renderCatGrid(spendByCat, budgets, range) {
  const grid = document.getElementById('cat-grid');
  grid.innerHTML = '';
  const pacePct = pacePercent(range);

  const visible = categories.filter(c => {
    const spent = spendByCat[c.id] || 0;
    const budget = budgets[c.id] || 0;
    return spent > 0 || budget > 0;
  });

  if (visible.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'cat-card empty';
    empty.style.gridColumn = '1 / -1';
    empty.innerHTML = `
      <div style="font-family:var(--font-serif);font-size:22px;color:var(--ink-2)">No category activity yet.</div>
      <div style="color:var(--ink-3)">Add a transaction or set a budget to see categories appear.</div>
    `;
    grid.appendChild(empty);
    return;
  }

  visible.forEach(c => {
    const spent = spendByCat[c.id] || 0;
    const budget = budgets[c.id] || 0;
    const hasBudget = budget > 0;
    const pct = hasBudget ? spent / budget : 0;
    const expected = hasBudget ? budget * pacePct : 0;
    const ahead = hasBudget && spent > expected + 0.5;
    const over = pct > 1;
    const status = over ? 'over' : (ahead ? 'warn' : 'ok');
    const remaining = budget - spent;

    const card = document.createElement('div');
    card.className = 'cat-card';
    card.style.setProperty('--cat-color', c.color);

    const amountInner = hasBudget
      ? `${fmt(spent, { whole: spent >= 100 })}<span class="of">/ ${fmt(budget, { whole: true })}</span>`
      : `${fmt(spent, { whole: spent >= 100 })}`;

    const foot = hasBudget
      ? `<span>${fmt(Math.max(remaining, 0), { whole: true })} left</span>
         <span class="pill ${status}">${
           over ? `${Math.round((pct - 1) * 100)}% over`
                : ahead ? `${Math.round((pct - pacePct) * 100)}% ahead`
                : 'On pace'
         }</span>`
      : `<span>No budget</span>`;

    card.innerHTML = `
      <div class="cat-head">
        <div class="cat-name"><span class="cat-dot"></span>${c.name}</div>
        <button class="btn btn-ghost btn-sm" data-cat="${c.id}">${hasBudget ? 'edit' : 'set'}</button>
      </div>
      <div class="cat-amount">${amountInner}</div>
      <div class="cat-bar">
        <div class="cat-bar-fill${over ? ' over' : ''}" style="width:${Math.min(pct, 1) * 100}%"></div>
        ${hasBudget ? `<div class="cat-pace-mark" style="left:${Math.min(pacePct, 1) * 100}%"></div>` : ''}
      </div>
      <div class="cat-foot">${foot}</div>
    `;
    card.querySelector('button[data-cat]').addEventListener('click', () => showBudgetEditor(c.id));
    grid.appendChild(card);
  });
}

function renderHeatmap(monthReceipts, range) {
  const card = document.getElementById('heatmap-card');
  const dailyTotals = {};
  monthReceipts.forEach(r => {
    const amt = parseFloat(r.total);
    if (!r.date || isNaN(amt)) return;
    dailyTotals[r.date] = (dailyTotals[r.date] || 0) + amt;
  });

  const first = new Date(range.year, range.monthIdx, 1);
  const startDow = first.getDay();
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= range.total; d++) cells.push(d);
  while (cells.length % 7) cells.push(null);

  const max = Math.max(0, ...Object.values(dailyTotals));
  function levelFor(amt) {
    if (!amt || max <= 0) return 0;
    const r = amt / max;
    if (r < 0.18) return 1;
    if (r < 0.4)  return 2;
    if (r < 0.7)  return 3;
    return 4;
  }

  const dowLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  let html = '<div class="eyebrow">Spending by day</div><div class="heatmap">';
  dowLabels.forEach(l => { html += `<div class="dow">${l}</div>`; });
  cells.forEach(d => {
    if (d === null) { html += '<div class="cell" style="background:transparent"></div>'; return; }
    const dateStr = formatISO(new Date(range.year, range.monthIdx, d));
    const amt = dailyTotals[dateStr] || 0;
    const lvl = levelFor(amt);
    const isFuture = d > range.today;
    const isToday = d === range.today;
    html += `<div class="cell${isToday ? ' today' : ''}${isFuture ? ' future' : ''}" data-level="${lvl}">
      <span class="cell-day">${d}</span>
      <div class="cell-tip">${range.monthShort} ${d}: ${fmt(amt)}</div>
    </div>`;
  });
  html += '</div><div class="heatmap-legend"><span>Less</span><div class="scale">';
  [0,1,2,3,4].forEach(l => { html += `<div class="cell" data-level="${l}"></div>`; });
  html += '</div><span>More</span></div>';
  card.innerHTML = html;
}

// ── Receipt list rendering ────────────────────────────────

function buildReceiptRow(r) {
  const cat = categoryById(r.category);
  const d = new Date(r.date + 'T00:00:00');
  const row = document.createElement('div');
  row.className = 'recent-row';
  row.dataset.id = r.id;

  const dayCell = document.createElement('div');
  dayCell.className = 'recent-day';
  dayCell.innerHTML = `<span>${d.getDate()}</span><span class="mo">${d.toLocaleString('en-US', { month: 'short' })}</span>`;

  const storeCell = document.createElement('div');
  storeCell.className = 'recent-store';
  storeCell.title = 'Click to view items';
  storeCell.textContent = r.store || '—';
  storeCell.addEventListener('click', () => toggleItems(r.id, row));

  const catCell = document.createElement('div');
  const catSel = document.createElement('select');
  catSel.className = 'recent-cat-select';
  categories.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id; opt.textContent = c.name;
    if (c.id === r.category) opt.selected = true;
    catSel.appendChild(opt);
  });
  catSel.addEventListener('change', () => updateReceiptCategory(r.id, catSel.value));
  catCell.appendChild(catSel);

  const amtCell = document.createElement('div');
  amtCell.className = 'recent-amount';
  amtCell.textContent = fmt(r.total);

  const actCell = document.createElement('div');
  actCell.className = 'recent-actions';
  const editBtn = document.createElement('button');
  editBtn.className = 'recent-icon-btn';
  editBtn.textContent = 'Edit';
  editBtn.addEventListener('click', () => openReceiptModal(r));
  actCell.appendChild(editBtn);

  const delCell = document.createElement('div');
  const delBtn = document.createElement('button');
  delBtn.className = 'recent-delete';
  delBtn.title = 'Delete';
  delBtn.textContent = '×';
  delBtn.addEventListener('click', () => deleteReceipt(r));
  delCell.appendChild(delBtn);

  [dayCell, storeCell, catCell, amtCell, actCell, delCell].forEach(el => row.appendChild(el));
  return row;
}

function toggleItems(receiptId, row) {
  const existing = row.parentElement.querySelector(`[data-items-for="${receiptId}"]`);
  if (existing) { existing.remove(); return; }
  const items = ((cache && cache.items) || []).filter(i => i.receipt_id === receiptId);
  const wrap = document.createElement('div');
  wrap.dataset.itemsFor = receiptId;
  wrap.className = 'items-detail';

  if (items.length === 0) {
    wrap.innerHTML = `<div class="no-items">No line items on this receipt.</div>`;
  } else {
    const tbl = document.createElement('table');
    tbl.innerHTML = `
      <thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Total</th><th>Category</th></tr></thead>
      <tbody></tbody>
    `;
    const tbody = tbl.querySelector('tbody');
    items.forEach(it => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${it.description || '—'}</td>
        <td>${it.quantity !== '' ? it.quantity : '—'}</td>
        <td>${it.unit_price !== '' ? fmt(it.unit_price) : '—'}</td>
        <td>${it.total_price !== '' ? fmt(it.total_price) : '—'}</td>
        <td></td>
      `;
      const sel = document.createElement('select');
      sel.className = 'recent-cat-select';
      categories.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id; opt.textContent = c.name;
        if (c.id === it.category) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.addEventListener('change', () => updateItemCategory(it.id, sel.value));
      tr.querySelector('td:last-child').appendChild(sel);
      tbody.appendChild(tr);
    });
    wrap.appendChild(tbl);
  }

  row.insertAdjacentElement('afterend', wrap);
}

function renderRecent(monthReceipts) {
  const list = document.getElementById('recent-list');
  const meta = document.getElementById('recent-meta');
  meta.textContent = `${monthReceipts.length} THIS MONTH`;
  list.innerHTML = '';

  if (monthReceipts.length === 0) {
    list.innerHTML = `
      <div class="recent">
        <div class="recent-empty">
          <div class="ttl">Nothing yet this month.</div>
          <div>Press <span class="mono" style="background:var(--panel-2);border:1px solid var(--hairline);padding:1px 6px;border-radius:4px">N</span> or type in the bar above to add your first.</div>
        </div>
      </div>`;
    return;
  }

  const sorted = [...monthReceipts].sort((a, b) =>
    String(b.date || '').localeCompare(String(a.date || ''))
  );

  const wrap = document.createElement('div');
  wrap.className = 'recent';
  sorted.slice(0, 12).forEach(r => wrap.appendChild(buildReceiptRow(r)));
  list.appendChild(wrap);
}

// ── Transactions page ─────────────────────────────────────

function renderTransactionsPage() {
  if (!cache) return;
  const range = monthRange();
  const receipts = (cache && cache.receipts) || [];
  const thisMonth = receipts.filter(r => isThisMonth(r.date, range)).length;
  document.getElementById('txn-sub').textContent =
    `${receipts.length} total · ${thisMonth} this month`;

  const container = document.getElementById('transactions-list');
  container.innerHTML = '';

  if (receipts.length === 0) {
    container.innerHTML = `
      <div class="recent">
        <div class="recent-empty">
          <div class="ttl">No transactions yet.</div>
          <div>Press <span class="mono" style="background:var(--panel-2);border:1px solid var(--hairline);padding:1px 6px;border-radius:4px">N</span> or click "+ New" to add one.</div>
        </div>
      </div>`;
    return;
  }

  const sorted = [...receipts].sort((a, b) =>
    String(b.date || '').localeCompare(String(a.date || ''))
  );

  const byDate = {};
  sorted.forEach(r => { (byDate[r.date] = byDate[r.date] || []).push(r); });

  const wrap = document.createElement('div');
  wrap.className = 'recent';
  Object.keys(byDate).forEach(dateStr => {
    const d = new Date(dateStr + 'T00:00:00');
    const dayTotal = byDate[dateStr].reduce((s, r) => s + (parseFloat(r.total) || 0), 0);
    const header = document.createElement('div');
    header.className = 'day-group';
    header.innerHTML = `<span>${d.toLocaleString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</span><span>${fmt(dayTotal)}</span>`;
    wrap.appendChild(header);
    byDate[dateStr].forEach(r => wrap.appendChild(buildReceiptRow(r)));
  });
  container.appendChild(wrap);
}

// ── Income page ───────────────────────────────────────────

function renderIncomePage() {
  if (!cache) return;
  const range = monthRange();
  const income = (cache && cache.income) || [];
  const thisMonthEntries = income.filter(e => isThisMonth(e.date, range));
  const thisMonthTotal = thisMonthEntries.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);

  document.getElementById('income-sub').textContent =
    income.length === 0
      ? 'Nothing logged yet.'
      : `${fmt(thisMonthTotal)} this month · ${income.length} total`;

  const container = document.getElementById('income-list');
  container.innerHTML = '';

  if (income.length === 0) {
    container.innerHTML = `
      <div class="recent">
        <div class="recent-empty">
          <div class="ttl">No income yet.</div>
          <div>Click "+ Add income" to log a paycheck or other inflow.</div>
        </div>
      </div>`;
    return;
  }

  const sorted = [...income].sort((a, b) =>
    String(b.date || '').localeCompare(String(a.date || ''))
  );

  const byDate = {};
  sorted.forEach(e => { (byDate[e.date] = byDate[e.date] || []).push(e); });

  const wrap = document.createElement('div');
  wrap.className = 'recent';
  Object.keys(byDate).forEach(dateStr => {
    const d = new Date(dateStr + 'T00:00:00');
    const dayTotal = byDate[dateStr].reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
    const header = document.createElement('div');
    header.className = 'day-group';
    header.innerHTML = `<span>${d.toLocaleString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</span><span>${fmt(dayTotal)}</span>`;
    wrap.appendChild(header);
    byDate[dateStr].forEach(e => wrap.appendChild(buildIncomeRow(e)));
  });
  container.appendChild(wrap);
}

function buildIncomeRow(e) {
  const d = new Date(e.date + 'T00:00:00');
  const row = document.createElement('div');
  row.className = 'recent-row';
  row.dataset.id = e.id;

  const dayCell = document.createElement('div');
  dayCell.className = 'recent-day';
  dayCell.innerHTML = `<span>${d.getDate()}</span><span class="mo">${d.toLocaleString('en-US', { month: 'short' })}</span>`;

  const sourceCell = document.createElement('div');
  sourceCell.className = 'recent-store';
  sourceCell.textContent = e.source || '—';

  const spacer = document.createElement('div');

  const amtCell = document.createElement('div');
  amtCell.className = 'recent-amount';
  amtCell.textContent = fmt(e.amount);

  const actCell = document.createElement('div');
  actCell.className = 'recent-actions';
  const editBtn = document.createElement('button');
  editBtn.className = 'recent-icon-btn';
  editBtn.textContent = 'Edit';
  editBtn.addEventListener('click', () => openIncomeModal(e));
  actCell.appendChild(editBtn);

  const delCell = document.createElement('div');
  const delBtn = document.createElement('button');
  delBtn.className = 'recent-delete';
  delBtn.title = 'Delete';
  delBtn.textContent = '×';
  delBtn.addEventListener('click', () => deleteIncomeEntry(e));
  delCell.appendChild(delBtn);

  [dayCell, sourceCell, spacer, amtCell, actCell, delCell].forEach(el => row.appendChild(el));
  return row;
}

function openIncomeModal(existing) {
  const editing = !!existing;
  const entry = existing || { id: uid(), date: todayISO(), source: '', amount: '' };

  const card = openModal(`
    <h3>${editing ? 'Edit income' : 'Add income'}</h3>
    <div class="modal-sub">${editing ? 'Update any field and save.' : 'Log a paycheck or other inflow.'}</div>
    <div class="modal-fields">
      <div class="field">
        <label>Source</label>
        <input id="im-source" type="text" value="${escapeAttr(entry.source)}" placeholder="Paycheck, freelance, etc." />
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div class="field">
          <label>Amount</label>
          <div class="field-money">
            <span class="dollar">$</span>
            <input id="im-amount" type="number" step="0.01" min="0" placeholder="0.00" value="${entry.amount != null ? entry.amount : ''}" />
          </div>
        </div>
        <div class="field">
          <label>Date</label>
          <input id="im-date" type="date" value="${entry.date || todayISO()}" />
        </div>
      </div>
      <p id="im-error" class="setup-error hidden"></p>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="im-save">${editing ? 'Save changes' : 'Add income'}</button>
    </div>
  `);

  card.dataset.editing = editing ? '1' : '';
  card.dataset.id = entry.id;

  document.getElementById('im-save').addEventListener('click', () => commitIncomeModal(card));
  setTimeout(() => document.getElementById('im-source').focus(), 0);
}

async function commitIncomeModal(card) {
  const editing = card.dataset.editing === '1';
  const id = card.dataset.id;
  const source = document.getElementById('im-source').value.trim();
  const date = document.getElementById('im-date').value;
  const amount = parseFloat(document.getElementById('im-amount').value);
  const err = document.getElementById('im-error');
  err.classList.add('hidden');

  if (!source || !date || isNaN(amount) || amount <= 0) {
    err.textContent = 'Please fill in source, date, and a positive amount.';
    err.classList.remove('hidden');
    return;
  }

  const rounded = Math.round(amount * 100) / 100;
  const btn = document.getElementById('im-save');
  btn.disabled = true;
  btn.textContent = editing ? 'Saving…' : 'Adding…';

  try {
    if (editing) {
      const updates = { date, source, amount: rounded };
      await apiPost({ action: 'update_income', id, updates });
      const e = cache.income.find(x => x.id === id);
      if (e) Object.assign(e, updates);
      showToast(`Updated ${fmt(rounded)} · ${source}`);
    } else {
      const entry = { id, date, source, amount: rounded, uploaded_at: new Date().toISOString() };
      await apiPost({ action: 'add_income', income: entry });
      if (!cache.income) cache.income = [];
      cache.income.push(entry);
      showToast(`Added ${fmt(rounded)} · ${source}`);
    }
    closeModal();
    renderCurrent();
  } catch (e) {
    err.textContent = 'Save failed: ' + e.message;
    err.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = editing ? 'Save changes' : 'Add income';
  }
}

async function deleteIncomeEntry(entry) {
  if (!confirm('Delete this income entry?')) return;
  const removed = entry;
  cache.income = (cache.income || []).filter(x => x.id !== entry.id);
  renderCurrent();
  try {
    await apiPost({ action: 'delete_income', id: entry.id });
    showToast(`Removed ${fmt(removed.amount)} · ${removed.source}`, {
      undo: async () => {
        cache.income.push(removed);
        renderCurrent();
        try {
          await apiPost({ action: 'add_income', income: removed });
        } catch (e) {
          showToast('Undo failed: ' + e.message, { error: true });
          refreshData();
        }
      }
    });
  } catch (e) {
    cache.income.push(removed);
    renderCurrent();
    showToast('Delete failed: ' + e.message, { error: true });
  }
}

// ── Receipt mutations ─────────────────────────────────────

async function updateReceiptCategory(receiptId, category) {
  const prev = cache && cache.receipts.find(r => r.id === receiptId);
  if (prev) prev.category = category;
  renderCurrent();
  try {
    await apiPost({ action: 'update_receipt', id: receiptId, updates: { category } });
  } catch (e) {
    showToast('Update failed: ' + e.message, { error: true });
    refreshData();
  }
}

async function updateItemCategory(itemId, category) {
  const it = cache && cache.items.find(i => i.id === itemId);
  if (it) it.category = category;
  renderCurrent();
  try {
    await apiPost({ action: 'update_item', id: itemId, category });
  } catch (e) {
    showToast('Update failed: ' + e.message, { error: true });
    refreshData();
  }
}

async function deleteReceipt(r) {
  if (!confirm('Delete this receipt?')) return;
  const removedReceipt = r;
  const removedItems = ((cache && cache.items) || []).filter(i => i.receipt_id === r.id);
  cache.receipts = cache.receipts.filter(x => x.id !== r.id);
  cache.items = cache.items.filter(i => i.receipt_id !== r.id);
  renderCurrent();
  try {
    await apiPost({ action: 'delete_receipt', id: r.id });
    showToast(`Removed ${fmt(removedReceipt.total)} · ${removedReceipt.store}`, {
      undo: async () => {
        cache.receipts.push(removedReceipt);
        cache.items.push(...removedItems);
        renderCurrent();
        try {
          await apiPost({ action: 'add_receipt', receipt: removedReceipt, items: removedItems });
        } catch (e) {
          showToast('Undo failed: ' + e.message, { error: true });
          refreshData();
        }
      }
    });
  } catch (e) {
    cache.receipts.push(removedReceipt);
    cache.items.push(...removedItems);
    renderCurrent();
    showToast('Delete failed: ' + e.message, { error: true });
  }
}

// ── Modals: budget editor + receipt-with-items ───────────

function openModal(html) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal-backdrop" id="modal-backdrop"><div class="modal" id="modal-card">${html}</div></div>`;
  const bd = document.getElementById('modal-backdrop');
  bd.addEventListener('click', e => { if (e.target === bd) closeModal(); });
  document.addEventListener('keydown', escClose);
  return document.getElementById('modal-card');
}

function closeModal() {
  document.getElementById('modal-root').innerHTML = '';
  document.removeEventListener('keydown', escClose);
}
function escClose(e) { if (e.key === 'Escape') closeModal(); }

function showBudgetEditor(focusCatId) {
  const budgets = getBudgetMap();
  let rows = '';
  categories.forEach(c => {
    rows += `
      <div class="field" style="flex-direction:row;align-items:center;gap:12px">
        <span class="cat-dot" style="background:${c.color};width:10px;height:10px"></span>
        <label style="flex:1;font-size:14px;text-transform:none;letter-spacing:0;color:var(--ink)">${c.name}</label>
        <div class="field-money" style="width:140px">
          <span class="dollar">$</span>
          <input type="number" step="1" min="0" data-cat="${c.id}" value="${budgets[c.id] != null ? budgets[c.id] : ''}" placeholder="0" />
        </div>
      </div>`;
  });

  const card = openModal(`
    <h3>Monthly budgets</h3>
    <div class="modal-sub">Set a target for each category. Leave at 0 to skip.</div>
    <div class="modal-fields">${rows}</div>
    <div class="modal-foot">
      <button class="btn btn-primary" onclick="closeModal();renderCurrent()">Done</button>
    </div>
  `);

  card.querySelectorAll('input[data-cat]').forEach(input => {
    input.addEventListener('blur', () => commitBudget(input.dataset.cat, input.value));
    input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
  });
  if (focusCatId) {
    const target = card.querySelector(`input[data-cat="${focusCatId}"]`);
    if (target) target.focus();
  }
}

async function commitBudget(catId, raw) {
  const trimmed = String(raw).trim();
  const amount = trimmed === '' ? 0 : parseFloat(trimmed);
  if (isNaN(amount) || amount < 0) return;
  if (!cache.budgets) cache.budgets = [];
  const existing = cache.budgets.find(b => b.category_id === catId);
  if (amount > 0) {
    if (existing) existing.amount = amount;
    else cache.budgets.push({ category_id: catId, amount });
  } else if (existing) {
    cache.budgets = cache.budgets.filter(b => b.category_id !== catId);
  }
  try {
    await apiPost({ action: 'set_budget', category_id: catId, amount });
  } catch (e) {
    showToast('Could not save budget: ' + e.message, { error: true });
    refreshData();
  }
}

// Receipt modal — handles new + edit, with optional items

let modalReceiptItemCounter = 0;

function openReceiptModal(existing) {
  const editing = !!existing;
  const receipt = existing || {
    id: uid(),
    date: todayISO(),
    store: '',
    total: '',
    category: categories[0]?.id || 'other',
  };
  modalReceiptItemCounter = 0;
  const catChips = categories.map(c =>
    `<button type="button" class="cat-chip${c.id === receipt.category ? ' active' : ''}" data-cat="${c.id}">
       <span class="cat-dot" style="background:${c.color}"></span>${c.name}
     </button>`
  ).join('');

  const itemsSection = editing ? '' : `
      <div class="field">
        <label>Items <span style="text-transform:none;letter-spacing:0;color:var(--ink-4)">— optional</span></label>
        <table class="modal-items-table">
          <thead><tr><th class="item-desc">Description</th><th>Qty</th><th>Price</th><th>Total</th><th>Category</th><th></th></tr></thead>
          <tbody id="rm-items"></tbody>
        </table>
        <button type="button" class="add-item-link" onclick="addModalItem()">+ Add line item</button>
      </div>`;

  const card = openModal(`
    <h3>${editing ? 'Edit transaction' : 'New transaction'}</h3>
    <div class="modal-sub">${editing ? 'Update any field and save. Edit items by clicking the store name on a row.' : 'Fill in what matters, defaults handle the rest.'}</div>
    <div class="modal-fields">
      <div class="field">
        <label>Store</label>
        <input id="rm-store" type="text" value="${escapeAttr(receipt.store)}" placeholder="Where?" />
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div class="field">
          <label>Amount</label>
          <div class="field-money">
            <span class="dollar">$</span>
            <input id="rm-total" type="number" step="0.01" min="0" placeholder="0.00" value="${receipt.total != null ? receipt.total : ''}" />
          </div>
        </div>
        <div class="field">
          <label>Date</label>
          <input id="rm-date" type="date" value="${receipt.date || todayISO()}" />
        </div>
      </div>
      <div class="field">
        <label>Category</label>
        <div class="cat-chips" id="rm-cats">${catChips}</div>
      </div>
      ${itemsSection}
      <p id="rm-error" class="setup-error hidden"></p>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="rm-save">${editing ? 'Save changes' : 'Add transaction'}</button>
    </div>
  `);

  card.dataset.editing = editing ? '1' : '';
  card.dataset.id = receipt.id;
  card.dataset.category = receipt.category;

  card.querySelectorAll('#rm-cats .cat-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      card.querySelectorAll('#rm-cats .cat-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      card.dataset.category = chip.dataset.cat;
      card.querySelectorAll('#rm-items tr').forEach(tr => {
        if (tr.dataset.catOverridden !== '1') {
          const sel = tr.querySelector('.item-cat');
          if (sel) sel.value = chip.dataset.cat;
        }
      });
    });
  });

  document.getElementById('rm-save').addEventListener('click', () => commitReceiptModal(card));
  setTimeout(() => document.getElementById('rm-store').focus(), 0);
}

function addModalItem(prefill) {
  const tbody = document.getElementById('rm-items');
  if (!tbody) return;
  const id = ++modalReceiptItemCounter;
  const tr = document.createElement('tr');
  tr.dataset.itemId = prefill?.id || '';
  const card = document.getElementById('modal-card');
  const defaultCat = prefill?.category || card.dataset.category || categories[0]?.id || 'other';
  if (prefill && prefill.category && prefill.category !== card.dataset.category) {
    tr.dataset.catOverridden = '1';
  }

  tr.innerHTML = `
    <td><input class="item-desc" type="text" value="${escapeAttr(prefill?.description || '')}" placeholder="Description" /></td>
    <td><input class="item-qty" type="number" min="0.01" step="any" value="${prefill?.quantity || '1'}" /></td>
    <td><input class="item-price" type="number" min="0" step="0.01" value="${prefill?.unit_price || ''}" placeholder="0.00" /></td>
    <td class="item-total">—</td>
    <td></td>
    <td><button type="button" class="remove-item-btn" title="Remove">&times;</button></td>
  `;

  const sel = document.createElement('select');
  sel.className = 'item-cat';
  categories.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id; opt.textContent = c.name;
    if (c.id === defaultCat) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', () => { tr.dataset.catOverridden = '1'; });
  tr.children[4].appendChild(sel);

  const qty = tr.querySelector('.item-qty');
  const price = tr.querySelector('.item-price');
  const totalCell = tr.querySelector('.item-total');
  function recalc() {
    const q = parseFloat(qty.value);
    const p = parseFloat(price.value);
    totalCell.textContent = (q > 0 && p > 0) ? fmt(q * p) : '—';
    syncReceiptTotalFromItems();
  }
  qty.addEventListener('input', recalc);
  price.addEventListener('input', recalc);
  recalc();

  tr.querySelector('.remove-item-btn').addEventListener('click', () => {
    tr.remove();
    syncReceiptTotalFromItems();
  });

  tbody.appendChild(tr);
}

function syncReceiptTotalFromItems() {
  let sum = 0;
  let hasAny = false;
  document.querySelectorAll('#rm-items tr').forEach(tr => {
    const q = parseFloat(tr.querySelector('.item-qty')?.value);
    const p = parseFloat(tr.querySelector('.item-price')?.value);
    if (q > 0 && p > 0) { sum += q * p; hasAny = true; }
  });
  if (hasAny) {
    const totalInput = document.getElementById('rm-total');
    if (totalInput) totalInput.value = sum.toFixed(2);
  }
}

async function commitReceiptModal(card) {
  const editing = card.dataset.editing === '1';
  const id = card.dataset.id;
  const store = document.getElementById('rm-store').value.trim();
  const date = document.getElementById('rm-date').value;
  const total = parseFloat(document.getElementById('rm-total').value);
  const category = card.dataset.category;
  const err = document.getElementById('rm-error');
  err.classList.add('hidden');

  if (!store || !date || isNaN(total) || total < 0) {
    err.textContent = 'Please fill in store, date, and a valid amount.';
    err.classList.remove('hidden');
    return;
  }

  const items = [];
  document.querySelectorAll('#rm-items tr').forEach(tr => {
    const desc = tr.querySelector('.item-desc')?.value.trim() || '';
    const qty = parseFloat(tr.querySelector('.item-qty')?.value);
    const price = parseFloat(tr.querySelector('.item-price')?.value);
    const itemCat = tr.querySelector('.item-cat')?.value || category;
    const existingId = tr.dataset.itemId;
    if (desc || (qty > 0 && price > 0)) {
      items.push({
        id: existingId || uid(),
        receipt_id: id,
        description: desc,
        quantity: qty > 0 ? qty : '',
        unit_price: price > 0 ? price : '',
        total_price: (qty > 0 && price > 0) ? Math.round(qty * price * 100) / 100 : '',
        category: itemCat,
      });
    }
  });

  const receipt = {
    id,
    date,
    store,
    total: Math.round(total * 100) / 100,
    uploaded_at: new Date().toISOString(),
    category,
  };

  const btn = document.getElementById('rm-save');
  btn.disabled = true;
  btn.textContent = editing ? 'Saving…' : 'Adding…';

  try {
    if (editing) {
      const updates = { date, store, total: receipt.total, category };
      await apiPost({ action: 'update_receipt', id, updates });
      const r = cache.receipts.find(r => r.id === id);
      if (r) Object.assign(r, updates);
      showToast(`Updated ${fmt(receipt.total)} · ${categoryById(receipt.category).name}`);
    } else {
      await apiPost({ action: 'add_receipt', receipt, items });
      cache.receipts.push(receipt);
      cache.items.push(...items);
      showToast(`Added ${fmt(receipt.total)} · ${categoryById(receipt.category).name}`);
    }
    closeModal();
    renderCurrent();
  } catch (e) {
    err.textContent = 'Save failed: ' + e.message;
    err.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = editing ? 'Save changes' : 'Add transaction';
  }
}

// ── Budgets page ───────────────────────────────────────────

function renderBudgetsPage() {
  if (!cache) return;
  const range = monthRange();
  const stats = computeMonthStats(range);
  const budgets = getBudgetMap();
  const list = document.getElementById('budgets-list');
  const pacePct = pacePercent(range);
  list.innerHTML = '';

  categories.forEach(c => {
    const spent = stats.spendByCat[c.id] || 0;
    const budget = budgets[c.id] || 0;
    const pct = budget > 0 ? spent / budget : 0;
    const over = pct > 1;
    const row = document.createElement('div');
    row.className = 'budget-row';
    row.style.setProperty('--cat-color', c.color);
    row.innerHTML = `
      <div class="budget-row-name">
        <span class="cat-dot" style="width:10px;height:10px;background:${c.color}"></span>
        <span>${c.name}</span>
      </div>
      <div class="budget-row-progress">
        <div class="cat-bar">
          <div class="cat-bar-fill${over ? ' over' : ''}" style="background:${c.color};width:${Math.min(pct, 1) * 100}%"></div>
          ${budget > 0 ? `<div class="cat-pace-mark" style="left:${Math.min(pacePct, 1) * 100}%"></div>` : ''}
        </div>
        <div class="meta">
          <span>${fmt(spent)} spent</span>
          <span>${budget > 0 ? fmt(Math.max(budget - spent, 0)) + ' left' : 'no budget'}</span>
        </div>
      </div>
      <div class="field-money budget-row-input">
        <span class="dollar">$</span>
        <input type="number" step="1" min="0" data-cat="${c.id}" value="${budget || ''}" placeholder="0" />
      </div>
    `;
    list.appendChild(row);
  });

  list.querySelectorAll('input[data-cat]').forEach(input => {
    input.addEventListener('blur', () => commitBudget(input.dataset.cat, input.value).then(() => renderBudgetsPage()));
    input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
  });

  renderCategoriesList();
  renderColorPicker();
}

function renderCategoriesList() {
  const container = document.getElementById('categories-list');
  if (!container) return;
  container.innerHTML = '';
  const customIds = new Set(((cache && cache.categories) || []).map(c => c.id));

  categories.forEach(cat => {
    const row = document.createElement('div');
    row.className = 'category-row';
    const isCustom = customIds.has(cat.id);
    row.innerHTML = `
      <span class="cat-dot" style="background:${cat.color}"></span>
      <span class="category-row-name">${cat.name}</span>
      <span class="category-row-tag">${isCustom ? 'Custom' : 'Built-in'}</span>
    `;
    if (isCustom) {
      const del = document.createElement('button');
      del.className = 'recent-icon-btn';
      del.textContent = 'Remove';
      del.addEventListener('click', () => deleteCustomCategory(cat.id));
      row.appendChild(del);
    }
    container.appendChild(row);
  });
}

let pickedColor = CATEGORY_COLOR_PALETTE[0];

function renderColorPicker() {
  const container = document.getElementById('new-cat-color-picker');
  if (!container) return;
  container.innerHTML = '';
  pickedColor = CATEGORY_COLOR_PALETTE[0];
  CATEGORY_COLOR_PALETTE.forEach((color, i) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'color-dot' + (i === 0 ? ' active' : '');
    dot.style.background = color;
    dot.addEventListener('click', () => {
      pickedColor = color;
      container.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
      dot.classList.add('active');
    });
    container.appendChild(dot);
  });
}

async function submitAddCategory(e) {
  e.preventDefault();
  const input = document.getElementById('new-cat-name');
  const err = document.getElementById('new-cat-error');
  const btn = document.getElementById('new-cat-submit');
  err.classList.add('hidden');

  const name = input.value.trim();
  if (!name) { input.classList.add('invalid'); return; }
  input.classList.remove('invalid');

  const baseId = 'custom_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  if (categories.some(c => c.id === baseId || c.name.toLowerCase() === name.toLowerCase())) {
    err.textContent = 'A category with that name already exists.';
    err.classList.remove('hidden');
    return;
  }

  const category = { id: baseId || ('custom_' + uid().slice(0, 8)), name, color: pickedColor };
  btn.disabled = true;
  btn.textContent = 'Adding…';
  try {
    await apiPost({ action: 'add_category', category });
    if (!cache.categories) cache.categories = [];
    cache.categories.push(category);
    rebuildCategories();
    input.value = '';
    renderBudgetsPage();
  } catch (e2) {
    err.textContent = 'Could not add: ' + e2.message;
    err.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Add Category';
  }
}

async function deleteCustomCategory(id) {
  if (!confirm('Delete this category? Receipts in it will be moved to "Other".')) return;
  try {
    await apiPost({ action: 'delete_category', id });
    if (cache.categories) cache.categories = cache.categories.filter(c => c.id !== id);
    if (cache.budgets) cache.budgets = cache.budgets.filter(b => b.category_id !== id);
    if (cache.receipts) cache.receipts.forEach(r => { if (r.category === id) r.category = 'other'; });
    if (cache.items) cache.items.forEach(it => { if (it.category === id) it.category = 'other'; });
    rebuildCategories();
    renderBudgetsPage();
  } catch (e) {
    showToast('Delete failed: ' + e.message, { error: true });
  }
}

// ── Settings ──────────────────────────────────────────────

function renderSettingsPage() {
  if (!cache) return;
  const input = document.getElementById('settings-savings-target');
  if (!input) return;
  const current = parseFloat(getSetting('savings_target_pct'));
  input.value = isNaN(current) ? '' : current;
  if (input.dataset.bound !== '1') {
    input.dataset.bound = '1';
    input.addEventListener('blur', () => commitSavingsTarget(input.value));
    input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
  }
}

async function commitSavingsTarget(raw) {
  const trimmed = String(raw).trim();
  const status = document.getElementById('savings-target-status');
  status.classList.add('hidden');
  let value = '';
  if (trimmed !== '') {
    const n = parseFloat(trimmed);
    if (isNaN(n) || n < 0 || n > 100) {
      status.textContent = 'Enter a number between 0 and 100.';
      status.classList.remove('hidden');
      return;
    }
    value = n;
  }
  if (!cache.settings) cache.settings = [];
  const row = cache.settings.find(s => s.key === 'savings_target_pct');
  if (value === '') {
    cache.settings = cache.settings.filter(s => s.key !== 'savings_target_pct');
  } else if (row) {
    row.value = value;
  } else {
    cache.settings.push({ key: 'savings_target_pct', value });
  }
  try {
    await apiPost({ action: 'set_setting', key: 'savings_target_pct', value });
    showToast(value === '' ? 'Savings target cleared' : `Savings target set to ${value}%`);
  } catch (e) {
    showToast('Could not save target: ' + e.message, { error: true });
    refreshData();
  }
}

async function confirmClearAll() {
  if (!confirm('Permanently delete ALL receipts and items from your Google Sheet? This cannot be undone.')) return;
  try {
    await apiPost({ action: 'clear' });
    cache.receipts = [];
    cache.items = [];
    showDataStatus('All data cleared.');
    renderCurrent();
  } catch (e) {
    showDataStatus('Clear failed: ' + e.message, true);
  }
}

function showDataStatus(msg, isError) {
  const el = document.getElementById('data-status');
  el.textContent = msg;
  el.style.color = isError ? 'var(--red)' : 'var(--accent)';
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

// ── Toast ─────────────────────────────────────────────────

function showToast(msg, opts) {
  opts = opts || {};
  const root = document.getElementById('toast-root');
  const node = document.createElement('div');
  node.className = 'toast' + (opts.error ? ' error' : '');
  const msgEl = document.createElement('span');
  msgEl.textContent = msg;
  node.appendChild(msgEl);
  if (opts.undo) {
    const undoBtn = document.createElement('button');
    undoBtn.className = 'undo';
    undoBtn.textContent = 'Undo';
    undoBtn.addEventListener('click', () => {
      opts.undo();
      clearToast();
    });
    node.appendChild(undoBtn);
  }
  clearToast();
  root.appendChild(node);
  toastTimer = setTimeout(clearToast, opts.undo ? 5000 : 3000);
}

function clearToast() {
  const root = document.getElementById('toast-root');
  if (root) root.innerHTML = '';
  if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
}

// ── Helpers ───────────────────────────────────────────────

function escapeAttr(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeHtml(s) {
  return escapeAttr(s);
}

// ── Meals page ────────────────────────────────────────────

function allocationsByItem() {
  const map = {};
  ((cache && cache.meal_allocations) || []).forEach(a => {
    const p = parseFloat(a.portion);
    if (!isFinite(p) || p <= 0) return;
    (map[a.item_id] = map[a.item_id] || []).push(a);
  });
  return map;
}

function allocationsByMeal() {
  const map = {};
  ((cache && cache.meal_allocations) || []).forEach(a => {
    const p = parseFloat(a.portion);
    if (!isFinite(p) || p <= 0) return;
    (map[a.meal_id] = map[a.meal_id] || []).push(a);
  });
  return map;
}

function itemTotalAllocated(itemId, excludeMealId) {
  return ((cache && cache.meal_allocations) || []).reduce((s, a) => {
    if (a.item_id !== itemId) return s;
    if (excludeMealId && a.meal_id === excludeMealId) return s;
    const p = parseFloat(a.portion);
    return isFinite(p) && p > 0 ? s + p : s;
  }, 0);
}

function itemById(id) {
  return ((cache && cache.items) || []).find(i => i.id === id) || null;
}

function receiptById(id) {
  return ((cache && cache.receipts) || []).find(r => r.id === id) || null;
}

function itemLabel(it) {
  const desc = (it.description || '').trim();
  if (desc) return desc;
  const r = receiptById(it.receipt_id);
  return (r && r.store) ? `${r.store} item` : 'Unnamed item';
}

function itemUnitCost(it) {
  const tot = parseFloat(it.total_price);
  if (isFinite(tot) && tot > 0) return tot;
  const q = parseFloat(it.quantity);
  const u = parseFloat(it.unit_price);
  if (isFinite(q) && isFinite(u) && q > 0 && u > 0) return q * u;
  return 0;
}

function renderMealsPage() {
  if (!cache) return;
  const meals = (cache.meals || []).slice().sort((a, b) =>
    String(b.date || '').localeCompare(String(a.date || ''))
  );
  const sub = document.getElementById('meals-sub');
  if (sub) sub.textContent = meals.length === 0
    ? 'Plan meals from the food items in your receipts.'
    : `${meals.length} planned · ${(cache.meal_allocations || []).length} ingredient allocations`;

  renderMealsList(meals);
  renderPantry();
}

function renderMealsList(meals) {
  const list = document.getElementById('meals-list');
  if (!list) return;
  list.innerHTML = '';

  if (meals.length === 0) {
    list.innerHTML = `
      <div class="recent">
        <div class="recent-empty">
          <div class="ttl">No meals planned yet.</div>
          <div>Click "+ Plan a meal" to compose one from your pantry.</div>
        </div>
      </div>`;
    return;
  }

  const byMeal = allocationsByMeal();
  const wrap = document.createElement('div');
  wrap.className = 'meals-grid';
  meals.forEach(m => {
    const allocs = byMeal[m.id] || [];
    let mealCost = 0;
    const lines = allocs.map(a => {
      const it = itemById(a.item_id);
      const portion = parseFloat(a.portion);
      const cost = it ? itemUnitCost(it) * portion : 0;
      mealCost += cost;
      const label = it ? itemLabel(it) : '(missing item)';
      return `
        <div class="meal-line">
          <span class="meal-line-name">${escapeHtml(label)}</span>
          <span class="meal-line-portion">${Math.round(portion * 100)}%</span>
          <span class="meal-line-cost">${cost > 0 ? fmt(cost) : '—'}</span>
        </div>`;
    }).join('');

    const cat = categoryById(m.category || 'beta_meal');
    const d = m.date ? new Date(m.date + 'T00:00:00') : null;
    const dateLabel = d ? d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '';

    const card = document.createElement('div');
    card.className = 'meal-card';
    card.style.setProperty('--cat-color', cat.color);
    card.innerHTML = `
      <div class="meal-head">
        <div>
          <div class="meal-name">${escapeHtml(m.name || 'Untitled meal')}</div>
          <div class="meal-meta">
            <span class="cat-dot" style="background:${cat.color}"></span>
            <span>${escapeHtml(cat.name)}</span>
            ${dateLabel ? `<span>·</span><span>${dateLabel}</span>` : ''}
          </div>
        </div>
        <div class="meal-cost">${mealCost > 0 ? fmt(mealCost) : '—'}</div>
      </div>
      ${m.notes ? `<div class="meal-notes">${escapeHtml(m.notes)}</div>` : ''}
      <div class="meal-lines">${lines || '<div class="meal-empty">No ingredients allocated yet.</div>'}</div>
      <div class="meal-actions">
        <button class="btn btn-ghost btn-sm" data-act="edit" data-id="${m.id}">Edit</button>
        <button class="btn btn-ghost btn-sm" data-act="delete" data-id="${m.id}">Delete</button>
      </div>
    `;
    card.querySelector('[data-act="edit"]').addEventListener('click', () => openMealModal(m));
    card.querySelector('[data-act="delete"]').addEventListener('click', () => deleteMeal(m));
    wrap.appendChild(card);
  });
  list.appendChild(wrap);
}

function renderPantry() {
  const container = document.getElementById('pantry-list');
  if (!container) return;
  const search = (document.getElementById('pantry-search')?.value || '').toLowerCase();
  const availableOnly = document.getElementById('pantry-available-only')?.checked || false;

  const items = ((cache && cache.items) || []).slice();
  const byItem = allocationsByItem();

  let rows = items.map(it => {
    const allocated = (byItem[it.id] || []).reduce((s, a) => s + parseFloat(a.portion || 0), 0);
    const remaining = Math.max(0, 1 - allocated);
    return { it, allocated, remaining };
  });

  if (search) {
    rows = rows.filter(r => {
      const l = itemLabel(r.it).toLowerCase();
      return l.includes(search);
    });
  }
  if (availableOnly) rows = rows.filter(r => r.remaining > 0.001);

  rows.sort((a, b) => {
    if (b.remaining !== a.remaining) return b.remaining - a.remaining;
    return itemLabel(a.it).localeCompare(itemLabel(b.it));
  });

  const meta = document.getElementById('pantry-meta');
  if (meta) meta.textContent = `${rows.length} ITEM${rows.length === 1 ? '' : 'S'}`;

  if (rows.length === 0) {
    container.innerHTML = `<div class="recent-empty" style="padding:32px 24px">
      <div>No food items match.</div>
      <div style="font-size:13px;margin-top:4px">Add line items to a receipt to populate your pantry.</div>
    </div>`;
    return;
  }

  const table = document.createElement('table');
  table.className = 'pantry-table';
  table.innerHTML = `
    <thead><tr>
      <th>Item</th>
      <th>From</th>
      <th>Category</th>
      <th class="num">Cost</th>
      <th class="num">Allocated</th>
      <th class="num">Remaining</th>
    </tr></thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector('tbody');
  rows.forEach(({ it, allocated, remaining }) => {
    const r = receiptById(it.receipt_id);
    const cat = categoryById(it.category || (r && r.category) || 'other');
    const cost = itemUnitCost(it);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(itemLabel(it))}</td>
      <td class="muted">${r ? escapeHtml(r.store || '—') : '—'}<span class="pantry-date">${r && r.date ? ' · ' + r.date : ''}</span></td>
      <td><span class="cat-dot" style="background:${cat.color}"></span> ${escapeHtml(cat.name)}</td>
      <td class="num">${cost > 0 ? fmt(cost) : '—'}</td>
      <td class="num">${Math.round(allocated * 100)}%</td>
      <td class="num"><strong>${Math.round(remaining * 100)}%</strong></td>
    `;
    tbody.appendChild(tr);
  });

  container.innerHTML = '';
  container.appendChild(table);

  const searchInput = document.getElementById('pantry-search');
  const availInput = document.getElementById('pantry-available-only');
  if (searchInput && searchInput.dataset.bound !== '1') {
    searchInput.dataset.bound = '1';
    searchInput.addEventListener('input', renderPantry);
  }
  if (availInput && availInput.dataset.bound !== '1') {
    availInput.dataset.bound = '1';
    availInput.addEventListener('change', renderPantry);
  }
}

// ── Meal modal ────────────────────────────────────────────

function openMealModal(existing) {
  const editing = !!existing;
  const meal = existing || {
    id: uid(),
    name: '',
    date: todayISO(),
    notes: '',
    category: 'beta_meal',
  };

  const catChips = categories.map(c =>
    `<button type="button" class="cat-chip${c.id === (meal.category || 'beta_meal') ? ' active' : ''}" data-cat="${c.id}">
       <span class="cat-dot" style="background:${c.color}"></span>${escapeHtml(c.name)}
     </button>`
  ).join('');

  const card = openModal(`
    <h3>${editing ? 'Edit meal' : 'Plan a meal'}</h3>
    <div class="modal-sub">${editing ? 'Adjust details or re-allocate ingredients from your pantry.' : 'Name it, then pick ingredients from your pantry and allocate a portion of each.'}</div>
    <div class="modal-fields">
      <div class="field">
        <label>Name</label>
        <input id="mm-name" type="text" value="${escapeAttr(meal.name)}" placeholder="Tuesday stir-fry" />
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div class="field">
          <label>Date</label>
          <input id="mm-date" type="date" value="${meal.date || todayISO()}" />
        </div>
        <div class="field">
          <label>Notes</label>
          <input id="mm-notes" type="text" value="${escapeAttr(meal.notes)}" placeholder="Optional" />
        </div>
      </div>
      <div class="field">
        <label>Category</label>
        <div class="cat-chips" id="mm-cats">${catChips}</div>
      </div>
      <div class="field">
        <label>Ingredients <span style="text-transform:none;letter-spacing:0;color:var(--ink-4)">— pick from pantry, allocate %</span></label>
        <input id="mm-search" type="text" placeholder="Search food items in your pantry…" autocomplete="off" style="border:1px solid var(--hairline);background:var(--panel-2);border-radius:8px;padding:8px 12px;font-size:14px" />
        <div id="mm-pantry" class="meal-pantry"></div>
      </div>
      <p id="mm-error" class="setup-error hidden"></p>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="mm-save">${editing ? 'Save meal' : 'Add meal'}</button>
    </div>
  `);

  card.dataset.editing = editing ? '1' : '';
  card.dataset.id = meal.id;
  card.dataset.category = meal.category || 'beta_meal';

  const existingAllocs = ((cache && cache.meal_allocations) || [])
    .filter(a => a.meal_id === meal.id);
  card.__allocations = {};
  card.__allocIds = {};
  existingAllocs.forEach(a => {
    const p = parseFloat(a.portion);
    if (isFinite(p) && p > 0) {
      card.__allocations[a.item_id] = p;
      card.__allocIds[a.item_id] = a.id;
    }
  });

  card.querySelectorAll('#mm-cats .cat-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      card.querySelectorAll('#mm-cats .cat-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      card.dataset.category = chip.dataset.cat;
    });
  });

  const searchInput = document.getElementById('mm-search');
  searchInput.addEventListener('input', () => renderMealPantry(card, searchInput.value));
  renderMealPantry(card, '');

  document.getElementById('mm-save').addEventListener('click', () => commitMealModal(card));
  setTimeout(() => document.getElementById('mm-name').focus(), 0);
}

function renderMealPantry(card, search) {
  const container = card.querySelector('#mm-pantry');
  const mealId = card.dataset.id;
  const items = ((cache && cache.items) || []).slice();
  const q = (search || '').toLowerCase();

  const rows = items.map(it => {
    const otherAllocated = itemTotalAllocated(it.id, mealId);
    const remainingForOthers = Math.max(0, 1 - otherAllocated);
    const thisMealCurrent = card.__allocations[it.id] || 0;
    const maxForThis = Math.min(1, remainingForOthers + thisMealCurrent);
    return { it, otherAllocated, maxForThis, thisMealCurrent };
  }).filter(r => {
    if (q) return itemLabel(r.it).toLowerCase().includes(q);
    return true;
  });

  rows.sort((a, b) => {
    if ((b.thisMealCurrent > 0) !== (a.thisMealCurrent > 0)) return (b.thisMealCurrent > 0 ? 1 : 0) - (a.thisMealCurrent > 0 ? 1 : 0);
    if (b.maxForThis !== a.maxForThis) return b.maxForThis - a.maxForThis;
    return itemLabel(a.it).localeCompare(itemLabel(b.it));
  });

  if (rows.length === 0) {
    container.innerHTML = `<div class="meal-pantry-empty">No food items match. Add line items to a receipt first.</div>`;
    return;
  }

  container.innerHTML = '';
  rows.slice(0, 80).forEach(({ it, maxForThis, thisMealCurrent, otherAllocated }) => {
    const r = receiptById(it.receipt_id);
    const cat = categoryById(it.category || (r && r.category) || 'other');
    const cost = itemUnitCost(it);
    const row = document.createElement('div');
    row.className = 'meal-pantry-row';
    row.innerHTML = `
      <div class="meal-pantry-info">
        <div class="meal-pantry-name">
          <span class="cat-dot" style="background:${cat.color}"></span>
          ${escapeHtml(itemLabel(it))}
        </div>
        <div class="meal-pantry-meta">${r ? escapeHtml(r.store || '') : ''}${cost > 0 ? ' · ' + fmt(cost) : ''} · ${Math.round(maxForThis * 100)}% available</div>
      </div>
      <div class="meal-pantry-alloc">
        <input type="range" min="0" max="100" step="5" value="${Math.round(thisMealCurrent * 100)}" data-item="${it.id}" data-max="${Math.round(maxForThis * 100)}" />
        <input type="number" min="0" max="${Math.round(maxForThis * 100)}" step="1" value="${Math.round(thisMealCurrent * 100)}" data-itemnum="${it.id}" />
        <span class="pct-suffix">%</span>
      </div>
    `;
    const slider = row.querySelector('input[type="range"]');
    const num = row.querySelector('input[type="number"]');

    function applyValue(v, source) {
      let val = parseFloat(v);
      if (!isFinite(val) || val < 0) val = 0;
      const max = parseFloat(slider.dataset.max);
      if (val > max) val = max;
      const portion = val / 100;
      if (portion > 0) card.__allocations[it.id] = portion;
      else delete card.__allocations[it.id];
      if (source !== 'range') slider.value = String(val);
      if (source !== 'num') num.value = String(val);
    }
    slider.addEventListener('input', () => applyValue(slider.value, 'range'));
    num.addEventListener('input', () => applyValue(num.value, 'num'));

    container.appendChild(row);
  });
}

async function commitMealModal(card) {
  const editing = card.dataset.editing === '1';
  const id = card.dataset.id;
  const name = document.getElementById('mm-name').value.trim();
  const date = document.getElementById('mm-date').value;
  const notes = document.getElementById('mm-notes').value.trim();
  const category = card.dataset.category || 'beta_meal';
  const err = document.getElementById('mm-error');
  err.classList.add('hidden');

  if (!name || !date) {
    err.textContent = 'Please give the meal a name and date.';
    err.classList.remove('hidden');
    return;
  }

  const meal = {
    id,
    name,
    date,
    notes,
    category,
    uploaded_at: new Date().toISOString(),
  };

  const desiredAllocs = card.__allocations || {};
  const existingIds = card.__allocIds || {};

  const allocOps = [];
  Object.keys(desiredAllocs).forEach(itemId => {
    const portion = desiredAllocs[itemId];
    if (!(portion > 0)) return;
    const allocId = existingIds[itemId] || uid();
    allocOps.push({ kind: 'set', allocation: { id: allocId, meal_id: id, item_id: itemId, portion, notes: '' } });
  });
  Object.keys(existingIds).forEach(itemId => {
    if (!desiredAllocs[itemId]) {
      allocOps.push({ kind: 'delete', id: existingIds[itemId] });
    }
  });

  const btn = document.getElementById('mm-save');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    if (editing) {
      const updates = { name, date, notes, category };
      await apiPost({ action: 'update_meal', id, updates });
      const m = cache.meals.find(x => x.id === id);
      if (m) Object.assign(m, updates);
    } else {
      await apiPost({ action: 'add_meal', meal });
      if (!cache.meals) cache.meals = [];
      cache.meals.push(meal);
    }

    if (!cache.meal_allocations) cache.meal_allocations = [];
    for (const op of allocOps) {
      if (op.kind === 'set') {
        await apiPost({ action: 'set_meal_allocation', allocation: op.allocation });
        const idx = cache.meal_allocations.findIndex(a => a.id === op.allocation.id);
        if (idx >= 0) cache.meal_allocations[idx] = op.allocation;
        else cache.meal_allocations.push(op.allocation);
      } else if (op.kind === 'delete') {
        await apiPost({ action: 'delete_meal_allocation', id: op.id });
        cache.meal_allocations = cache.meal_allocations.filter(a => a.id !== op.id);
      }
    }

    showToast(`${editing ? 'Updated' : 'Added'} meal · ${name}`);
    closeModal();
    renderCurrent();
  } catch (e) {
    err.textContent = 'Save failed: ' + e.message;
    err.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = editing ? 'Save meal' : 'Add meal';
  }
}

async function deleteMeal(meal) {
  if (!confirm(`Delete "${meal.name || 'this meal'}" and free its allocated portions?`)) return;
  const removedMeal = meal;
  const removedAllocs = ((cache && cache.meal_allocations) || []).filter(a => a.meal_id === meal.id);
  cache.meals = (cache.meals || []).filter(m => m.id !== meal.id);
  cache.meal_allocations = (cache.meal_allocations || []).filter(a => a.meal_id !== meal.id);
  renderCurrent();
  try {
    await apiPost({ action: 'delete_meal', id: meal.id });
    showToast(`Removed meal · ${removedMeal.name}`, {
      undo: async () => {
        cache.meals.push(removedMeal);
        cache.meal_allocations.push(...removedAllocs);
        renderCurrent();
        try {
          await apiPost({ action: 'add_meal', meal: removedMeal });
          for (const a of removedAllocs) {
            await apiPost({ action: 'set_meal_allocation', allocation: a });
          }
        } catch (e) {
          showToast('Undo failed: ' + e.message, { error: true });
          refreshData();
        }
      }
    });
  } catch (e) {
    cache.meals.push(removedMeal);
    cache.meal_allocations.push(...removedAllocs);
    renderCurrent();
    showToast('Delete failed: ' + e.message, { error: true });
  }
}

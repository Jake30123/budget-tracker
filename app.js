// ── Config / State ─────────────────────────────────────────

const SCRIPT_URL_KEY = 'budget-tracker-script-url';

let scriptUrl = localStorage.getItem(SCRIPT_URL_KEY) || '';
let categories = CATEGORIES.slice();
let cache = null;           // { receipts, items, budgets, categories } from last fetch
let pendingFetch = null;    // dedupe concurrent reads
let categoryChart = null;
let groceryChart = null;
let itemCounter = 0;

const CATEGORY_COLOR_PALETTE = [
  '#22c55e', '#f97316', '#3b82f6', '#8b5cf6', '#ec4899',
  '#f59e0b', '#14b8a6', '#ef4444', '#0ea5e9', '#a855f7',
  '#84cc16', '#eab308', '#06b6d4', '#d946ef', '#6b7280',
];

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
    merged.push({ id: c.id, name: c.name, color: c.color || '#6b7280', keywords: [] });
  });
  const other = CATEGORIES.find(c => c.id === 'other');
  if (other) merged.push(other);
  categories = merged;
}

function getBudgetMap() {
  const map = {};
  ((cache && cache.budgets) || []).forEach(b => {
    const amt = parseFloat(b.amount);
    if (!isNaN(amt) && amt > 0) map[b.category_id] = amt;
  });
  return map;
}

// ── Boot ───────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  if (!scriptUrl) {
    showSetup();
  } else {
    showApp();
  }
});

function showSetup() {
  document.getElementById('setup-overlay').classList.remove('hidden');
  document.getElementById('app-root').classList.add('hidden');
  document.getElementById('setup-url').value = scriptUrl || '';
  document.getElementById('setup-url').focus();
}

function showApp() {
  document.getElementById('setup-overlay').classList.add('hidden');
  document.getElementById('app-root').classList.remove('hidden');
  document.getElementById('settings-url').textContent = scriptUrl;
  initForm();
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

// ── API Layer ──────────────────────────────────────────────

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
    // text/plain body keeps this a CORS "simple" request and avoids preflight,
    // which Apps Script web apps don't always handle smoothly.
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
    const active = document.querySelector('.nav-btn.active')?.dataset.tab;
    if (active === 'dashboard') loadDashboard();
    if (active === 'receipts') loadReceipts();
    if (active === 'budgets') loadBudgets();
    if (active === 'add') buildCategoryPills();
  } catch (e) {
    alert('Could not refresh: ' + e.message);
  }
}

// ── Navigation ─────────────────────────────────────────────

function showTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.add('hidden'));
  document.getElementById(`tab-${name}`).classList.remove('hidden');
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === name);
  });
  if (name === 'dashboard') loadDashboard();
  if (name === 'receipts') loadReceipts();
  if (name === 'budgets') loadBudgets();
}

// ── Utilities ──────────────────────────────────────────────

function uid() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '');
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function fmt(amount) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function makeCategorySelect(currentCat, onChange) {
  const sel = document.createElement('select');
  sel.className = 'category-select';
  categories.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat.id;
    opt.textContent = cat.name;
    if (cat.id === currentCat) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

// ── Form Init ──────────────────────────────────────────────

function initForm() {
  document.getElementById('form-date').value = todayISO();
  buildCategoryPills();
}

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

function buildCategoryPills() {
  const container = document.getElementById('category-pills');
  container.innerHTML = '';
  categories.forEach((cat, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cat-pill' + (i === 0 ? ' active' : '');
    btn.dataset.cat = cat.id;
    btn.textContent = cat.name;
    btn.style.setProperty('--cat-color', cat.color);
    btn.addEventListener('click', () => {
      container.querySelectorAll('.cat-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
    container.appendChild(btn);
  });
}

function getSelectedCategory() {
  return document.querySelector('.cat-pill.active')?.dataset.cat || 'other';
}

// ── Form Items ─────────────────────────────────────────────

function addFormItem() {
  const id = ++itemCounter;
  const table = document.getElementById('form-items-table');
  const hint = document.getElementById('no-items-hint');
  const tbody = document.getElementById('form-items-body');

  hint.classList.add('hidden');
  table.classList.remove('hidden');

  const tr = document.createElement('tr');
  tr.id = `form-item-${id}`;
  tr.innerHTML = `
    <td><input type="text" class="item-input desc" placeholder="Description"></td>
    <td><input type="number" class="item-input qty" value="1" min="0.01" step="any"></td>
    <td><input type="number" class="item-input price" placeholder="0.00" min="0" step="0.01"></td>
    <td class="item-total-cell">—</td>
    <td><button type="button" class="remove-item-btn" onclick="removeFormItem(${id})">&#215;</button></td>
  `;

  const qty = tr.querySelector('.qty');
  const price = tr.querySelector('.price');
  const total = tr.querySelector('.item-total-cell');

  const recalc = () => {
    const q = parseFloat(qty.value);
    const p = parseFloat(price.value);
    total.textContent = (q > 0 && p > 0) ? fmt(q * p) : '—';
    syncReceiptTotal();
  };

  qty.addEventListener('input', recalc);
  price.addEventListener('input', recalc);

  tbody.appendChild(tr);
  tr.querySelector('.desc').focus();
}

function removeFormItem(id) {
  document.getElementById(`form-item-${id}`)?.remove();
  const tbody = document.getElementById('form-items-body');
  if (!tbody.children.length) {
    document.getElementById('form-items-table').classList.add('hidden');
    document.getElementById('no-items-hint').classList.remove('hidden');
  }
  syncReceiptTotal();
}

function syncReceiptTotal() {
  let sum = 0;
  let hasAny = false;
  document.querySelectorAll('#form-items-body tr').forEach(tr => {
    const q = parseFloat(tr.querySelector('.qty')?.value);
    const p = parseFloat(tr.querySelector('.price')?.value);
    if (q > 0 && p > 0) { sum += q * p; hasAny = true; }
  });
  if (hasAny) {
    document.getElementById('form-total').value = sum.toFixed(2);
  }
}

// ── Form Submit ────────────────────────────────────────────

async function submitForm(e) {
  e.preventDefault();

  const storeInput = document.getElementById('form-store');
  const totalInput = document.getElementById('form-total');
  const errorEl = document.getElementById('form-error');

  storeInput.classList.remove('invalid');
  totalInput.classList.remove('invalid');
  errorEl.classList.add('hidden');

  const storeName = storeInput.value.trim();
  const date = document.getElementById('form-date').value;
  const total = parseFloat(totalInput.value);

  if (!storeName) {
    storeInput.classList.add('invalid');
    storeInput.focus();
    return;
  }
  if (!date) return;
  if (isNaN(total) || total < 0) {
    totalInput.classList.add('invalid');
    showFormError('Please enter a valid total amount.');
    return;
  }

  const category = getSelectedCategory();
  const receiptId = uid();
  const receipt = {
    id: receiptId,
    date,
    store: storeName,
    total: Math.round(total * 100) / 100,
    uploaded_at: new Date().toISOString(),
    category,
  };

  const items = [];
  document.querySelectorAll('#form-items-body tr').forEach(tr => {
    const desc = tr.querySelector('.desc')?.value.trim() || '';
    const qty = parseFloat(tr.querySelector('.qty')?.value);
    const price = parseFloat(tr.querySelector('.price')?.value);
    if (desc || (qty > 0 && price > 0)) {
      items.push({
        id: uid(),
        receipt_id: receiptId,
        description: desc,
        quantity: qty > 0 ? qty : '',
        unit_price: price > 0 ? price : '',
        total_price: (qty > 0 && price > 0) ? Math.round(qty * price * 100) / 100 : '',
        category,
      });
    }
  });

  const btn = document.getElementById('form-submit');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    await apiPost({ action: 'add_receipt', receipt, items });
    if (cache) {
      cache.receipts.push(receipt);
      cache.items.push(...items);
    }
    showSuccess(receipt);
  } catch (err) {
    showFormError('Save failed: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Receipt';
  }
}

function showFormError(msg) {
  const el = document.getElementById('form-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function showSuccess(data) {
  const catName = categories.find(c => c.id === data.category)?.name || data.category;
  document.getElementById('success-store').textContent = data.store;
  document.getElementById('success-detail').textContent =
    `${fmt(data.total)} · ${catName} · ${data.date}`;
  document.getElementById('add-form-wrapper').classList.add('hidden');
  document.getElementById('save-success').classList.remove('hidden');
}

function showAddForm() {
  resetForm();
  document.getElementById('save-success').classList.add('hidden');
  document.getElementById('add-form-wrapper').classList.remove('hidden');
}

function resetForm() {
  document.getElementById('receipt-form').reset();
  document.getElementById('form-date').value = todayISO();
  document.getElementById('form-error').classList.add('hidden');
  document.getElementById('form-items-body').innerHTML = '';
  document.getElementById('form-items-table').classList.add('hidden');
  document.getElementById('no-items-hint').classList.remove('hidden');
  buildCategoryPills();
  itemCounter = 0;
}

// ── Dashboard ──────────────────────────────────────────────

function computeDashboard(receipts) {
  const catIds = new Set(categories.map(c => c.id));
  const spendByCat = {};
  categories.forEach(c => { spendByCat[c.id] = 0; });

  receipts.forEach(r => {
    let cat = r.category || 'other';
    if (!catIds.has(cat)) cat = 'other';
    const amt = parseFloat(r.total);
    if (!isNaN(amt)) spendByCat[cat] += amt;
  });

  const groceryReceipts = receipts
    .filter(r => r.category === 'groceries')
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));

  let running = 0;
  const groceryOverTime = [];
  groceryReceipts.forEach(r => {
    const amt = parseFloat(r.total);
    if (!isNaN(amt)) {
      running += amt;
      groceryOverTime.push({
        date: String(r.date),
        store: r.store,
        amount: Math.round(amt * 100) / 100,
        running_total: Math.round(running * 100) / 100,
      });
    }
  });

  const groceryTrips = groceryReceipts.length;
  const groceryTotal = spendByCat['groceries'] || 0;
  const avgGrocery = groceryTrips ? groceryTotal / groceryTrips : 0;

  return {
    total_spend: Math.round(Object.values(spendByCat).reduce((a, b) => a + b, 0) * 100) / 100,
    total_receipts: receipts.length,
    avg_grocery_trip: Math.round(avgGrocery * 100) / 100,
    grocery_total: Math.round(groceryTotal * 100) / 100,
    grocery_trips: groceryTrips,
    spend_by_category: categories.map(c => ({ ...c, total: Math.round((spendByCat[c.id] || 0) * 100) / 100 })),
    grocery_over_time: groceryOverTime,
  };
}

async function loadDashboard() {
  let data;
  try {
    data = await getData();
  } catch (e) {
    return;
  }
  const dash = computeDashboard(data.receipts);

  document.getElementById('stat-total-spend').textContent = fmt(dash.total_spend);
  document.getElementById('stat-total-receipts').textContent = dash.total_receipts;
  document.getElementById('stat-grocery-total').textContent = fmt(dash.grocery_total);
  document.getElementById('stat-avg-grocery').textContent = fmt(dash.avg_grocery_trip);
  document.getElementById('stat-grocery-trips').textContent = dash.grocery_trips;

  renderCategoryChart(dash.spend_by_category);
  renderGroceryChart(dash.grocery_over_time);
  renderBudgetProgress(data.receipts);
}

function renderCategoryChart(spendByCategory) {
  const nonZero = spendByCategory.filter(c => c.total > 0);
  const canvas = document.getElementById('chart-category');
  const empty = document.getElementById('chart-category-empty');

  if (nonZero.length === 0) {
    canvas.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }

  canvas.classList.remove('hidden');
  empty.classList.add('hidden');

  if (categoryChart) categoryChart.destroy();
  categoryChart = new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: nonZero.map(c => c.name),
      datasets: [{
        data: nonZero.map(c => c.total),
        backgroundColor: nonZero.map(c => c.color),
        borderWidth: 2,
        borderColor: '#fff',
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { padding: 16, font: { size: 12 } } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${fmt(ctx.raw)}` } },
      },
    },
  });
}

function renderGroceryChart(groceryOverTime) {
  const canvas = document.getElementById('chart-grocery');
  const empty = document.getElementById('chart-grocery-empty');

  if (groceryOverTime.length === 0) {
    canvas.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }

  canvas.classList.remove('hidden');
  empty.classList.add('hidden');

  if (groceryChart) groceryChart.destroy();
  groceryChart = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: groceryOverTime.map(d => d.date),
      datasets: [
        {
          label: 'Trip Amount',
          data: groceryOverTime.map(d => d.amount),
          backgroundColor: '#22c55e44',
          borderColor: '#22c55e',
          borderWidth: 1,
          order: 2,
        },
        {
          label: 'Running Total',
          type: 'line',
          data: groceryOverTime.map(d => d.running_total),
          borderColor: '#0f172a',
          borderWidth: 2,
          pointRadius: 3,
          tension: 0.3,
          fill: false,
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        y: { beginAtZero: true, ticks: { callback: val => fmt(val) } },
        x: { ticks: { maxRotation: 45 } },
      },
      plugins: {
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.raw)}` } },
      },
    },
  });
}

// ── Receipts ───────────────────────────────────────────────

async function loadReceipts() {
  const container = document.getElementById('receipts-container');
  container.innerHTML = '<p class="empty-state">Loading…</p>';

  let data;
  try {
    data = await getData();
  } catch (e) {
    container.innerHTML = `<p class="empty-state error">Could not load: ${e.message}</p>`;
    return;
  }

  const receipts = data.receipts;
  container.innerHTML = '';

  if (receipts.length === 0) {
    container.innerHTML = '<p class="empty-state">No receipts yet. Add one to get started.</p>';
    return;
  }

  const sorted = [...receipts].sort((a, b) =>
    String(b.date || '').localeCompare(String(a.date || ''))
  );

  const wrapper = document.createElement('div');
  wrapper.className = 'receipts-wrapper';

  const table = document.createElement('table');
  table.className = 'receipts-table';
  table.innerHTML = `
    <thead>
      <tr>
        <th>Date</th>
        <th>Store</th>
        <th>Total</th>
        <th>Category</th>
        <th></th>
        <th></th>
      </tr>
    </thead>
    <tbody id="receipts-tbody"></tbody>
  `;
  wrapper.appendChild(table);
  container.appendChild(wrapper);

  const tbody = table.querySelector('tbody');
  sorted.forEach(receipt => {
    tbody.appendChild(buildReceiptRow(receipt));
  });
}

function buildReceiptRow(receipt) {
  const tr = document.createElement('tr');
  tr.dataset.receiptId = receipt.id;
  renderReceiptRow(tr, receipt, false);
  return tr;
}

function renderReceiptRow(tr, receipt, editing) {
  tr.innerHTML = '';
  if (editing) {
    const dateTd = document.createElement('td');
    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.className = 'row-edit-input';
    dateInput.value = receipt.date || '';
    dateTd.appendChild(dateInput);

    const storeTd = document.createElement('td');
    const storeInput = document.createElement('input');
    storeInput.type = 'text';
    storeInput.className = 'row-edit-input';
    storeInput.value = receipt.store || '';
    storeTd.appendChild(storeInput);

    const totalTd = document.createElement('td');
    const totalWrap = document.createElement('span');
    totalWrap.className = 'row-edit-total';
    const dollar = document.createElement('span');
    dollar.textContent = '$';
    dollar.className = 'row-edit-dollar';
    const totalInput = document.createElement('input');
    totalInput.type = 'number';
    totalInput.step = '0.01';
    totalInput.min = '0';
    totalInput.className = 'row-edit-input';
    totalInput.value = receipt.total != null ? receipt.total : '';
    totalWrap.appendChild(dollar);
    totalWrap.appendChild(totalInput);
    totalTd.appendChild(totalWrap);

    const catTd = document.createElement('td');
    const catSel = makeCategorySelect(receipt.category, () => {});
    catTd.appendChild(catSel);

    const saveTd = document.createElement('td');
    const saveBtn = document.createElement('button');
    saveBtn.className = 'expand-btn save';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', async () => {
      const updates = {
        date: dateInput.value,
        store: storeInput.value.trim(),
        total: Math.round(parseFloat(totalInput.value) * 100) / 100,
        category: catSel.value,
      };
      if (!updates.store || !updates.date || isNaN(updates.total) || updates.total < 0) {
        alert('Please fill in store, date, and a valid total.');
        return;
      }
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      try {
        await saveReceiptEdits(receipt.id, updates);
        const updated = cache.receipts.find(r => r.id === receipt.id) || receipt;
        renderReceiptRow(tr, updated, false);
      } catch (e) {
        alert('Update failed: ' + e.message);
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
      }
    });
    saveTd.appendChild(saveBtn);

    const cancelTd = document.createElement('td');
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'delete-btn';
    cancelBtn.title = 'Cancel';
    cancelBtn.textContent = '✕';
    cancelBtn.addEventListener('click', () => renderReceiptRow(tr, receipt, false));
    cancelTd.appendChild(cancelBtn);

    [dateTd, storeTd, totalTd, catTd, saveTd, cancelTd].forEach(td => tr.appendChild(td));
    storeInput.focus();
    return;
  }

  const dateTd = document.createElement('td');
  dateTd.textContent = receipt.date;

  const storeTd = document.createElement('td');
  storeTd.textContent = receipt.store;

  const totalTd = document.createElement('td');
  totalTd.textContent = fmt(receipt.total);

  const catTd = document.createElement('td');
  catTd.appendChild(makeCategorySelect(receipt.category, val => {
    updateReceiptCategory(receipt.id, val);
  }));

  const actionsTd = document.createElement('td');
  actionsTd.className = 'row-actions';
  const editBtn = document.createElement('button');
  editBtn.className = 'expand-btn';
  editBtn.textContent = 'Edit';
  editBtn.addEventListener('click', () => {
    const existing = document.getElementById(`items-row-${receipt.id}`);
    if (existing) existing.remove();
    renderReceiptRow(tr, receipt, true);
  });
  const expandBtn = document.createElement('button');
  expandBtn.className = 'expand-btn';
  expandBtn.textContent = 'Items';
  expandBtn.addEventListener('click', () => toggleItems(expandBtn, receipt.id, tr));
  actionsTd.appendChild(editBtn);
  actionsTd.appendChild(expandBtn);

  const deleteTd = document.createElement('td');
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'delete-btn';
  deleteBtn.title = 'Delete receipt';
  deleteBtn.textContent = '✕';
  deleteBtn.addEventListener('click', () => deleteReceipt(receipt.id, tr));
  deleteTd.appendChild(deleteBtn);

  [dateTd, storeTd, totalTd, catTd, actionsTd, deleteTd].forEach(td => tr.appendChild(td));
}

async function saveReceiptEdits(receiptId, updates) {
  await apiPost({ action: 'update_receipt', id: receiptId, updates });
  if (cache) {
    const r = cache.receipts.find(r => r.id === receiptId);
    if (r) Object.assign(r, updates);
  }
}

async function updateReceiptCategory(receiptId, category) {
  try {
    await apiPost({ action: 'update_receipt', id: receiptId, category });
    if (cache) {
      const r = cache.receipts.find(r => r.id === receiptId);
      if (r) r.category = category;
    }
  } catch (e) {
    alert('Update failed: ' + e.message);
  }
}

async function updateItemCategory(itemId, category) {
  try {
    await apiPost({ action: 'update_item', id: itemId, category });
    if (cache) {
      const it = cache.items.find(i => i.id === itemId);
      if (it) it.category = category;
    }
  } catch (e) {
    alert('Update failed: ' + e.message);
  }
}

function toggleItems(btn, receiptId, parentRow) {
  const existing = document.getElementById(`items-row-${receiptId}`);
  if (existing) {
    existing.remove();
    btn.textContent = 'Items';
    return;
  }

  const receiptItems = (cache?.items || []).filter(i => i.receipt_id === receiptId);
  btn.textContent = 'Hide';

  const itemsRow = document.createElement('tr');
  itemsRow.id = `items-row-${receiptId}`;
  itemsRow.className = 'items-detail-row';

  const td = document.createElement('td');
  td.colSpan = 6;

  if (receiptItems.length === 0) {
    const p = document.createElement('p');
    p.className = 'no-items';
    p.textContent = 'No line items on this receipt.';
    td.appendChild(p);
  } else {
    const tbl = document.createElement('table');
    tbl.className = 'items-table nested';
    tbl.innerHTML = `
      <thead>
        <tr>
          <th>Description</th>
          <th>Qty</th>
          <th>Unit Price</th>
          <th>Total</th>
          <th>Category</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
    const itbody = tbl.querySelector('tbody');
    receiptItems.forEach(item => {
      const itr = document.createElement('tr');
      itr.innerHTML = `
        <td>${item.description || '—'}</td>
        <td>${item.quantity !== '' ? item.quantity : '—'}</td>
        <td>${item.unit_price !== '' ? fmt(item.unit_price) : '—'}</td>
        <td>${item.total_price !== '' ? fmt(item.total_price) : '—'}</td>
        <td></td>
      `;
      itr.querySelector('td:last-child').appendChild(
        makeCategorySelect(item.category, val => updateItemCategory(item.id, val))
      );
      itbody.appendChild(itr);
    });
    td.appendChild(tbl);
  }

  itemsRow.appendChild(td);
  parentRow.insertAdjacentElement('afterend', itemsRow);
}

async function deleteReceipt(receiptId, row) {
  if (!confirm('Delete this receipt?')) return;
  try {
    await apiPost({ action: 'delete_receipt', id: receiptId });
    if (cache) {
      cache.receipts = cache.receipts.filter(r => r.id !== receiptId);
      cache.items = cache.items.filter(i => i.receipt_id !== receiptId);
    }
    document.getElementById(`items-row-${receiptId}`)?.remove();
    row.remove();
    if (cache && cache.receipts.length === 0) {
      document.getElementById('receipts-container').innerHTML =
        '<p class="empty-state">No receipts yet. Add one to get started.</p>';
    }
  } catch (e) {
    alert('Delete failed: ' + e.message);
  }
}

async function confirmClearAll() {
  if (!confirm('Permanently delete ALL receipts and items from your Google Sheet? This cannot be undone.')) return;
  try {
    await apiPost({ action: 'clear' });
    cache = { receipts: [], items: [] };
    showDataStatus('All data cleared.');
  } catch (e) {
    showDataStatus('Clear failed: ' + e.message, true);
  }
}

// ── Budgets Tab ────────────────────────────────────────────

async function loadBudgets() {
  try {
    await getData();
  } catch (e) {
    return;
  }
  renderBudgetsList();
  renderCategoriesList();
  renderColorPicker();
}

function renderBudgetsList() {
  const container = document.getElementById('budgets-list');
  if (!container) return;
  container.innerHTML = '';
  const budgets = getBudgetMap();

  categories.forEach(cat => {
    const row = document.createElement('div');
    row.className = 'budget-row';

    const swatch = document.createElement('span');
    swatch.className = 'cat-swatch';
    swatch.style.background = cat.color;

    const name = document.createElement('span');
    name.className = 'budget-row-name';
    name.textContent = cat.name;

    const inputWrap = document.createElement('div');
    inputWrap.className = 'budget-input-wrap';
    const dollar = document.createElement('span');
    dollar.className = 'budget-dollar';
    dollar.textContent = '$';
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.step = '0.01';
    input.placeholder = '0.00';
    input.className = 'budget-input';
    input.value = budgets[cat.id] != null ? budgets[cat.id] : '';
    input.addEventListener('change', () => saveBudget(cat.id, input.value, input));
    inputWrap.appendChild(dollar);
    inputWrap.appendChild(input);

    const status = document.createElement('span');
    status.className = 'budget-row-status';

    row.appendChild(swatch);
    row.appendChild(name);
    row.appendChild(inputWrap);
    row.appendChild(status);
    container.appendChild(row);
  });
}

async function saveBudget(categoryId, rawValue, inputEl) {
  const trimmed = String(rawValue).trim();
  const amount = trimmed === '' ? 0 : parseFloat(trimmed);
  if (isNaN(amount) || amount < 0) {
    inputEl.classList.add('invalid');
    return;
  }
  inputEl.classList.remove('invalid');
  const statusEl = inputEl.parentElement.nextElementSibling;
  if (statusEl) statusEl.textContent = 'Saving…';
  try {
    await apiPost({ action: 'set_budget', category_id: categoryId, amount });
    if (!cache.budgets) cache.budgets = [];
    const existing = cache.budgets.find(b => b.category_id === categoryId);
    if (amount > 0) {
      if (existing) existing.amount = amount;
      else cache.budgets.push({ category_id: categoryId, amount });
    } else if (existing) {
      cache.budgets = cache.budgets.filter(b => b.category_id !== categoryId);
    }
    if (statusEl) {
      statusEl.textContent = 'Saved';
      setTimeout(() => { if (statusEl.textContent === 'Saved') statusEl.textContent = ''; }, 1500);
    }
  } catch (e) {
    if (statusEl) statusEl.textContent = 'Failed';
    alert('Could not save budget: ' + e.message);
  }
}

function renderCategoriesList() {
  const container = document.getElementById('categories-list');
  if (!container) return;
  container.innerHTML = '';
  const customIds = new Set(((cache && cache.categories) || []).map(c => c.id));

  categories.forEach(cat => {
    const row = document.createElement('div');
    row.className = 'category-row';
    const swatch = document.createElement('span');
    swatch.className = 'cat-swatch';
    swatch.style.background = cat.color;
    const name = document.createElement('span');
    name.className = 'category-row-name';
    name.textContent = cat.name;
    const tag = document.createElement('span');
    tag.className = 'category-row-tag';
    tag.textContent = customIds.has(cat.id) ? 'Custom' : 'Built-in';
    row.appendChild(swatch);
    row.appendChild(name);
    row.appendChild(tag);
    if (customIds.has(cat.id)) {
      const del = document.createElement('button');
      del.className = 'delete-btn';
      del.title = 'Delete category';
      del.textContent = '✕';
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
  if (!name) {
    input.classList.add('invalid');
    return;
  }
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
    renderBudgetsList();
    renderCategoriesList();
    buildCategoryPills();
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
    renderBudgetsList();
    renderCategoriesList();
    buildCategoryPills();
  } catch (e) {
    alert('Delete failed: ' + e.message);
  }
}

// ── Dashboard: budgets vs spend ────────────────────────────

function currentMonthKey(d) {
  const dt = d ? new Date(d) : new Date();
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0');
}

function monthLabel() {
  return new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

function renderBudgetProgress(receipts) {
  const container = document.getElementById('budget-progress-list');
  const empty = document.getElementById('budget-empty');
  const subEl = document.getElementById('budget-card-sub');
  if (!container) return;
  container.innerHTML = '';

  const budgets = getBudgetMap();
  const budgetCats = Object.keys(budgets);

  if (subEl) subEl.textContent = monthLabel();

  if (budgetCats.length === 0) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  const thisMonth = currentMonthKey();
  const spend = {};
  receipts.forEach(r => {
    if (!r.date) return;
    if (currentMonthKey(r.date) !== thisMonth) return;
    const amt = parseFloat(r.total);
    if (isNaN(amt)) return;
    const cat = r.category || 'other';
    spend[cat] = (spend[cat] || 0) + amt;
  });

  budgetCats.forEach(catId => {
    const cat = categories.find(c => c.id === catId);
    if (!cat) return;
    const budget = budgets[catId];
    const used = spend[catId] || 0;
    const pct = budget > 0 ? Math.min(100, (used / budget) * 100) : 0;
    const overPct = budget > 0 ? (used / budget) * 100 : 0;
    const isOver = used > budget;

    const row = document.createElement('div');
    row.className = 'budget-progress-row' + (isOver ? ' over' : '');

    const top = document.createElement('div');
    top.className = 'budget-progress-top';
    top.innerHTML = `
      <span class="budget-progress-name">
        <span class="cat-swatch" style="background:${cat.color}"></span>${cat.name}
      </span>
      <span class="budget-progress-amounts">
        <strong>${fmt(used)}</strong> <span class="budget-of">of ${fmt(budget)}</span>
      </span>
    `;

    const barWrap = document.createElement('div');
    barWrap.className = 'budget-bar';
    const bar = document.createElement('div');
    bar.className = 'budget-bar-fill';
    bar.style.width = pct + '%';
    bar.style.background = isOver ? '#ef4444' : (overPct >= 80 ? '#f59e0b' : cat.color);
    barWrap.appendChild(bar);

    const foot = document.createElement('div');
    foot.className = 'budget-progress-foot';
    if (isOver) {
      foot.innerHTML = `<span class="budget-over-tag">Over by ${fmt(used - budget)}</span>`;
    } else {
      foot.innerHTML = `<span class="budget-remaining">${fmt(budget - used)} left</span> · <span class="budget-pct">${overPct.toFixed(0)}%</span>`;
    }

    row.appendChild(top);
    row.appendChild(barWrap);
    row.appendChild(foot);
    container.appendChild(row);
  });
}

function showDataStatus(msg, isError) {
  const el = document.getElementById('data-status');
  el.textContent = msg;
  el.classList.remove('hidden');
  el.classList.toggle('error', !!isError);
  setTimeout(() => el.classList.add('hidden'), 4000);
}

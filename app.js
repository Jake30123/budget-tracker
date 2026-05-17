// ── Config / State ─────────────────────────────────────────

const SCRIPT_URL_KEY = 'budget-tracker-script-url';

let scriptUrl = localStorage.getItem(SCRIPT_URL_KEY) || '';
let categories = CATEGORIES;
let cache = null;           // { receipts, items } from last fetch
let pendingFetch = null;    // dedupe concurrent reads
let categoryChart = null;
let groceryChart = null;
let itemCounter = 0;

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
    cache = data;
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
      };
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
    const tr = document.createElement('tr');

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

    const expandTd = document.createElement('td');
    const expandBtn = document.createElement('button');
    expandBtn.className = 'expand-btn';
    expandBtn.textContent = 'Items';
    expandBtn.addEventListener('click', () => toggleItems(expandBtn, receipt.id, tr));
    expandTd.appendChild(expandBtn);

    const deleteTd = document.createElement('td');
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.title = 'Delete receipt';
    deleteBtn.textContent = '✕';
    deleteBtn.addEventListener('click', () => deleteReceipt(receipt.id, tr));
    deleteTd.appendChild(deleteBtn);

    [dateTd, storeTd, totalTd, catTd, expandTd, deleteTd].forEach(td => tr.appendChild(td));
    tbody.appendChild(tr);
  });
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

function showDataStatus(msg, isError) {
  const el = document.getElementById('data-status');
  el.textContent = msg;
  el.classList.remove('hidden');
  el.classList.toggle('error', !!isError);
  setTimeout(() => el.classList.add('hidden'), 4000);
}

// ── Storage (localStorage-backed) ─────────────────────────

const STORAGE_KEY = 'budget-tracker-data-v1';

function loadStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { receipts: [], items: [] };
    const data = JSON.parse(raw);
    return {
      receipts: Array.isArray(data.receipts) ? data.receipts : [],
      items: Array.isArray(data.items) ? data.items : [],
    };
  } catch (e) {
    console.error('Failed to load store:', e);
    return { receipts: [], items: [] };
  }
}

function saveStore(store) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function uid() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '');
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ── Module State ──────────────────────────────────────────

let categories = CATEGORIES;
let categoryChart = null;
let groceryChart = null;
let itemCounter = 0;

document.addEventListener('DOMContentLoaded', () => {
  initForm();
});

// ── Navigation ────────────────────────────────────────────

function showTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.add('hidden'));
  document.getElementById(`tab-${name}`).classList.remove('hidden');
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === name);
  });
  if (name === 'dashboard') loadDashboard();
  if (name === 'receipts') loadReceipts();
}

// ── Utilities ─────────────────────────────────────────────

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

// ── Form Init ─────────────────────────────────────────────

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

// ── Form Items ────────────────────────────────────────────

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

// ── Form Submit ───────────────────────────────────────────

function submitForm(e) {
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

  const newItems = [];
  document.querySelectorAll('#form-items-body tr').forEach(tr => {
    const desc = tr.querySelector('.desc')?.value.trim() || '';
    const qty = parseFloat(tr.querySelector('.qty')?.value);
    const price = parseFloat(tr.querySelector('.price')?.value);
    if (desc || (qty > 0 && price > 0)) {
      newItems.push({
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

  const store = loadStore();
  store.receipts.push(receipt);
  store.items.push(...newItems);
  saveStore(store);

  showSuccess(receipt);
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

// ── Dashboard ─────────────────────────────────────────────

function computeDashboard() {
  const { receipts } = loadStore();
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
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  let running = 0;
  const groceryOverTime = [];
  groceryReceipts.forEach(r => {
    const amt = parseFloat(r.total);
    if (!isNaN(amt)) {
      running += amt;
      groceryOverTime.push({
        date: r.date,
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

function loadDashboard() {
  const data = computeDashboard();

  document.getElementById('stat-total-spend').textContent = fmt(data.total_spend);
  document.getElementById('stat-total-receipts').textContent = data.total_receipts;
  document.getElementById('stat-grocery-total').textContent = fmt(data.grocery_total);
  document.getElementById('stat-avg-grocery').textContent = fmt(data.avg_grocery_trip);
  document.getElementById('stat-grocery-trips').textContent = data.grocery_trips;

  renderCategoryChart(data.spend_by_category);
  renderGroceryChart(data.grocery_over_time);
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

// ── Receipts ──────────────────────────────────────────────

function loadReceipts() {
  const { receipts } = loadStore();
  const container = document.getElementById('receipts-container');
  container.innerHTML = '';

  if (receipts.length === 0) {
    container.innerHTML = '<p class="empty-state">No receipts yet. Add one to get started.</p>';
    return;
  }

  const sorted = [...receipts].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

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

function updateReceiptCategory(receiptId, category) {
  const store = loadStore();
  const r = store.receipts.find(r => r.id === receiptId);
  if (r) r.category = category;
  saveStore(store);
}

function updateItemCategory(itemId, category) {
  const store = loadStore();
  const it = store.items.find(i => i.id === itemId);
  if (it) it.category = category;
  saveStore(store);
}

function toggleItems(btn, receiptId, parentRow) {
  const existing = document.getElementById(`items-row-${receiptId}`);
  if (existing) {
    existing.remove();
    btn.textContent = 'Items';
    return;
  }

  const { items } = loadStore();
  const receiptItems = items.filter(i => i.receipt_id === receiptId);
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

function deleteReceipt(receiptId, row) {
  if (!confirm('Delete this receipt?')) return;
  const store = loadStore();
  store.receipts = store.receipts.filter(r => r.id !== receiptId);
  store.items = store.items.filter(i => i.receipt_id !== receiptId);
  saveStore(store);
  document.getElementById(`items-row-${receiptId}`)?.remove();
  row.remove();
  if (!store.receipts.length) {
    document.getElementById('receipts-container').innerHTML =
      '<p class="empty-state">No receipts yet. Add one to get started.</p>';
  }
}

// ── Data Import / Export ──────────────────────────────────

function exportData() {
  const store = loadStore();
  const blob = new Blob([JSON.stringify(store, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `budget-tracker-${todayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showDataStatus(`Exported ${store.receipts.length} receipts.`);
}

function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const parsed = JSON.parse(e.target.result);
      if (!parsed.receipts || !Array.isArray(parsed.receipts)) {
        showDataStatus('Invalid file: missing "receipts" array.', true);
        return;
      }
      const items = Array.isArray(parsed.items) ? parsed.items : [];
      if (!confirm(`Import ${parsed.receipts.length} receipts and ${items.length} items? This replaces current data.`)) {
        return;
      }
      saveStore({ receipts: parsed.receipts, items });
      showDataStatus(`Imported ${parsed.receipts.length} receipts.`);
    } catch (err) {
      showDataStatus('Could not parse JSON file.', true);
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

function clearAllData() {
  if (!confirm('Permanently delete ALL receipts and items? This cannot be undone.')) return;
  localStorage.removeItem(STORAGE_KEY);
  showDataStatus('All data cleared.');
}

function showDataStatus(msg, isError) {
  const el = document.getElementById('data-status');
  el.textContent = msg;
  el.classList.remove('hidden');
  el.classList.toggle('error', !!isError);
  setTimeout(() => el.classList.add('hidden'), 4000);
}

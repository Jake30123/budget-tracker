/**
 * Budget Tracker — Google Sheets backend
 *
 * Setup:
 *   1. Create a new Google Sheet.
 *   2. Extensions → Apps Script. Replace the default code with this file.
 *   3. Click Deploy → New deployment → Type "Web app".
 *   4. Set "Execute as: Me" and "Who has access: Anyone".
 *   5. Click Deploy and copy the Web app URL.
 *   6. Paste the URL into the Budget Tracker Settings page.
 */

const RECEIPT_HEADERS = ['id', 'date', 'store', 'total', 'uploaded_at', 'category'];
const ITEM_HEADERS = ['id', 'receipt_id', 'description', 'quantity', 'unit_price', 'total_price', 'category'];
const BUDGET_HEADERS = ['category_id', 'amount'];
const CATEGORY_HEADERS = ['id', 'name', 'color'];
const INCOME_HEADERS = ['id', 'date', 'source', 'amount', 'uploaded_at'];
const SETTING_HEADERS = ['key', 'value'];
const MEAL_HEADERS = ['id', 'name', 'date', 'notes', 'category', 'uploaded_at'];
const MEAL_ALLOC_HEADERS = ['id', 'meal_id', 'item_id', 'portion', 'notes'];

function getSheet(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
  } else if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
    sh.setFrozenRows(1);
  }
  return sh;
}

function sheetToObjects(sh, headers, keyField) {
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  const data = sh.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const key = keyField || 'id';
  return data.map(row => {
    const obj = {};
    headers.forEach((h, i) => {
      let v = row[i];
      if (v instanceof Date) {
        v = Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      }
      obj[h] = v === '' ? '' : v;
    });
    return obj;
  }).filter(o => o[key] !== '' && o[key] != null);
}

function readAll() {
  return {
    receipts: sheetToObjects(getSheet('Receipts', RECEIPT_HEADERS), RECEIPT_HEADERS),
    items: sheetToObjects(getSheet('Items', ITEM_HEADERS), ITEM_HEADERS),
    budgets: sheetToObjects(getSheet('Budgets', BUDGET_HEADERS), BUDGET_HEADERS, 'category_id'),
    categories: sheetToObjects(getSheet('Categories', CATEGORY_HEADERS), CATEGORY_HEADERS),
    income: sheetToObjects(getSheet('Income', INCOME_HEADERS), INCOME_HEADERS),
    settings: sheetToObjects(getSheet('Settings', SETTING_HEADERS), SETTING_HEADERS, 'key'),
    meals: sheetToObjects(getSheet('Meals', MEAL_HEADERS), MEAL_HEADERS),
    meal_allocations: sheetToObjects(getSheet('MealAllocations', MEAL_ALLOC_HEADERS), MEAL_ALLOC_HEADERS),
  };
}

function appendMeal(meal) {
  const sh = getSheet('Meals', MEAL_HEADERS);
  sh.appendRow(MEAL_HEADERS.map(h => meal[h] != null ? meal[h] : ''));
}

function deleteMealCascade(mealId) {
  const mealsSheet = getSheet('Meals', MEAL_HEADERS);
  const mRow = findRow(mealsSheet, MEAL_HEADERS.indexOf('id'), mealId);
  if (mRow > 0) mealsSheet.deleteRow(mRow);

  const allocSheet = getSheet('MealAllocations', MEAL_ALLOC_HEADERS);
  const lastRow = allocSheet.getLastRow();
  if (lastRow < 2) return;
  const mealCol = MEAL_ALLOC_HEADERS.indexOf('meal_id') + 1;
  const refs = allocSheet.getRange(2, mealCol, lastRow - 1, 1).getValues();
  for (let i = refs.length - 1; i >= 0; i--) {
    if (refs[i][0] === mealId) allocSheet.deleteRow(i + 2);
  }
}

function setMealAllocation(allocation) {
  const sh = getSheet('MealAllocations', MEAL_ALLOC_HEADERS);
  const portion = Number(allocation.portion);
  if (!allocation.id || !allocation.meal_id || !allocation.item_id) {
    throw new Error('Allocation requires id, meal_id, item_id');
  }
  const row = findRow(sh, MEAL_ALLOC_HEADERS.indexOf('id'), allocation.id);
  if (!isFinite(portion) || portion <= 0) {
    if (row > 0) sh.deleteRow(row);
    return;
  }
  if (row > 0) {
    MEAL_ALLOC_HEADERS.forEach((h, i) => {
      sh.getRange(row, i + 1).setValue(allocation[h] != null ? allocation[h] : '');
    });
  } else {
    sh.appendRow(MEAL_ALLOC_HEADERS.map(h => allocation[h] != null ? allocation[h] : ''));
  }
}

function deleteMealAllocation(id) {
  const sh = getSheet('MealAllocations', MEAL_ALLOC_HEADERS);
  const row = findRow(sh, MEAL_ALLOC_HEADERS.indexOf('id'), id);
  if (row > 0) sh.deleteRow(row);
}

function appendIncome(entry) {
  const sh = getSheet('Income', INCOME_HEADERS);
  sh.appendRow(INCOME_HEADERS.map(h => entry[h] != null ? entry[h] : ''));
}

function deleteIncome(id) {
  const sh = getSheet('Income', INCOME_HEADERS);
  const row = findRow(sh, INCOME_HEADERS.indexOf('id'), id);
  if (row > 0) sh.deleteRow(row);
}

function setSetting(key, value) {
  const sh = getSheet('Settings', SETTING_HEADERS);
  const row = findRow(sh, SETTING_HEADERS.indexOf('key'), key);
  if (value == null || value === '') {
    if (row > 0) sh.deleteRow(row);
    return;
  }
  if (row > 0) {
    sh.getRange(row, SETTING_HEADERS.indexOf('value') + 1).setValue(value);
  } else {
    sh.appendRow([key, value]);
  }
}

function appendReceipt(receipt, items) {
  const receiptsSheet = getSheet('Receipts', RECEIPT_HEADERS);
  const itemsSheet = getSheet('Items', ITEM_HEADERS);
  receiptsSheet.appendRow(RECEIPT_HEADERS.map(h => receipt[h] != null ? receipt[h] : ''));
  if (items && items.length) {
    const rows = items.map(it => ITEM_HEADERS.map(h => it[h] != null ? it[h] : ''));
    itemsSheet.getRange(itemsSheet.getLastRow() + 1, 1, rows.length, ITEM_HEADERS.length).setValues(rows);
  }
}

function findRow(sh, idCol, id) {
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return -1;
  const ids = sh.getRange(2, idCol + 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === id) return i + 2;
  }
  return -1;
}

function updateRow(sheetName, headers, id, updates) {
  const sh = getSheet(sheetName, headers);
  const idCol = headers.indexOf('id');
  const row = findRow(sh, idCol, id);
  if (row < 0) return false;
  Object.keys(updates).forEach(key => {
    const col = headers.indexOf(key);
    if (col >= 0) sh.getRange(row, col + 1).setValue(updates[key]);
  });
  return true;
}

function deleteReceiptCascade(receiptId) {
  const receiptsSheet = getSheet('Receipts', RECEIPT_HEADERS);
  const rRow = findRow(receiptsSheet, RECEIPT_HEADERS.indexOf('id'), receiptId);
  if (rRow > 0) receiptsSheet.deleteRow(rRow);

  const itemsSheet = getSheet('Items', ITEM_HEADERS);
  const lastRow = itemsSheet.getLastRow();
  if (lastRow < 2) return;
  const receiptCol = ITEM_HEADERS.indexOf('receipt_id') + 1;
  const refs = itemsSheet.getRange(2, receiptCol, lastRow - 1, 1).getValues();
  for (let i = refs.length - 1; i >= 0; i--) {
    if (refs[i][0] === receiptId) itemsSheet.deleteRow(i + 2);
  }
}

function clearAll() {
  const receiptsSheet = getSheet('Receipts', RECEIPT_HEADERS);
  const itemsSheet = getSheet('Items', ITEM_HEADERS);
  receiptsSheet.clear();
  itemsSheet.clear();
  receiptsSheet.appendRow(RECEIPT_HEADERS);
  itemsSheet.appendRow(ITEM_HEADERS);
  receiptsSheet.setFrozenRows(1);
  itemsSheet.setFrozenRows(1);
}

function setBudget(categoryId, amount) {
  const sh = getSheet('Budgets', BUDGET_HEADERS);
  const idCol = BUDGET_HEADERS.indexOf('category_id');
  const row = findRow(sh, idCol, categoryId);
  if (amount == null || amount === '' || Number(amount) <= 0) {
    if (row > 0) sh.deleteRow(row);
    return;
  }
  const amt = Number(amount);
  if (row > 0) {
    sh.getRange(row, BUDGET_HEADERS.indexOf('amount') + 1).setValue(amt);
  } else {
    sh.appendRow([categoryId, amt]);
  }
}

function addCategory(category) {
  const sh = getSheet('Categories', CATEGORY_HEADERS);
  const idCol = CATEGORY_HEADERS.indexOf('id');
  if (findRow(sh, idCol, category.id) > 0) {
    throw new Error('Category already exists: ' + category.id);
  }
  sh.appendRow(CATEGORY_HEADERS.map(h => category[h] != null ? category[h] : ''));
}

function deleteCategory(categoryId) {
  const sh = getSheet('Categories', CATEGORY_HEADERS);
  const idCol = CATEGORY_HEADERS.indexOf('id');
  const row = findRow(sh, idCol, categoryId);
  if (row > 0) sh.deleteRow(row);

  const budgetsSheet = getSheet('Budgets', BUDGET_HEADERS);
  const bRow = findRow(budgetsSheet, BUDGET_HEADERS.indexOf('category_id'), categoryId);
  if (bRow > 0) budgetsSheet.deleteRow(bRow);

  reassignCategory(getSheet('Receipts', RECEIPT_HEADERS), RECEIPT_HEADERS, categoryId, 'other');
  reassignCategory(getSheet('Items', ITEM_HEADERS), ITEM_HEADERS, categoryId, 'other');
}

function reassignCategory(sh, headers, oldId, newId) {
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return;
  const catCol = headers.indexOf('category');
  if (catCol < 0) return;
  const range = sh.getRange(2, catCol + 1, lastRow - 1, 1);
  const values = range.getValues();
  let changed = false;
  for (let i = 0; i < values.length; i++) {
    if (values[i][0] === oldId) { values[i][0] = newId; changed = true; }
  }
  if (changed) range.setValues(values);
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  try {
    return json(readAll());
  } catch (err) {
    return json({ error: String(err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    switch (body.action) {
      case 'add_receipt':
        appendReceipt(body.receipt, body.items || []);
        return json({ ok: true });
      case 'update_receipt':
        updateRow('Receipts', RECEIPT_HEADERS, body.id, body.updates || { category: body.category });
        return json({ ok: true });
      case 'update_item':
        updateRow('Items', ITEM_HEADERS, body.id, { category: body.category });
        return json({ ok: true });
      case 'delete_receipt':
        deleteReceiptCascade(body.id);
        return json({ ok: true });
      case 'clear':
        clearAll();
        return json({ ok: true });
      case 'set_budget':
        setBudget(body.category_id, body.amount);
        return json({ ok: true });
      case 'add_category':
        addCategory(body.category);
        return json({ ok: true });
      case 'delete_category':
        deleteCategory(body.id);
        return json({ ok: true });
      case 'add_income':
        appendIncome(body.income);
        return json({ ok: true });
      case 'update_income':
        updateRow('Income', INCOME_HEADERS, body.id, body.updates || {});
        return json({ ok: true });
      case 'delete_income':
        deleteIncome(body.id);
        return json({ ok: true });
      case 'set_setting':
        setSetting(body.key, body.value);
        return json({ ok: true });
      case 'add_meal':
        appendMeal(body.meal);
        return json({ ok: true });
      case 'update_meal':
        updateRow('Meals', MEAL_HEADERS, body.id, body.updates || {});
        return json({ ok: true });
      case 'delete_meal':
        deleteMealCascade(body.id);
        return json({ ok: true });
      case 'set_meal_allocation':
        setMealAllocation(body.allocation);
        return json({ ok: true });
      case 'delete_meal_allocation':
        deleteMealAllocation(body.id);
        return json({ ok: true });
      default:
        return json({ error: 'Unknown action: ' + body.action });
    }
  } catch (err) {
    return json({ error: String(err) });
  }
}

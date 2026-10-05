/**
 * Spendings — Google Sheet backend.
 *
 * Paste this whole file into Extensions → Apps Script of your (empty) Google Sheet,
 * run `setup` once, then Deploy → New deployment → Web app
 * (Execute as: Me, Who has access: Anyone). See SETUP.md for the full walkthrough.
 *
 * Tabs it manages:
 *   Ledger     — every entry, one row each. The source of truth. Edit with care.
 *   Overview   — one row per pay cycle: money in, money out, net, allowance left.
 *   Settings   — allowance, cycle start day, USD rate, Wallet card-name mapping.
 *   Merchants  — remembered merchant → category pairs (auto-categorises Apple Pay).
 *   "Oct 2026" — one tab per pay cycle (27th → 26th), named after the month it ends in.
 */

var TZ = 'Asia/Dubai';
var LEDGER = 'Ledger';
var OVERVIEW = 'Overview';
var SETTINGS = 'Settings';
var MERCHANTS = 'Merchants';

var COLS = ['ID', 'Date', 'Cycle', 'Type', 'Amount', 'Currency', 'Amount (AED)', 'Account',
  'To account', 'Category', 'Merchant', 'Note', 'Source', 'Status', 'Created', 'Updated'];
var C = {}; COLS.forEach(function (n, i) { C[n] = i; });

var TYPES = ['Spend', 'Income', 'Transfer'];
var ACCOUNTS = ['ADIB', 'ADCB', 'BOTIM', 'Cash'];
var SPEND_CATEGORIES = ['Food & Drinks', 'Groceries', 'Transport & Fuel', 'Shopping',
  'Bills & Subscriptions', 'Entertainment', 'Health', 'Family & Gifts', 'Travel', 'Other'];
var INCOME_CATEGORIES = ['Salary', 'Allowance', 'Gift', 'Refund', 'Other'];

var DEFAULT_SETTINGS = [
  ['Allowance (AED per cycle)', 3000, 'How much of your own money you plan to spend each cycle.'],
  ['Allowance account', 'ADCB', 'Spending on this account counts against the allowance.'],
  ['Emergency account', 'ADIB', 'Spending here gets a gentle warning.'],
  ['Cycle start day', 27, 'Day of the month a new cycle starts (1–28).'],
  ['USD → AED rate', 3.6725, 'The AED is pegged to the USD.'],
];
var DEFAULT_CARD_MAP = [
  ['adib', 'ADIB'], ['adcb', 'ADCB'], ['botim', 'BOTIM'],
];

var INK = '#1d1d1f', MUTED = '#6e6e73', LINE = '#e5e5ea', TINT = '#0a7cff', SOFT = '#f2f2f7';

/* ───────────────────────── Menu & setup ───────────────────────── */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Spendings')
    .addItem('Set up / repair sheet', 'setup')
    .addItem('Show my app key', 'showToken')
    .addItem('Rebuild all cycle tabs', 'rebuildAllCycleTabs')
    .addItem('Make a new app key', 'rotateToken')
    .addToUi();
}

/** Run once. Safe to run again: it only adds what is missing. */
function setup() {
  var ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetTimeZone(TZ);
  ss.setSpreadsheetLocale('en_GB');

  var ledger = ensureSheet_(LEDGER);
  if (ledger.getLastRow() === 0) ledger.appendRow(COLS);
  styleHeader_(ledger, COLS.length);
  ledger.setFrozenRows(1);
  ledger.getRange('B:B').setNumberFormat('yyyy-mm-dd hh:mm');
  ledger.getRange('O:P').setNumberFormat('yyyy-mm-dd hh:mm');
  ledger.getRange('E:E').setNumberFormat('#,##0.00');
  ledger.getRange('G:G').setNumberFormat('"AED "#,##0.00');
  ledger.getRange('C:C').setNumberFormat('@');
  ledger.setColumnWidths(1, COLS.length, 110);
  ledger.setColumnWidth(C['ID'] + 1, 90);
  ledger.setColumnWidth(C['Merchant'] + 1, 170);
  ledger.setColumnWidth(C['Note'] + 1, 220);
  addValidation_(ledger, C['Type'], TYPES);
  addValidation_(ledger, C['Account'], ACCOUNTS);
  addValidation_(ledger, C['Status'], ['OK', 'Review']);

  var settings = ensureSheet_(SETTINGS);
  if (settings.getLastRow() === 0) {
    settings.getRange(1, 1, 1, 3).setValues([['Setting', 'Value', 'Notes']]);
    settings.getRange(2, 1, DEFAULT_SETTINGS.length, 3).setValues(DEFAULT_SETTINGS);
    var mapRow = DEFAULT_SETTINGS.length + 4;
    settings.getRange(mapRow - 1, 1, 1, 3).setValues([['Wallet card name contains', 'Account', 'Add a row if Apple Wallet calls a card something else.']]);
    settings.getRange(mapRow, 1, DEFAULT_CARD_MAP.length, 2).setValues(DEFAULT_CARD_MAP);
    styleHeader_(settings, 3);
    settings.getRange(mapRow - 1, 1, 1, 3).setFontWeight('bold').setBackground(SOFT);
    settings.setColumnWidth(1, 230); settings.setColumnWidth(2, 120); settings.setColumnWidth(3, 380);
  }

  var merchants = ensureSheet_(MERCHANTS);
  if (merchants.getLastRow() === 0) {
    merchants.appendRow(['Merchant', 'Category', 'Times used', 'Last used']);
    styleHeader_(merchants, 4);
    merchants.setColumnWidth(1, 220); merchants.setColumnWidth(2, 170);
    merchants.getRange('D:D').setNumberFormat('yyyy-mm-dd');
  }

  ensureOverview_();
  ensureCycleTab_(cycleOf_(new Date(), getSettings_().cycleStart));

  var sheet1 = ss.getSheetByName('Sheet1');
  if (sheet1 && sheet1.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sheet1);
  ss.setActiveSheet(ss.getSheetByName(OVERVIEW));
  ss.moveActiveSheet(1);

  var token = getToken_();
  try {
    SpreadsheetApp.getUi().alert('Spendings is set up ✓',
      'Your app key is:\n\n' + token + '\n\nNext: Deploy → New deployment → Web app ' +
      '(Execute as: Me · Who has access: Anyone), then paste the Web app URL and this key into the app’s Settings.',
      SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) { Logger.log('App key: ' + token); }
}

function showToken() {
  SpreadsheetApp.getUi().alert('Your app key', getToken_(), SpreadsheetApp.getUi().ButtonSet.OK);
}

function rotateToken() {
  PropertiesService.getScriptProperties().deleteProperty('TOKEN');
  SpreadsheetApp.getUi().alert('New app key', getToken_() +
    '\n\nUpdate it in the app’s Settings and in your Apple Pay Shortcut.', SpreadsheetApp.getUi().ButtonSet.OK);
}

function getToken_() {
  var props = PropertiesService.getScriptProperties();
  var t = props.getProperty('TOKEN');
  if (!t) {
    t = Utilities.getUuid().replace(/-/g, '').slice(0, 24);
    props.setProperty('TOKEN', t);
  }
  return t;
}

/* ───────────────────────── Web endpoints ───────────────────────── */

function doGet() {
  return json_({ ok: true, app: 'spendings', hint: 'POST JSON with your app key.' });
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'Could not read the request.' });
  }
  if (!body.token || String(body.token).trim() !== getToken_()) {
    return json_({ ok: false, error: 'Wrong app key. Copy it again from the sheet: Spendings → Show my app key.' });
  }
  var action = body.action || (body.source === 'applepay' ? 'applepay' : 'add');
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return json_({ ok: false, error: 'The sheet is busy. Try again in a moment.' });
  }
  try {
    switch (action) {
      case 'ping': return json_({ ok: true, message: 'Connected to ' + SpreadsheetApp.getActive().getName() });
      case 'list': return json_(listAll_());
      case 'applepay': return json_(addApplePay_(body));
      case 'add': return json_(addEntries_(body.entries || [body.entry || body]));
      case 'update': return json_(updateEntry_(body.id, body.fields || {}));
      case 'delete': return json_(deleteEntry_(body.id));
      case 'settings': return json_(saveSettings_(body.settings || {}));
      default: return json_({ ok: false, error: 'Unknown action: ' + action });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ───────────────────────── Actions ───────────────────────── */

/** Called by the Apple Pay Shortcut. Fields: amount (text like "AED 42.00"), merchant, card, category?, note? */
function addApplePay_(body) {
  var s = getSettings_();
  var money = parseMoney_(body.amount);
  var account = mapCard_(body.card, s.cardMap);
  var merchant = clean_(body.merchant);
  var category = clean_(body.category);
  if (!category || /later|skip|review/i.test(category)) category = '';
  if (category && SPEND_CATEGORIES.indexOf(category) < 0) category = matchCategory_(category) || '';
  var remembered = '';
  if (!category && merchant) remembered = category = rememberedCategory_(merchant);

  var date = new Date();
  var entry = {
    id: 'ap-' + hash_([money.amount, money.currency, merchant, account.name, Utilities.formatDate(date, TZ, 'yyyyMMddHHmm')].join('|')),
    date: date.toISOString(),
    type: 'Spend',
    amount: money.amount,
    currency: money.currency,
    account: account.name,
    category: category,
    merchant: merchant,
    note: clean_(body.note),
    source: 'Apple Pay',
  };
  var problems = [];
  if (!(money.amount > 0)) problems.push('amount');
  if (!account.known) problems.push('card');
  if (!category) problems.push('category');
  if (money.currency !== 'AED' && money.currency !== 'USD') problems.push('currency');
  entry.status = problems.length ? 'Review' : 'OK';

  var res = addEntries_([entry]);
  var saved = res.entries[0];
  var cyc = cycleSummary_(saved.cycle);
  var msg = fmtMoney_(entry.amount, entry.currency) + (merchant ? ' · ' + merchant : '') + ' · ' + account.name;
  if (remembered) msg += ' · ' + remembered;
  if (account.name === s.allowanceAccount) {
    msg += '\n' + fmtMoney_(Math.max(0, cyc.allowanceLeft), 'AED') + ' left of your allowance';
  } else if (account.name === s.emergencyAccount) {
    msg += '\n' + s.emergencyAccount + ' is your emergency card — ' + fmtMoney_(cyc.byAccount[s.emergencyAccount] || 0, 'AED') + ' used this cycle';
  }
  if (problems.indexOf('category') >= 0) msg += '\nAdded to Needs review';
  if (res.duplicates) msg = 'Already logged · ' + msg;
  return { ok: true, message: msg, entry: saved, duplicate: !!res.duplicates };
}

function addEntries_(list) {
  var s = getSettings_();
  var sh = SpreadsheetApp.getActive().getSheetByName(LEDGER);
  var existing = idIndex_(sh);
  var now = new Date();
  var rows = [], out = [], dupes = 0, touched = {};
  list.forEach(function (raw) {
    var e = normalise_(raw, s);
    if (existing[e.id] || touched['id:' + e.id]) { dupes++; out.push(e); return; }
    touched['id:' + e.id] = true;
    rows.push(toRow_(e, now, now));
    out.push(e);
    touched[e.cycle] = true;
    if (e.merchant && e.category && e.type === 'Spend') rememberMerchant_(e.merchant, e.category);
  });
  if (rows.length) {
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, COLS.length).setValues(rows);
  }
  Object.keys(touched).forEach(function (k) { if (/^\d{4}-\d{2}$/.test(k)) ensureCycleTab_(k); });
  return { ok: true, entries: out, added: rows.length, duplicates: dupes };
}

function updateEntry_(id, fields) {
  var sh = SpreadsheetApp.getActive().getSheetByName(LEDGER);
  var row = idIndex_(sh)[id];
  if (!row) return { ok: false, error: 'That entry is no longer in the sheet.' };
  var s = getSettings_();
  var current = fromRow_(sh.getRange(row, 1, 1, COLS.length).getValues()[0]);
  var merged = {};
  Object.keys(current).forEach(function (k) { merged[k] = current[k]; });
  Object.keys(fields).forEach(function (k) { if (k !== 'id') merged[k] = fields[k]; });
  if (!('status' in fields)) delete merged.status;
  var e = normalise_(merged, s);
  e.id = id;
  var created = sh.getRange(row, C['Created'] + 1).getValue() || new Date();
  sh.getRange(row, 1, 1, COLS.length).setValues([toRow_(e, created, new Date())]);
  if (e.merchant && e.category && e.type === 'Spend') rememberMerchant_(e.merchant, e.category);
  ensureCycleTab_(e.cycle);
  return { ok: true, entry: e };
}

function deleteEntry_(id) {
  var sh = SpreadsheetApp.getActive().getSheetByName(LEDGER);
  var row = idIndex_(sh)[id];
  if (!row) return { ok: true, deleted: false };
  sh.deleteRow(row);
  return { ok: true, deleted: true };
}

function listAll_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(LEDGER);
  var n = sh.getLastRow() - 1;
  var entries = n > 0 ? sh.getRange(2, 1, n, COLS.length).getValues().filter(function (r) { return r[0]; }).map(fromRow_) : [];
  var s = getSettings_();
  return {
    ok: true,
    entries: entries,
    settings: {
      allowance: s.allowance, allowanceAccount: s.allowanceAccount, emergencyAccount: s.emergencyAccount,
      cycleStart: s.cycleStart, usdRate: s.usdRate,
    },
    merchants: merchantMap_(),
    sheetName: SpreadsheetApp.getActive().getName(),
    sheetUrl: SpreadsheetApp.getActive().getUrl(),
  };
}

function saveSettings_(patch) {
  var sh = SpreadsheetApp.getActive().getSheetByName(SETTINGS);
  var labels = { allowance: 0, allowanceAccount: 1, emergencyAccount: 2, cycleStart: 3, usdRate: 4 };
  Object.keys(patch).forEach(function (k) {
    if (!(k in labels)) return;
    var v = patch[k];
    if (k === 'cycleStart') v = Math.min(28, Math.max(1, parseInt(v, 10) || 1));
    if (k === 'allowance' || k === 'usdRate') v = Number(v) || DEFAULT_SETTINGS[labels[k]][1];
    if (/Account$/.test(k) && ACCOUNTS.indexOf(v) < 0) return;
    sh.getRange(labels[k] + 2, 2).setValue(v);
  });
  return { ok: true, settings: listAll_().settings };
}

/* ───────────────────────── Rows ───────────────────────── */

function normalise_(raw, s) {
  var type = TYPES.indexOf(raw.type) >= 0 ? raw.type : 'Spend';
  var currency = String(raw.currency || 'AED').toUpperCase().trim().slice(0, 3) || 'AED';
  var amount = Math.round(Math.abs(Number(raw.amount) || 0) * 100) / 100;
  var date = raw.date ? new Date(raw.date) : new Date();
  if (isNaN(date.getTime())) date = new Date();
  var aed = currency === 'AED' ? amount : currency === 'USD' ? Math.round(amount * s.usdRate * 100) / 100 : '';
  var account = ACCOUNTS.indexOf(raw.account) >= 0 ? raw.account : clean_(raw.account) || 'Cash';
  var toAccount = type === 'Transfer' ? (ACCOUNTS.indexOf(raw.toAccount) >= 0 ? raw.toAccount : '') : '';
  var category = type === 'Transfer' ? '' : clean_(raw.category);
  var status = raw.status === 'Review' || raw.status === 'OK' ? raw.status
    : (type !== 'Transfer' && !category) || !(amount > 0) ? 'Review' : 'OK';
  return {
    id: clean_(raw.id) || 'x-' + Utilities.getUuid().slice(0, 13),
    date: date.toISOString(),
    cycle: cycleOf_(date, s.cycleStart),
    type: type,
    amount: amount,
    currency: currency,
    amountAED: aed,
    account: account,
    toAccount: toAccount,
    category: category,
    merchant: clean_(raw.merchant),
    note: clean_(raw.note),
    source: clean_(raw.source) || 'App',
    status: status,
  };
}

function toRow_(e, created, updated) {
  return [e.id, new Date(e.date), e.cycle, e.type, e.amount, e.currency, e.amountAED, e.account,
    e.toAccount, e.category, e.merchant, e.note, e.source, e.status, created, updated];
}

function fromRow_(r) {
  var d = r[C['Date']];
  return {
    id: String(r[C['ID']]),
    date: d instanceof Date ? d.toISOString() : String(d),
    cycle: String(r[C['Cycle']]),
    type: String(r[C['Type']]),
    amount: Number(r[C['Amount']]) || 0,
    currency: String(r[C['Currency']] || 'AED'),
    amountAED: r[C['Amount (AED)']] === '' ? null : Number(r[C['Amount (AED)']]),
    account: String(r[C['Account']]),
    toAccount: String(r[C['To account']] || ''),
    category: String(r[C['Category']] || ''),
    merchant: String(r[C['Merchant']] || ''),
    note: String(r[C['Note']] || ''),
    source: String(r[C['Source']] || ''),
    status: String(r[C['Status']] || 'OK'),
  };
}

function idIndex_(sh) {
  var n = sh.getLastRow() - 1, map = {};
  if (n <= 0) return map;
  sh.getRange(2, 1, n, 1).getValues().forEach(function (r, i) { if (r[0]) map[String(r[0])] = i + 2; });
  return map;
}

/* ───────────────────────── Settings & merchants ───────────────────────── */

function getSettings_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SETTINGS);
  var vals = sh ? sh.getDataRange().getValues() : [];
  function v(i, d) { return vals[i + 1] && vals[i + 1][1] !== '' ? vals[i + 1][1] : d; }
  var cardMap = [];
  for (var r = DEFAULT_SETTINGS.length + 3; r < vals.length; r++) {
    if (vals[r][0] && vals[r][1]) cardMap.push([String(vals[r][0]).toLowerCase(), String(vals[r][1])]);
  }
  if (!cardMap.length) cardMap = DEFAULT_CARD_MAP;
  return {
    allowance: Number(v(0, 3000)) || 0,
    allowanceAccount: String(v(1, 'ADCB')),
    emergencyAccount: String(v(2, 'ADIB')),
    cycleStart: Math.min(28, Math.max(1, parseInt(v(3, 27), 10) || 1)),
    usdRate: Number(v(4, 3.6725)) || 3.6725,
    cardMap: cardMap,
  };
}

function mapCard_(card, cardMap) {
  var c = String(card || '').toLowerCase();
  for (var i = 0; i < cardMap.length; i++) {
    if (cardMap[i][0] && c.indexOf(cardMap[i][0]) >= 0) return { name: cardMap[i][1], known: true };
  }
  return { name: clean_(card) || 'Unknown card', known: false };
}

function merchantKey_(m) { return String(m || '').toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, ' ').trim(); }

function rememberedCategory_(merchant) {
  var key = merchantKey_(merchant);
  var map = merchantMap_();
  return map[key] || '';
}

function merchantMap_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(MERCHANTS);
  var map = {};
  if (!sh || sh.getLastRow() < 2) return map;
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) { if (r[0]) map[merchantKey_(r[0])] = String(r[1]); });
  return map;
}

function rememberMerchant_(merchant, category) {
  var sh = SpreadsheetApp.getActive().getSheetByName(MERCHANTS);
  var key = merchantKey_(merchant);
  if (!key || !sh) return;
  var n = sh.getLastRow() - 1;
  var rows = n > 0 ? sh.getRange(2, 1, n, 3).getValues() : [];
  for (var i = 0; i < rows.length; i++) {
    if (merchantKey_(rows[i][0]) === key) {
      sh.getRange(i + 2, 2, 1, 3).setValues([[category, (Number(rows[i][2]) || 0) + 1, new Date()]]);
      return;
    }
  }
  sh.appendRow([clean_(merchant), category, 1, new Date()]);
}

function matchCategory_(text) {
  var t = String(text).toLowerCase();
  for (var i = 0; i < SPEND_CATEGORIES.length; i++) {
    var first = SPEND_CATEGORIES[i].toLowerCase().split(/[ &]/)[0];
    if (t.indexOf(first) >= 0) return SPEND_CATEGORIES[i];
  }
  return '';
}

/* ───────────────────────── Cycles ───────────────────────── */

var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10" for any date from 27 Sep 2026 to 26 Oct 2026 (with start day 27). */
function cycleOf_(date, startDay) {
  var p = Utilities.formatDate(date, TZ, 'yyyy-M-d').split('-').map(Number);
  var y = p[0], m = p[1], d = p[2];
  if (startDay > 1 && d >= startDay) { m += 1; if (m > 12) { m = 1; y += 1; } }
  return y + '-' + (m < 10 ? '0' : '') + m;
}

function cycleTabName_(cycle) {
  var p = cycle.split('-');
  return MONTHS[Number(p[1]) - 1] + ' ' + p[0];
}

function cycleRangeLabel_(cycle, startDay) {
  var p = cycle.split('-').map(Number);
  if (startDay <= 1) return '1 ' + MONTHS[p[1] - 1] + ' – end of ' + MONTHS[p[1] - 1] + ' ' + p[0];
  var pm = p[1] - 1, py = p[0];
  if (pm < 1) { pm = 12; py -= 1; }
  return startDay + ' ' + MONTHS[pm - 1] + ' ' + py + ' – ' + (startDay - 1) + ' ' + MONTHS[p[1] - 1] + ' ' + p[0];
}

function cycleSummary_(cycle) {
  var s = getSettings_();
  var sh = SpreadsheetApp.getActive().getSheetByName(LEDGER);
  var n = sh.getLastRow() - 1;
  var out = { spent: 0, income: 0, byAccount: {}, allowanceUsed: 0 };
  if (n > 0) {
    sh.getRange(2, 1, n, COLS.length).getValues().forEach(function (r) {
      if (String(r[C['Cycle']]) !== cycle) return;
      var aed = Number(r[C['Amount (AED)']]) || 0;
      if (r[C['Type']] === 'Spend') {
        out.spent += aed;
        out.byAccount[r[C['Account']]] = (out.byAccount[r[C['Account']]] || 0) + aed;
        if (r[C['Account']] === s.allowanceAccount) out.allowanceUsed += aed;
      } else if (r[C['Type']] === 'Income') out.income += aed;
    });
  }
  out.allowanceLeft = s.allowance - out.allowanceUsed;
  return out;
}

/* ───────────────────────── Generated tabs ───────────────────────── */

function rebuildAllCycleTabs() {
  var sh = SpreadsheetApp.getActive().getSheetByName(LEDGER);
  var n = sh.getLastRow() - 1, seen = {};
  if (n > 0) sh.getRange(2, C['Cycle'] + 1, n, 1).getValues().forEach(function (r) { if (r[0]) seen[r[0]] = true; });
  seen[cycleOf_(new Date(), getSettings_().cycleStart)] = true;
  Object.keys(seen).sort().forEach(function (c) { ensureCycleTab_(c, true); });
  ensureOverview_(true);
}

/** A cycle tab is all formulas over the Ledger, so it stays right when you edit the Ledger by hand. */
function ensureCycleTab_(cycle, force) {
  var ss = SpreadsheetApp.getActive();
  var name = cycleTabName_(cycle);
  var sh = ss.getSheetByName(name);
  if (sh && !force) return sh;
  if (!sh) sh = ss.insertSheet(name, positionForCycle_(cycle));
  sh.clear();
  sh.getCharts().forEach(function (ch) { sh.removeChart(ch); });
  var s = getSettings_();
  var L = "'" + LEDGER + "'!";
  var col = function (n) { return L + colLetter_(C[n]) + ':' + colLetter_(C[n]); };
  var cyc = '"' + cycle + '"';
  var aed = col('Amount (AED)'), typ = col('Type'), cy = col('Cycle'), acc = col('Account'), cat = col('Category'), sts = col('Status');

  sh.getRange('A1').setValue(name).setFontSize(20).setFontWeight('bold').setFontColor(INK);
  sh.getRange('A2').setValue(cycleRangeLabel_(cycle, s.cycleStart)).setFontColor(MUTED);

  var summary = [
    ['Money in', '=SUMIFS(' + aed + ',' + cy + ',' + cyc + ',' + typ + ',"Income")'],
    ['Money out', '=SUMIFS(' + aed + ',' + cy + ',' + cyc + ',' + typ + ',"Spend")'],
    ['Net', '=B4-B5'],
    ['Allowance', "=Settings!B2"],
    ['Allowance left', '=Settings!B2-SUMIFS(' + aed + ',' + cy + ',' + cyc + ',' + typ + ',"Spend",' + acc + ',Settings!B3)'],
    ['Needs review', '=COUNTIFS(' + cy + ',' + cyc + ',' + sts + ',"Review")'],
  ];
  sh.getRange(4, 1, summary.length, 2).setValues(summary);
  sh.getRange('A4:A9').setFontColor(MUTED);
  sh.getRange('B4:B8').setNumberFormat('"AED "#,##0.00').setFontWeight('bold');
  sh.getRange('B4').setFontColor('#1f9d55');
  sh.getRange('B8').setFontColor(TINT);

  sh.getRange('D3:F3').setValues([['Spending by category', 'AED', 'Share']]);
  var catRows = SPEND_CATEGORIES.map(function (c, i) {
    var r = 4 + i;
    return [c, '=SUMIFS(' + aed + ',' + cy + ',' + cyc + ',' + typ + ',"Spend",' + cat + ',"' + c + '")', '=IF($B$5=0,0,E' + r + '/$B$5)'];
  });
  catRows.push(['Uncategorised', '=SUMIFS(' + aed + ',' + cy + ',' + cyc + ',' + typ + ',"Spend",' + cat + ',"")', '=IF($B$5=0,0,E' + (4 + SPEND_CATEGORIES.length) + '/$B$5)']);
  sh.getRange(4, 4, catRows.length, 3).setValues(catRows);
  sh.getRange(4, 5, catRows.length, 1).setNumberFormat('#,##0.00');
  sh.getRange(4, 6, catRows.length, 1).setNumberFormat('0%');

  var accTop = 4 + catRows.length + 2;
  sh.getRange(accTop, 4, 1, 3).setValues([['By account', 'Spent', 'Received']]);
  var accRows = ACCOUNTS.map(function (a) {
    return [a,
      '=SUMIFS(' + aed + ',' + cy + ',' + cyc + ',' + typ + ',"Spend",' + acc + ',"' + a + '")',
      '=SUMIFS(' + aed + ',' + cy + ',' + cyc + ',' + typ + ',"Income",' + acc + ',"' + a + '")'];
  });
  sh.getRange(accTop + 1, 4, accRows.length, 3).setValues(accRows);
  sh.getRange(accTop + 1, 5, accRows.length, 2).setNumberFormat('#,##0.00');

  var listTop = accTop + accRows.length + 3;
  sh.getRange(listTop - 1, 1).setValue('Entries').setFontWeight('bold').setFontSize(13);
  var q = '=IFERROR(QUERY(' + L + 'A:P,"select B, D, G, H, I, J, K, L, N where C = \'' + cycle +
    '\' order by B desc label B \'Date\', D \'Type\', G \'AED\', H \'Account\', I \'To\', J \'Category\', K \'Merchant\', L \'Note\', N \'Status\'",1),"No entries yet")';
  sh.getRange(listTop, 1).setFormula(q);
  sh.getRange(listTop + 1, 1, 1000, 1).setNumberFormat('ddd d mmm, hh:mm');
  sh.getRange(listTop + 1, 3, 1000, 1).setNumberFormat('#,##0.00');

  [sh.getRange('D3:F3'), sh.getRange(accTop, 4, 1, 3), sh.getRange(listTop, 1, 1, 9)].forEach(function (r) {
    r.setFontWeight('bold').setBackground(SOFT).setFontColor(INK);
  });
  sh.setColumnWidth(1, 150); sh.setColumnWidth(2, 120); sh.setColumnWidth(3, 90);
  sh.setColumnWidth(4, 180); sh.setColumnWidth(5, 100); sh.setColumnWidth(6, 70);
  sh.setColumnWidths(7, 3, 140);
  sh.setFrozenRows(2);
  sh.setHiddenGridlines(true);

  var chart = sh.newChart().asPieChart()
    .addRange(sh.getRange(4, 4, SPEND_CATEGORIES.length, 2))
    .setPosition(3, 8, 0, 0)
    .setOption('pieHole', 0.55)
    .setOption('title', 'Where the money went')
    .setOption('legend', { position: 'right' })
    .setOption('pieSliceText', 'none')
    .setOption('colors', ['#2a78d6', '#1baf7a', '#eb6834', '#e87ba4', '#4a3aa7', '#eda100', '#e34948', '#8e8e93', '#008300', '#aeaeb2'])
    .setOption('width', 460).setOption('height', 300)
    .build();
  sh.insertChart(chart);
  ensureOverview_();
  return sh;
}

function positionForCycle_(cycle) {
  // Newest cycle tabs sit right after the fixed tabs, newest first.
  var ss = SpreadsheetApp.getActive();
  var sheets = ss.getSheets();
  var fixed = [OVERVIEW, LEDGER, SETTINGS, MERCHANTS];
  var idx = 0;
  for (var i = 0; i < sheets.length; i++) {
    var n = sheets[i].getName();
    if (fixed.indexOf(n) >= 0) { idx = i + 1; continue; }
    var c = tabNameToCycle_(n);
    if (c && c > cycle) idx = i + 1;
  }
  return idx;
}

function tabNameToCycle_(name) {
  var m = /^([A-Z][a-z]{2}) (\d{4})$/.exec(name);
  if (!m) return '';
  var mi = MONTHS.indexOf(m[1]) + 1;
  return mi ? m[2] + '-' + (mi < 10 ? '0' : '') + mi : '';
}

function ensureOverview_(force) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(OVERVIEW);
  if (sh && !force) return sh;
  if (!sh) sh = ss.insertSheet(OVERVIEW, 0);
  sh.clear();
  sh.getRange('A1').setValue('Spendings').setFontSize(22).setFontWeight('bold');
  sh.getRange('A2').setValue('One row per pay cycle. Everything here is calculated from the Ledger tab.').setFontColor(MUTED);
  var L = "'" + LEDGER + "'!";
  sh.getRange('A4:F4').setValues([['Cycle', 'Money in', 'Money out', 'Net', 'Allowance left', 'Needs review']]);
  sh.getRange('A5').setFormula('=IFERROR(SORT(UNIQUE(FILTER(' + L + 'C2:C,' + L + 'C2:C<>"")),1,FALSE),)');
  var cy = L + 'C:C', typ = L + 'D:D', aed = L + 'G:G', acc = L + 'H:H', sts = L + 'N:N';
  sh.getRange('B5').setFormula('=MAP(A5:A200,LAMBDA(c,IF(c="",,SUMIFS(' + aed + ',' + cy + ',c,' + typ + ',"Income"))))');
  sh.getRange('C5').setFormula('=MAP(A5:A200,LAMBDA(c,IF(c="",,SUMIFS(' + aed + ',' + cy + ',c,' + typ + ',"Spend"))))');
  sh.getRange('D5').setFormula('=MAP(A5:A200,LAMBDA(c,IF(c="",,SUMIFS(' + aed + ',' + cy + ',c,' + typ + ',"Income")-SUMIFS(' + aed + ',' + cy + ',c,' + typ + ',"Spend"))))');
  sh.getRange('E5').setFormula('=MAP(A5:A200,LAMBDA(c,IF(c="",,Settings!B2-SUMIFS(' + aed + ',' + cy + ',c,' + typ + ',"Spend",' + acc + ',Settings!B3))))');
  sh.getRange('F5').setFormula('=MAP(A5:A200,LAMBDA(c,IF(c="",,COUNTIFS(' + cy + ',c,' + sts + ',"Review"))))');
  sh.getRange('A4:F4').setFontWeight('bold').setBackground(SOFT);
  sh.getRange('B5:E200').setNumberFormat('"AED "#,##0.00');
  sh.setColumnWidth(1, 110); sh.setColumnWidths(2, 5, 140);
  sh.setFrozenRows(4);
  sh.setHiddenGridlines(true);
  return sh;
}

/* ───────────────────────── Helpers ───────────────────────── */

function ensureSheet_(name) {
  var ss = SpreadsheetApp.getActive();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function styleHeader_(sh, n) {
  sh.getRange(1, 1, 1, n).setFontWeight('bold').setBackground(SOFT).setFontColor(INK);
}

function addValidation_(sh, colIdx, values) {
  var rule = SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(true).build();
  sh.getRange(2, colIdx + 1, sh.getMaxRows() - 1, 1).setDataValidation(rule);
}

function colLetter_(i) {
  var s = '';
  i += 1;
  while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

/** Strip, cap length, and stop text being read as a formula (e.g. a merchant named "=SUM(...)"). */
function clean_(v) {
  var s = String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

/** "AED 1,234.50", "$12.00", "12.00 USD", "د.إ.‏ 42" → { amount, currency } */
function parseMoney_(v) {
  if (typeof v === 'number') return { amount: Math.abs(v), currency: 'AED' };
  var s = String(v || '').replace(/[ ‏‎]/g, ' ');
  var currency = 'AED';
  if (/US\$|USD|\$/i.test(s)) currency = 'USD';
  else {
    var code = /\b([A-Z]{3})\b/.exec(s.toUpperCase());
    if (code && code[1] !== 'AED') currency = code[1];
    if (/€/.test(s)) currency = 'EUR';
    if (/£/.test(s)) currency = 'GBP';
  }
  var num = (s.match(/\d[\d,]*(?:\.\d+)?/) || ['0'])[0].replace(/,/g, '');
  return { amount: Math.abs(parseFloat(num) || 0), currency: currency };
}

function fmtMoney_(n, cur) {
  var v = (Math.round(Number(n) * 100) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (cur || 'AED') + ' ' + v.replace(/\.00$/, '');
}

function hash_(s) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1, s);
  return bytes.slice(0, 6).map(function (b) { return ((b + 256) % 256).toString(16); })
    .map(function (h) { return h.length < 2 ? '0' + h : h; }).join('');
}

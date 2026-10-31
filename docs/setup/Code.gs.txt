/**
 * Spendings — Google Sheet backend.
 *
 * Paste this whole file into Extensions → Apps Script of your (empty) Google Sheet,
 * run `setup` once, then Deploy → New deployment → Web app
 * (Execute as: Me, Who has access: Anyone). See SETUP.md for the full walkthrough.
 * Or let the app's setup guide do all of that with "Sign in with Google".
 *
 * docs/setup/Code.gs.txt is a copy of this file that the setup guide installs. Change both
 * (tests/verify-setup.mjs fails if they differ): cp apps-script/Code.gs docs/setup/Code.gs.txt
 *
 * Tabs it manages:
 *   Ledger     — every entry, one row each. The source of truth. Edit with care.
 *   Overview   — one row per pay cycle: money in, money out, net, allowance left.
 *   Settings   — allowance, cycle start day, USD rate, Wallet card-name mapping.
 *   Merchants  — remembered merchant → category pairs (auto-categorises Apple Pay).
 *   Accounts   — your accounts: name, note, colour, and which Apple Wallet card they are.
 *   Plan       — payday plan: salary, Nafis, money you move between accounts, and responsibilities.
 *   Extras     — app features' own saved data (budgets, goals and so on), one JSON value per row.
 *   "Oct 2026" — one tab per pay cycle (27th → 26th), named after the month it ends in.
 */

var TZ = 'Asia/Dubai';
var LEDGER = 'Ledger';
var OVERVIEW = 'Overview';
var SETTINGS = 'Settings';
var MERCHANTS = 'Merchants';
var PLAN = 'Plan';
var ACCOUNTS_TAB = 'Accounts';
var EXTRAS = 'Extras';

var COLS = ['ID', 'Date', 'Cycle', 'Type', 'Amount', 'Currency', 'Amount (AED)', 'Account',
  'To account', 'Category', 'Merchant', 'Note', 'Source', 'Status', 'Created', 'Updated'];
var C = {}; COLS.forEach(function (n, i) { C[n] = i; });

// Adjustment = "match my bank": a signed correction that makes an account's balance equal the bank's.
var TYPES = ['Spend', 'Income', 'Transfer', 'Adjustment'];
// Starting accounts for a brand-new sheet: plain names you rename in the app (no bank is assumed). After
// setup the Accounts tab is the source of truth, so a sheet that already has accounts never sees these.
var ACCOUNT_COLS = ['Name', 'Note', 'Colour', 'Wallet name contains', 'Archived'];
var DEFAULT_ACCOUNTS = [
  ['Account 1', 'Main · pay lands here', 'teal', '', ''],
  ['Account 2', 'Personal allowance', 'red', '', ''],
  ['Cash', 'Notes & coins', 'green', '', ''],
];
var COLOUR_IDS = ['red', 'orange', 'gold', 'green', 'teal', 'sky', 'blue', 'indigo', 'purple', 'pink', 'graphite'];
var SPEND_CATEGORIES = ['Food & Drinks', 'Groceries', 'Transport & Fuel', 'Shopping',
  'Bills & Subscriptions', 'Entertainment', 'Health', 'Family & Gifts', 'Travel', 'Other'];
var INCOME_CATEGORIES = ['Salary', 'Nafis', 'Allowance', 'Gift', 'Refund', 'Other'];

var PLAN_COLS = ['ID', 'Name', 'Kind', 'Amount', 'Day', 'From', 'To', 'Category'];
var PLAN_KINDS = ['Income', 'Move', 'Responsibility'];
// A new sheet starts with an empty plan; the app's setup guide adds salary and the allowance move.
var DEFAULT_PLAN = [];

var DEFAULT_SETTINGS = [
  ['Allowance (AED per cycle)', 0, 'How much of your own money you plan to spend each cycle.'],
  ['Allowance account', 'Account 2', 'Spending on this account counts against the allowance.'],
  ['Emergency account', 'Account 1', 'Spending here gets a gentle warning.'],
  ['Cycle start day', 1, 'Day of the month a new cycle starts (1–28).'],
  ['USD → AED rate', 3.6725, 'The AED is pegged to the USD.'],
];
// Extra "Wallet name contains → account" rows. None to start: each account's own Wallet-name word (Accounts tab)
// and its name already match cards. A sheet that has rows here keeps them.
var DEFAULT_CARD_MAP = [];

// what this version of the script can do, so the app can tell an old script from a new one
var FEATURES = ['extras', 'install'];

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
  setupSheet_();
  var token = getToken_();
  try {
    SpreadsheetApp.getUi().alert('Spendings is set up ✓',
      'Your app key is:\n\n' + token + '\n\nNext: Deploy → New deployment → Web app ' +
      '(Execute as: Me · Who has access: Anyone), then paste the Web app URL and this key into the app’s Settings.',
      SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) { Logger.log('App key: ' + token); }
}

/** Everything setup() does, without popups, so the app's setup guide can run it over the web (`install`). */
function setupSheet_() {
  var ss = SpreadsheetApp.getActive();
  var newLedger = !ss.getSheetByName(LEDGER);
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
  ensureAccounts_();
  refreshAccountValidation_();
  addValidation_(ledger, C['Status'], ['OK', 'Review']);

  var settings = ensureSheet_(SETTINGS);
  if (settings.getLastRow() === 0) {
    settings.getRange(1, 1, 1, 3).setValues([['Setting', 'Value', 'Notes']]);
    settings.getRange(2, 1, DEFAULT_SETTINGS.length, 3).setValues(DEFAULT_SETTINGS);
    var mapRow = DEFAULT_SETTINGS.length + 4;
    settings.getRange(mapRow - 1, 1, 1, 3).setValues([['Wallet card name contains', 'Account', 'Add a row if Apple Wallet calls a card something else.']]);
    if (DEFAULT_CARD_MAP.length) settings.getRange(mapRow, 1, DEFAULT_CARD_MAP.length, 2).setValues(DEFAULT_CARD_MAP);
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

  ensurePlan_();
  ensureAccounts_();
  ensureOverview_();
  ensureCycleTab_(cycleOf_(new Date(), getSettings_().cycleStart));

  var sheet1 = ss.getSheetByName('Sheet1');
  if (sheet1 && sheet1.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sheet1);
  ss.setActiveSheet(ss.getSheetByName(OVERVIEW));
  ss.moveActiveSheet(1);
  // remember what a brand-new sheet looked like, so `install` can tell it from one you've used
  if (newLedger) PropertiesService.getScriptProperties().setProperty('SETUP_PRINT', setupPrint_());
}

/**
 * Called by the app's setup guide once it can reach the sheet. Builds the tabs if they aren't there yet.
 * A sheet that already has a Ledger is left exactly as it is (no restyling).
 * `fresh: true` means nobody has used this sheet yet (no entries, and its accounts, settings and plan are
 * still the ones setup made), so the app may send your guide answers. Anything else keeps what it has.
 */
function install_() {
  var ss = SpreadsheetApp.getActive();
  var ledger = ss.getSheetByName(LEDGER);
  var fresh;
  if (!ledger) {
    // only a sheet with nothing of yours in it counts as new
    fresh = [SETTINGS, ACCOUNTS_TAB, PLAN, EXTRAS, MERCHANTS].every(function (n) {
      var sh = ss.getSheetByName(n);
      return !sh || sh.getLastRow() === 0;
    });
    setupSheet_();
  } else {
    var print = PropertiesService.getScriptProperties().getProperty('SETUP_PRINT');
    fresh = ledger.getLastRow() <= 1 && !!print && print === setupPrint_();
  }
  return { ok: true, message: 'Your sheet is ready', features: FEATURES, fresh: fresh };
}

/** A short fingerprint of the tabs you set up yourself (accounts, settings, plan, merchants, extras). */
function setupPrint_() {
  var ss = SpreadsheetApp.getActive();
  var parts = [SETTINGS, ACCOUNTS_TAB, PLAN, MERCHANTS, EXTRAS].map(function (n) {
    var sh = ss.getSheetByName(n);
    if (!sh || sh.getLastRow() === 0) return n + ':';
    try { return n + ':' + JSON.stringify(sh.getRange(1, 1, sh.getLastRow(), 12).getValues()); } catch (e) { return n + ':?' + sh.getLastRow(); }
  });
  return hash_(parts.join('|'));
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
  if (t) return t;
  // No key yet. Two first requests can arrive together: hold the lock, then look again, so the second one
  // finds the key the first one took from the Setup tab instead of making a different one.
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    t = props.getProperty('TOKEN');
    if (!t) {
      t = installerKey_() || Utilities.getUuid().replace(/-/g, '').slice(0, 24);
      props.setProperty('TOKEN', t);
    }
  } finally {
    lock.releaseLock();
  }
  return t;
}

/**
 * The app's setup guide makes the sheet from outside, where it can't set this script's properties.
 * So it writes the app key it made into a "Setup" tab (A1 says what it is, A2 is the key). The first
 * time the script needs a key it takes that one, keeps it in its properties, and removes the tab.
 * Only used while there's no key yet, so a sheet set up by hand never looks at it.
 */
var SETUP_TAB = 'Setup';
var SETUP_MARK = 'Spendings app key';
function installerKey_() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss && ss.getSheetByName(SETUP_TAB);
  if (!sh) return '';
  if (String(sh.getRange(1, 1).getValue()).indexOf(SETUP_MARK) !== 0) return '';
  var key = String(sh.getRange(2, 1).getValue()).trim();
  if (!/^[A-Za-z0-9]{24,64}$/.test(key)) return '';
  // a spreadsheet can't lose its last tab: then it's emptied and renamed, and setup removes it later
  if (ss.getSheets().length > 1) ss.deleteSheet(sh);
  else { sh.clear(); sh.setName('Sheet1'); }
  return key;
}

/* ───────────────────────── Web endpoints ───────────────────────── */

function doGet(e) {
  // the setup guide opens ?setup=1 so Google asks you to allow the script; afterwards this page says so
  if (e && e.parameter && e.parameter.setup) {
    return HtmlService.createHtmlOutput('<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<div style="font:17px -apple-system,system-ui,sans-serif;padding:40px 24px;text-align:center">' +
      '<h2>Spendings can use your sheet ✓</h2><p>Close this tab and go back to the app. It carries on by itself.</p></div>')
      .setTitle('Spendings');
  }
  return json_({ ok: true, app: 'spendings', hint: 'POST JSON with your app key.' });
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'Could not read the request.' });
  }
  var key;
  try { key = getToken_(); } catch (err) { return json_({ ok: false, error: 'The sheet is busy. Try again in a moment.' }); }
  if (!body.token || String(body.token).trim() !== key) {
    return json_({ ok: false, error: 'Wrong app key. Copy it again from the sheet: Spendings → Show my app key.' });
  }
  var action = body.action || (body.source === 'applepay' ? 'applepay' : body.source === 'bank' ? 'bankalert' : 'add');
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return json_({ ok: false, error: 'The sheet is busy. Try again in a moment.' });
  }
  try {
    // a sheet made by the setup guide has no tabs until `install` runs: build them first for anything else
    if (action !== 'ping' && action !== 'install' && !SpreadsheetApp.getActive().getSheetByName(LEDGER)) setupSheet_();
    switch (action) {
      case 'ping': return json_({ ok: true, message: 'Connected to ' + SpreadsheetApp.getActive().getName(), features: FEATURES });
      case 'install': return json_(install_());
      case 'list': return json_(listAll_());
      case 'applepay': return json_(addApplePay_(body));
      case 'bankalert': return json_(addBankAlert_(body));
      case 'add': return json_(addEntries_(body.entries || [body.entry || body]));
      case 'update': return json_(updateEntry_(body.id, body.fields || {}));
      case 'delete': return json_(deleteEntry_(body.id));
      case 'settings': return json_(saveSettings_(body.settings || {}));
      case 'plan': return json_(savePlan_(body.plan || []));
      case 'accounts': return json_(saveAccounts_(body.accounts || []));
      case 'renameAccount': return json_(renameAccount_(body.from, body.to));
      case 'reset': return json_(resetSheet_());
      case 'extras': return json_(saveExtra_(body.key, body.value));
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
  return logCardSpend_(s, {
    money: parseMoney_(body.amount),
    account: mapCard_(body.card, s.cardMap),
    merchant: clean_(body.merchant),
    category: clean_(body.category),
    note: clean_(body.note),
    source: 'Apple Pay',
    testRun: !clean_(body.amount) && !clean_(body.merchant),
  });
}

/**
 * Called by the bank-notification Shortcut. Fields: app (the bank app's name), title, body (the notification's text).
 * Only card purchases are logged. Transfers, salary, refunds, ATM withdrawals, OTPs and the rest are
 * ignored, so money moving between accounts never counts as spending.
 */
function addBankAlert_(body) {
  var s = getSettings_();
  var text = [body.title, body.body, body.text].map(clean_).filter(String).join(' · ');
  var alert = parseBankAlert_(text);
  if (!alert) return { ok: true, ignored: true, message: 'Not a card payment, so nothing was logged.' };
  // the app name or title says which bank it is; the body can mention other banks (e.g. "at BOTIM MONEY")
  var account = mapCard_([body.app, body.title].join(' '), s.cardMap);
  if (!account.known) account = mapCard_(text, s.cardMap);
  return logCardSpend_(s, {
    money: alert.money,
    account: account,
    merchant: alert.merchant,
    category: clean_(body.category),
    note: '',
    source: 'Bank alert',
  });
}

var BANK_SPEND_RE = /\b(purchase|purchased|spent|spend|paid|payment|debited|debit card|credit card|card ending|used for|transaction|pos|e-?commerce|online)\b/i;
var CURRENCIES = 'AED|USD|EUR|GBP|SAR|QAR|KWD|OMR|BHD|EGP|JOD|INR|PKR|TRY|CHF|JPY|CNY|CAD|AUD|SGD|HKD|THB|MYR';
var BANK_IGNORE_RE = /\b(credited|credit of|received|receive|transfer|transferred|salary|deposit|refund|reversal|reversed|withdraw|withdrawn|withdrawal|atm|otp|one[- ]time|password|declined|failed|unsuccessful|insufficient|activated|enrolled|statement|due|minimum|bill generated)\b/i;

/** "Purchase of AED 42.00 at CARREFOUR with card XXX5247 …" → { money, merchant } or null if it isn't a card payment. */
function parseBankAlert_(text) {
  var t = String(text || '');
  if (!BANK_SPEND_RE.test(t) || BANK_IGNORE_RE.test(t)) return null;
  // the amount sits next to its currency; bare numbers are card digits, dates or balances
  var m = new RegExp('\\b(' + CURRENCIES + ')\\s?([\\d,]+(?:\\.\\d+)?)').exec(t) ||
    new RegExp('([\\d,]+(?:\\.\\d+)?)\\s?(' + CURRENCIES + ')\\b').exec(t);
  if (!m) return null;
  var cur = /^\d/.test(m[1]) ? m[2] : m[1], num = /^\d/.test(m[1]) ? m[1] : m[2];
  var amount = parseFloat(num.replace(/,/g, ''));
  if (!(amount > 0)) return null;
  var merchant = '';
  // "at X" names the merchant; "to X" also appears in "linked to account …", so it's only a fallback
  var end = '(?=\\s+(?:on|using|with|via|for|card|ref)\\b|\\s*[.,;·|]\\s|\\s*[.,;·|]?$|\\s+\\d{1,2}[\\/\\-]\\d)';
  var mm = new RegExp('\\b(?:at|@)\\s+(.+?)' + end, 'i').exec(t) || new RegExp('\\b(?:paid to|payment to)\\s+(.+?)' + end, 'i').exec(t);
  if (mm) merchant = clean_(mm[1]).replace(/^the\s+/i, '');
  return { money: { amount: Math.round(amount * 100) / 100, currency: cur.toUpperCase() }, merchant: merchant };
}

/** Shared by Apple Pay and bank alerts: files one card payment and builds the notification text. */
function logCardSpend_(s, p) {
  var money = p.money, account = p.account, merchant = p.merchant, category = p.category;
  // Tapping ▶ on the Shortcut to test it sends no payment details. Say the connection works and log
  // nothing, instead of an AED 0 entry in Needs review. Only a request with no amount text AND no
  // merchant counts (p.testRun): an amount that couldn't be read is still kept for review.
  if (p.testRun) {
    return { ok: true, test: true, message: 'Connected ✓ The sheet got your Shortcut. Nothing was logged because there was no payment in this test.' };
  }
  if (!category || /later|skip|review/i.test(category)) category = '';
  if (category && spendCategories_().indexOf(category) < 0) category = matchCategory_(category) || '';
  var remembered = '';
  if (!category && merchant) remembered = category = rememberedCategory_(merchant);

  // paying one of your own accounts (e.g. a BOTIM top-up with the ADCB card) is moving money, not spending
  var to = ownAccountIn_(merchant);
  var isMove = to.known && to.name !== account.name && account.known;
  if (isMove) category = remembered = '';

  var date = new Date();
  var prefix = p.source === 'Apple Pay' ? 'ap-' : 'ba-';
  var entry = {
    id: prefix + hash_([money.amount, money.currency, merchant, account.name, Utilities.formatDate(date, TZ, 'yyyyMMddHHmm')].join('|')),
    date: date.toISOString(),
    type: isMove ? 'Transfer' : 'Spend',
    toAccount: isMove ? to.name : '',
    amount: money.amount,
    currency: money.currency,
    account: account.name,
    category: category,
    merchant: merchant,
    note: p.note || '',
    source: p.source,
  };
  var problems = [];
  if (!(money.amount > 0)) problems.push('amount');
  if (!account.known) problems.push('card');
  if (!category && !isMove) problems.push('category');
  if (money.currency !== 'AED' && money.currency !== 'USD') problems.push('currency');
  entry.status = problems.length ? 'Review' : 'OK';

  // A tap with Apple Pay fires both the Wallet automation and the bank's notification: keep only one.
  var twin = money.amount > 0 ? twinOf_(entry, date) : null;
  if (twin) {
    // mark the pair so a later payment of the same amount isn't mistaken for this one
    var fix = { source: PAIRED };
    var half = twin.splitHalf;
    // the other source logged it as a purchase; the bank alert shows it was a top-up of your own account
    // (never for a split payment: sharing it with someone says it was a purchase)
    if (isMove && twin.type === 'Spend' && !half) { fix.type = 'Transfer'; fix.toAccount = to.name; fix.category = ''; fix.status = 'OK'; }
    twin = updateEntry_(twin.id, fix).entry;
    var tmsg = 'Already logged · ' + fmtMoney_(twin.amount, twin.currency) + (twin.merchant ? ' · ' + twin.merchant : '') + ' · ' + twin.account;
    if (half) tmsg = 'Already logged · ' + fmtMoney_(entry.amount, entry.currency) + (twin.merchant ? ' · ' + twin.merchant : '') + ' · split with ' + half.toAccount + ' · ' + twin.account;
    if (twin.toAccount) tmsg = 'Already logged · moved ' + fmtMoney_(twin.amount, twin.currency) + ' from ' + twin.account + ' to ' + twin.toAccount;
    return { ok: true, message: tmsg, entry: twin, duplicate: true };
  }

  var res = addEntries_([entry]);
  var saved = res.entries[0];
  var cyc = cycleSummary_(saved.cycle);
  var msg = fmtMoney_(entry.amount, entry.currency) + (merchant ? ' · ' + merchant : '') + ' · ' + account.name;
  if (isMove) msg = 'Moved ' + fmtMoney_(entry.amount, entry.currency) + ' from ' + account.name + ' to ' + to.name + ' · not spending';
  if (remembered) msg += ' · ' + remembered;
  if (isMove) {
    // nothing more: a move doesn't use the allowance
  } else if (account.name === s.allowanceAccount) {
    msg += '\n' + fmtMoney_(Math.max(0, cyc.allowanceLeft), 'AED') + ' left of your allowance';
  } else if (account.known) {
    var bal = balanceInfo_(account.name);
    if (bal.matched) msg += '\n' + fmtMoney_(bal.total, 'AED') + ' left in ' + account.name;
  }
  if (problems.indexOf('category') >= 0) msg += '\nAdded to Needs review';
  if (res.duplicates) msg = 'Already logged · ' + msg;
  // last line: how this category is doing against its limit (never lets a bad Extras value fail the logging)
  if (!isMove && saved.type === 'Spend' && category) {
    try { var bl = budgetLine_(category, saved.cycle); if (bl) msg += '\n' + bl; } catch (err) { /* the payment is logged; skip the line */ }
  }
  return { ok: true, message: msg, entry: saved, duplicate: !!res.duplicates };
}

/** "Food: AED 412 of 500 this cycle (82%)" for a category that has a limit in the `budgets` extra
    ({ v: 1, limits: { <id>: AED } }), else ''. Same gross spend as the app's Insights (docs/js/budgets.js):
    Spend entries only, so transfers aren't counted and refunds aren't netted off. The name is the renamed
    label from the `categories` extra when there is one. */
function budgetLine_(category, cycle) {
  var ex = readExtras_();
  var limits = ex.budgets && typeof ex.budgets === 'object' && ex.budgets.limits && typeof ex.budgets.limits === 'object' ? ex.budgets.limits : null;
  if (!limits || !Object.prototype.hasOwnProperty.call(limits, category)) return '';
  var limit = Number(limits[category]);
  if (!isFinite(limit) || limit <= 0) return '';
  var sh = SpreadsheetApp.getActive().getSheetByName(LEDGER);
  var n = sh.getLastRow() - 1;
  var spent = 0;
  if (n > 0) sh.getRange(2, 1, n, COLS.length).getValues().forEach(function (r) {
    if (r[C['Type']] === 'Spend' && String(r[C['Cycle']]) === cycle && r[C['Category']] === category) spent += Number(r[C['Amount (AED)']]) || 0;
  });
  var names = ex.categories && typeof ex.categories === 'object' && ex.categories.names && typeof ex.categories.names === 'object' ? ex.categories.names : {};
  var label = typeof names[category] === 'string' && names[category].trim() ? names[category].trim() : category;
  return label + ': ' + fmtMoney_(spent, 'AED') + ' of ' + Math.round(limit * 100) / 100 + ' this cycle (' + Math.floor(spent / limit * 100) + '%)';
}

/** Which of your accounts a merchant name is, by its Wallet-name word ("BOTIM MONEY" → BOTIM). Whole words only. */
function ownAccountIn_(merchant) {
  var m = ' ' + String(merchant || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ') + ' ';
  var people = peopleSet_();
  var accs = readAccounts_().filter(function (a) { return !a.archived && !people[a.name]; });
  for (var i = 0; i < accs.length; i++) {
    var key = String(accs[i].wallet || '').toLowerCase().trim();
    if (key && m.indexOf(' ' + key + ' ') >= 0) return { name: accs[i].name, known: true };
  }
  return { known: false };
}

var TWIN_MINUTES = 15;
var PAIRED = 'Apple Pay + Bank alert';

/**
 * The same payment reported by the other automatic source (Apple Pay vs bank alert): same account,
 * amount and currency within TWIN_MINUTES. Each entry pairs at most once (its source becomes PAIRED), so two
 * genuine payments of the same amount both stay logged. A payment split in the app (money owed) holds only
 * your share; its other half is the Transfer with the id <spend id>-split, and the two together make up the
 * alert's amount, so that pair counts as the same payment too.
 */
function twinOf_(entry, date) {
  var sh = SpreadsheetApp.getActive().getSheetByName(LEDGER);
  var n = sh.getLastRow() - 1;
  if (n <= 0) return null;
  var from = Math.max(2, sh.getLastRow() - 199);
  var rows = sh.getRange(from, 1, sh.getLastRow() - from + 1, COLS.length).getValues().map(fromRow_);
  var since = date.getTime() - TWIN_MINUTES * 60000;
  var auto = { 'Apple Pay': 1, 'Bank alert': 1 };
  var byId = {};
  rows.forEach(function (e) { byId[e.id] = e; });
  var near = function (a, b) { return Math.abs(a - b) < 0.005; };
  // the other half of a split Spend, when it is one: looked up by id (its source is Split, not an automatic one)
  var splitHalf = function (e) {
    var t = byId[e.id + '-split'];
    return t && t.type === 'Transfer' && t.account === e.account && t.currency === e.currency ? t : null;
  };
  var same = function (e) {
    if (!((e.type === 'Spend' || e.type === 'Transfer') && auto[e.source] && e.account === entry.account && e.currency === entry.currency &&
      new Date(e.date).getTime() >= since)) return false;
    if (near(e.amount, entry.amount)) return true;
    var t = e.type === 'Spend' ? splitHalf(e) : null;
    return !!t && near(e.amount + t.amount, entry.amount);
  };
  // unpaired entries from the other source, oldest first; an entry already paired never matches again
  var others = rows.filter(function (e) { return same(e) && e.source !== entry.source && e.id !== entry.id; });
  if (!others.length) return null;
  var twin = others[0];
  twin.splitHalf = near(twin.amount, entry.amount) ? null : splitHalf(twin);
  return twin;
}

function addEntries_(list) {
  var s = getSettings_();
  var sh = SpreadsheetApp.getActive().getSheetByName(LEDGER);
  var existing = idIndex_(sh);
  var now = new Date();
  var rows = [], out = [], dupes = 0, touched = {};
  list.forEach(function (raw) {
    var e = normalise_(raw, s);
    // a foreign-currency entry the app has already priced (each half of a USD split, an undone delete)
    // keeps that price, so the halves add up to the whole; without one the sheet's rate prices it
    if (e.currency !== 'AED' && raw.amountAED != null && raw.amountAED !== '' && !isNaN(Number(raw.amountAED))) e.amountAED = Math.round(Number(raw.amountAED) * 100) / 100;
    if (existing[e.id] || touched['id:' + e.id]) { dupes++; out.push(e); return; }
    touched['id:' + e.id] = true;
    rows.push(toRow_(e, now, now));
    out.push(e);
    touched[e.cycle] = true;
    if (e.merchant && e.category && e.type === 'Spend' && e.source !== 'BNPL') rememberMerchant_(e.merchant, e.category);
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
  // a foreign-currency entry keeps the rate it was priced at unless its amount or currency
  // changes; an undo from the app sends the exact old price back
  if (e.currency !== 'AED') {
    if (fields.amountAED != null && fields.amountAED !== '' && !isNaN(Number(fields.amountAED))) e.amountAED = Number(fields.amountAED);
    else if (e.amount === current.amount && e.currency === current.currency && current.amountAED != null) e.amountAED = current.amountAED;
  }
  var created = sh.getRange(row, C['Created'] + 1).getValue() || new Date();
  sh.getRange(row, 1, 1, COLS.length).setValues([toRow_(e, created, new Date())]);
  if (e.merchant && e.category && e.type === 'Spend' && e.source !== 'BNPL') rememberMerchant_(e.merchant, e.category); // BNPL: the plan's category, not learned
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
    plan: readPlan_(),
    accounts: readAccounts_(),
    extras: readExtras_(),
    // what this version of the script can do, so the app can tell an old script from a new one
    features: FEATURES,
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
    if (/Account$/.test(k) && activeNames_().indexOf(v) < 0) return;
    sh.getRange(labels[k] + 2, 2).setValue(v);
    if (k === 'cycleStart') retagCycles_(v);
  });
  return { ok: true, settings: listAll_().settings };
}

/** A new cycle start day moves entries between cycles: rewrite the Ledger's Cycle column. */
function retagCycles_(startDay) {
  var sh = SpreadsheetApp.getActive().getSheetByName(LEDGER);
  var n = sh.getLastRow() - 1;
  if (n <= 0) return;
  var dates = sh.getRange(2, C['Date'] + 1, n, 1).getValues();
  var cycles = dates.map(function (r) {
    var d = r[0] instanceof Date ? r[0] : new Date(r[0]);
    return [isNaN(d.getTime()) ? '' : cycleOf_(d, startDay)];
  });
  sh.getRange(2, C['Cycle'] + 1, n, 1).setValues(cycles);
  var touched = {};
  cycles.forEach(function (c) { if (c[0]) touched[c[0]] = true; });
  Object.keys(touched).forEach(function (k) { ensureCycleTab_(k, true); });
}

/* ───────────────────────── Rows ───────────────────────── */

function normalise_(raw, s) {
  var type = TYPES.indexOf(raw.type) >= 0 ? raw.type : 'Spend';
  var currency = String(raw.currency || 'AED').toUpperCase().trim().slice(0, 3);
  if (!/^[A-Z]{3}$/.test(currency)) currency = 'AED'; // three letters only: nothing a sheet could read as a formula
  var amount = Math.round((type === 'Adjustment' ? Number(raw.amount) || 0 : Math.abs(Number(raw.amount) || 0)) * 100) / 100;
  var date = raw.date ? new Date(raw.date) : new Date();
  if (isNaN(date.getTime())) date = new Date();
  var aed = currency === 'AED' ? amount : currency === 'USD' ? Math.round(amount * s.usdRate * 100) / 100 : '';
  var account = clean_(raw.account) || 'Cash';
  var toAccount = type === 'Transfer' ? clean_(raw.toAccount) : '';
  var category = type === 'Transfer' || type === 'Adjustment' ? '' : clean_(raw.category);
  var status = type === 'Adjustment' ? 'OK' : raw.status === 'Review' || raw.status === 'OK' ? raw.status
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

/* ───────────────────────── Balances & plan ───────────────────────── */

/** What an account holds now, in AED: everything in, minus everything out, plus bank matches. */
function balanceOf_(account) { return balanceInfo_(account).total; }

/** matched = the account has been matched to the bank at least once, so its balance is real. */
function balanceInfo_(account) {
  var sh = SpreadsheetApp.getActive().getSheetByName(LEDGER);
  var n = sh.getLastRow() - 1, total = 0, matched = false;
  if (n <= 0) return { total: 0, matched: false };
  sh.getRange(2, 1, n, COLS.length).getValues().forEach(function (r) {
    var v = Number(r[C['Amount (AED)']]) || 0, t = r[C['Type']];
    if (r[C['Account']] === account) {
      if (t === 'Adjustment') matched = true;
      if (t === 'Income' || t === 'Adjustment') total += v;
      else if (t === 'Spend' || t === 'Transfer') total -= v;
    }
    if (t === 'Transfer' && r[C['To account']] === account) total += v;
  });
  return { total: Math.round(total * 100) / 100, matched: matched };
}

function ensurePlan_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(PLAN);
  if (sh) return sh;
  sh = ensureSheet_(PLAN);
  sh.getRange(1, 1, 1, PLAN_COLS.length).setValues([PLAN_COLS]);
  if (DEFAULT_PLAN.length) sh.getRange(2, 1, DEFAULT_PLAN.length, PLAN_COLS.length).setValues(DEFAULT_PLAN);
  styleHeader_(sh, PLAN_COLS.length);
  sh.setFrozenRows(1);
  sh.setColumnWidth(2, 150); sh.setColumnWidth(3, 120); sh.setColumnWidth(8, 170);
  addValidation_(sh, 2, PLAN_KINDS);
  sh.getRange('D:D').setNumberFormat('#,##0');
  sh.getRange(DEFAULT_PLAN.length + 3, 1).setValue('Income = money that lands each cycle. Move = money you send between accounts. Responsibility = what an account must still pay (it counts down as you spend in that category).').setFontColor(MUTED);
  return sh;
}

function readPlan_() {
  var sh = ensurePlan_();
  var n = sh.getLastRow() - 1;
  if (n <= 0) return [];
  return sh.getRange(2, 1, n, PLAN_COLS.length).getValues()
    .filter(function (r) { return r[0] && PLAN_KINDS.indexOf(String(r[2])) >= 0; })
    .map(function (r) {
      return { id: String(r[0]), name: String(r[1]), kind: String(r[2]), amount: Number(r[3]) || 0,
        day: r[4] === '' ? null : Math.min(31, Math.max(1, parseInt(r[4], 10) || 1)),
        from: String(r[5] || ''), to: String(r[6] || ''), category: String(r[7] || '') };
    });
}

function savePlan_(items) {
  var sh = ensurePlan_();
  var rows = (items || []).slice(0, 40).map(function (p) {
    var kind = PLAN_KINDS.indexOf(p.kind) >= 0 ? p.kind : 'Responsibility';
    return [clean_(p.id) || 'p-' + Utilities.getUuid().slice(0, 8), clean_(p.name) || kind, kind,
      Math.max(0, Number(p.amount) || 0), p.day ? Math.min(31, Math.max(1, parseInt(p.day, 10) || 1)) : '',
      allNames_().indexOf(p.from) >= 0 ? p.from : '', allNames_().indexOf(p.to) >= 0 ? p.to : '', clean_(p.category)];
  });
  var n = sh.getLastRow() - 1;
  if (n > 0) sh.getRange(2, 1, n, PLAN_COLS.length).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, PLAN_COLS.length).setValues(rows);
  return { ok: true, plan: readPlan_() };
}

/* ───────────────────────── Extras ─────────────────────────
   Newer features (category budgets, savings goals, …) keep their settings here, one row per
   feature: the key, its value as JSON, and when it last changed. Adding a feature never needs
   a new tab or column, and the Ledger is never touched. */

function ensureExtras_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(EXTRAS);
  if (sh) return sh;
  sh = ensureSheet_(EXTRAS);
  sh.getRange(1, 1, 1, 3).setValues([['Key', 'Value (JSON)', 'Updated']]);
  styleHeader_(sh, 3);
  sh.setFrozenRows(1);
  return sh;
}

/** Every saved extra as { key: value }. A row that isn't valid JSON is skipped, not fatal. */
function readExtras_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(EXTRAS);
  var out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) {
    var k = String(r[0] || '').trim();
    if (!k) return;
    if (r[1] === '' || r[1] == null) return; // cleared
    try { out[k] = JSON.parse(String(r[1])); } catch (err) { /* hand-edited cell; ignore it */ }
    if (out[k] === null) delete out[k];
  });
  return out;
}

/** Save one extra. Updates its row, or adds one. A null value clears the row's value.
    Runs inside doPost's script lock, so two saves can't race for the same row. */
function saveExtra_(key, value) {
  key = String(key || '').trim();
  if (!/^[a-zA-Z][\w.-]{0,40}$/.test(key)) return { ok: false, error: 'That isn’t a valid extras key.' };
  var text = value == null ? '' : JSON.stringify(value);
  if (text.length > 45000) return { ok: false, error: 'That is too much to save in one cell.' };
  var sh = ensureExtras_();
  var n = sh.getLastRow() - 1;
  var keys = n > 0 ? sh.getRange(2, 1, n, 1).getValues().map(function (r) { return String(r[0]).trim(); }) : [];
  var row = keys.indexOf(key) + 2;
  if (row < 2) row = sh.getLastRow() + 1;
  sh.getRange(row, 1, 1, 3).setValues([[key, text, new Date()]]);
  return { ok: true, key: key };
}

/* ───────────────────────── Reset ───────────────────────── */

/** Start fresh from the app: copy the Ledger to a hidden backup tab, then clear entries,
    learned merchants and the cycle tabs. Accounts, plan and settings are kept. */
function resetSheet_() {
  var ss = SpreadsheetApp.getActive();
  var led = ss.getSheetByName(LEDGER);
  var n = led.getLastRow() - 1, backup = '';
  if (n > 0) {
    backup = 'Backup ' + Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH.mm');
    var b = ss.insertSheet(backup, ss.getSheets().length);
    b.getRange(1, 1, n + 1, COLS.length).setValues(led.getRange(1, 1, n + 1, COLS.length).getValues());
    b.hideSheet();
    led.getRange(2, 1, n, COLS.length).clearContent();
  }
  var mer = ss.getSheetByName(MERCHANTS);
  if (mer && mer.getLastRow() > 1) mer.getRange(2, 1, mer.getLastRow() - 1, 4).clearContent();
  ss.getSheets().forEach(function (sh) { if (tabNameToCycle_(sh.getName())) ss.deleteSheet(sh); });
  ensureCycleTab_(cycleOf_(new Date(), getSettings_().cycleStart), true);
  ensureOverview_(true);
  return { ok: true, backup: backup };
}

/* ───────────────────────── Accounts ───────────────────────── */

function ensureAccounts_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(ACCOUNTS_TAB);
  if (sh) return sh;
  sh = ensureSheet_(ACCOUNTS_TAB);
  sh.getRange(1, 1, 1, ACCOUNT_COLS.length).setValues([ACCOUNT_COLS]);
  sh.getRange(2, 1, DEFAULT_ACCOUNTS.length, ACCOUNT_COLS.length).setValues(DEFAULT_ACCOUNTS);
  styleHeader_(sh, ACCOUNT_COLS.length);
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 140); sh.setColumnWidth(2, 220); sh.setColumnWidth(4, 190);
  return sh;
}

/** Accounts in display order. Rename them from the app so past entries follow. */
function readAccounts_() {
  var sh = ensureAccounts_();
  var n = sh.getLastRow() - 1;
  if (n <= 0) return [];
  return sh.getRange(2, 1, n, ACCOUNT_COLS.length).getValues()
    .filter(function (r) { return String(r[0]).trim(); })
    .map(function (r) {
      return { name: String(r[0]).trim(), note: String(r[1] || ''), color: COLOUR_IDS.indexOf(String(r[2])) >= 0 ? String(r[2]) : 'graphite',
        wallet: String(r[3] || ''), archived: r[4] === true || /^(yes|true|x)$/i.test(String(r[4])) };
    });
}
function allNames_() { return readAccounts_().map(function (a) { return a.name; }); }
function activeNames_() { return readAccounts_().filter(function (a) { return !a.archived; }).map(function (a) { return a.name; }); }

function refreshAccountValidation_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(LEDGER);
  if (sh) addValidation_(sh, C['Account'], activeNames_());
}

var MAX_ACCOUNTS = 20; // accounts and people together; the app checks the same number before adding one

function saveAccounts_(list) {
  var seen = {};
  var rows = (list || []).map(function (a) {
    var name = clean_(a.name).slice(0, 24);
    return [name, clean_(a.note).slice(0, 60), COLOUR_IDS.indexOf(a.color) >= 0 ? a.color : 'graphite', clean_(a.wallet).slice(0, 40), a.archived ? 'yes' : ''];
  }).filter(function (r) { if (!r[0] || seen[r[0].toLowerCase()]) return false; seen[r[0].toLowerCase()] = true; return true; });
  if (!rows.length) return { ok: false, error: 'Keep at least one account.' };
  // refuse rather than quietly drop the extra ones (nothing is written, so the sheet keeps its list)
  if (rows.length > MAX_ACCOUNTS) return { ok: false, error: 'Your sheet keeps up to ' + MAX_ACCOUNTS + ' accounts and people. Remove one first.' };
  var sh = ensureAccounts_();
  var n = sh.getLastRow() - 1;
  if (n > 0) sh.getRange(2, 1, n, ACCOUNT_COLS.length).clearContent();
  sh.getRange(2, 1, rows.length, ACCOUNT_COLS.length).setValues(rows);
  refreshAccountValidation_();
  return { ok: true, accounts: readAccounts_() };
}

/** Rename everywhere: Accounts, every Ledger row, the Plan and Settings, so the sheet stays readable. */
function renameAccount_(from, to) {
  from = String(from || '').trim(); to = clean_(to).slice(0, 24);
  if (!from || !to) return { ok: false, error: 'Give the account a name.' };
  if (from === to) return { ok: true, accounts: readAccounts_() };
  var names = allNames_();
  // `from` may not be in the Accounts tab yet (added offline, then renamed); rows are still renamed.
  if (names.some(function (n) { return n.toLowerCase() === to.toLowerCase() && n !== from; })) return { ok: false, error: 'You already have an account called ' + to + '.' };
  var swap = function (sheet, col, rowStart) {
    var n = sheet.getLastRow() - rowStart + 1;
    if (n <= 0) return;
    var rng = sheet.getRange(rowStart, col, n, 1), vals = rng.getValues(), changed = false;
    vals.forEach(function (r) { if (String(r[0]) === from) { r[0] = to; changed = true; } });
    if (changed) rng.setValues(vals);
  };
  var ss = SpreadsheetApp.getActive();
  var acc = ensureAccounts_(); swap(acc, 1, 2);
  var led = ss.getSheetByName(LEDGER); swap(led, C['Account'] + 1, 2); swap(led, C['To account'] + 1, 2);
  var plan = ensurePlan_(); swap(plan, 6, 2); swap(plan, 7, 2);
  var set = ss.getSheetByName(SETTINGS);
  [3, 4].forEach(function (row) { if (String(set.getRange(row, 2).getValue()) === from) set.getRange(row, 2).setValue(to); });
  refreshAccountValidation_();
  return { ok: true, accounts: readAccounts_() };
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
    allowance: Number(v(0, DEFAULT_SETTINGS[0][1])) || 0,
    allowanceAccount: String(v(1, DEFAULT_SETTINGS[1][1])),
    emergencyAccount: String(v(2, DEFAULT_SETTINGS[2][1])),
    cycleStart: Math.min(28, Math.max(1, parseInt(v(3, DEFAULT_SETTINGS[3][1]), 10) || 1)),
    usdRate: Number(v(4, 3.6725)) || 3.6725,
    cardMap: cardMap,
  };
}

function mapCard_(card, cardMap) {
  var c = String(card || '').toLowerCase();
  // a person (money owed, see peopleSet_) is never one of your cards, even if their name is in the card's
  var people = peopleSet_();
  var accs = readAccounts_().filter(function (a) { return !a.archived && !people[a.name]; });
  for (var j = 0; j < accs.length; j++) {
    var key = String(accs[j].wallet || '').toLowerCase().trim();
    if (key && c.indexOf(key) >= 0) return { name: accs[j].name, known: true };
  }
  for (var k = 0; k < accs.length; k++) {
    if (accs[k].name && c.indexOf(accs[k].name.toLowerCase()) >= 0) return { name: accs[k].name, known: true };
  }
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
  var cats = spendCategories_();
  for (var i = 0; i < cats.length; i++) {
    if (cats[i].toLowerCase() === t) return cats[i];
  }
  // the app may show a renamed label ("Eating out") for a built-in id ("Food & Drinks")
  var names = categoryConfig_().names || {};
  for (var id in names) {
    if (String(names[id]).toLowerCase() === t && cats.indexOf(id) >= 0) return id;
  }
  // loose first-word match for the built-in names only ("food" → Food & Drinks); your own short names
  // like "Car" would otherwise catch "Carrefour"
  for (var j = 0; j < SPEND_CATEGORIES.length; j++) {
    var first = SPEND_CATEGORIES[j].toLowerCase().split(/[ &]/)[0];
    if (first && t.indexOf(first) >= 0) return SPEND_CATEGORIES[j];
  }
  return '';
}

/** The app's Settings → Categories, saved in the Extras tab ({ custom, hidden, names }). Empty if never set. */
function categoryConfig_() {
  var c = readExtras_().categories;
  return c && typeof c === 'object' ? c : {};
}

/** Built-in spending categories plus your own (hidden ones still count, so old Shortcut menus keep working). */
function spendCategories_() {
  var custom = categoryConfig_().custom;
  var out = SPEND_CATEGORIES.slice();
  (Array.isArray(custom) ? custom : []).forEach(function (x) {
    var id = x && typeof x.id === 'string' ? x.id.trim() : '';
    if (id && (x.type || 'Spend') === 'Spend' && out.indexOf(id) < 0) out.push(id);
  });
  return out;
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
  var rows = n > 0 ? sh.getRange(2, 1, n, COLS.length).getValues() : [];
  rows.forEach(function (r) {
    if (String(r[C['Cycle']]) !== cycle) return;
    var aed = Number(r[C['Amount (AED)']]) || 0;
    if (r[C['Type']] === 'Spend') {
      out.spent += aed;
      out.byAccount[r[C['Account']]] = (out.byAccount[r[C['Account']]] || 0) + aed;
    } else if (r[C['Type']] === 'Income') out.income += aed;
  });
  var a = allowanceOf_(rows, cycle, s, readPlan_());
  out.allowanceUsed = a.used;
  out.allowanceLeft = a.left;
  return out;
}

/* The allowance, same rules as the app (docs/js/model.js allowanceOf):
   transfers are reallocating, never spending; a refund into the allowance account gives the money
   back; a top-up (main → allowance beyond the planned move) adds to the cycle it lands in, and
   whatever of it is unspent at payday carries into the next cycle. */
function allowanceOf_(rows, cycle, s, plan) {
  var moves = (plan || []).filter(function (p) { return p.kind === 'Move' && p.to === s.allowanceAccount; });
  if (!moves.length) moves = [{ id: 'allowance', amount: s.allowance, day: null }];
  var people = peopleSet_();
  var now = allowanceCycle_(rows, cycle, s, moves, people);
  var prev = allowanceCycle_(rows, shiftCycle_(cycle, -1), s, moves, people);
  var carryIn = Math.round(Math.min(prev.topUps, Math.max(0, s.allowance + prev.topUps - prev.used)) * 100) / 100;
  var pot = s.allowance + now.topUps + carryIn;
  return { used: now.used, topUps: now.topUps, carryIn: carryIn, pot: pot, left: pot - now.used };
}

function allowanceCycle_(rows, cycle, s, moves, people) {
  var acc = s.allowanceAccount, hub = s.emergencyAccount;
  var spent = 0, refunds = 0, topUps = 0, lent = 0;
  people = people || {};
  rows.forEach(function (r) {
    if (String(r[C['Cycle']]) !== cycle) return;
    var aed = Number(r[C['Amount (AED)']]) || 0, type = r[C['Type']], from = r[C['Account']], to = r[C['To account']];
    var source = String(r[C['Source']] || '');
    if (type === 'Spend' && from === acc) spent += aed;
    else if (type === 'Income' && from === acc && r[C['Category']] === 'Refund') refunds += aed;
    // lending to a person (or their share of a split) from the allowance card uses allowance; being paid back is a top-up
    else if (type === 'Transfer' && from === acc && people[to]) lent += aed;
    else if (type === 'Transfer' && to === acc && people[from]) topUps += aed;
    else if (type === 'Transfer' && acc !== hub) {
      if (from === hub && to === acc) {
        var planned = moves.some(function (p) {
          if (source === 'Plan:' + p.id) return true;
          if (source.indexOf('Plan:') === 0 || !(p.amount > 0) || aed < p.amount * 0.95) return false;
          if (!p.day) return true;
          var d = r[C['Date']] instanceof Date ? r[C['Date']] : new Date(r[C['Date']]);
          return Utilities.formatDate(d, TZ, 'yyyy-MM-dd') >= dueDayKey_(cycle, p.day, s.cycleStart);
        });
        if (!planned) topUps += aed;
      } else if (from === acc && to === hub && source.indexOf('Plan:') !== 0) topUps -= aed;
    }
  });
  topUps = Math.max(0, topUps);
  return { spent: spent, refunds: refunds, topUps: topUps, lent: lent, used: Math.max(0, spent + lent - refunds) };
}

/** People (money owed): account names listed in the app's `people` extra, as { name: true }.
    Empty when there's no Extras tab or no people, so older sheets behave exactly as before. */
function peopleSet_() {
  var set = {};
  try {
    var p = readExtras_().people;
    (p && Array.isArray(p.names) ? p.names : []).forEach(function (n) { if (typeof n === 'string' && n) set[n] = true; });
  } catch (err) { /* unreadable extras: no people */ }
  return set;
}

function shiftCycle_(cycle, delta) {
  var p = cycle.split('-').map(Number), y = p[0], m = p[1] + delta;
  while (m > 12) { m -= 12; y += 1; }
  while (m < 1) { m += 12; y -= 1; }
  return y + '-' + (m < 10 ? '0' : '') + m;
}

/** "yyyy-MM-dd" of day-of-month `day` inside `cycle`. */
function dueDayKey_(cycle, day, startDay) {
  var p = cycle.split('-').map(Number), y = p[0], m = p[1];
  if (startDay > 1 && day >= startDay) { m -= 1; if (m < 1) { m = 12; y -= 1; } }
  var last = new Date(Date.UTC(y, m, 0)).getUTCDate(), d = Math.min(day, last);
  return y + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;
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
    // a refund into the allowance account gives that money back
    ['Allowance left', '=Settings!B2-SUMIFS(' + aed + ',' + cy + ',' + cyc + ',' + typ + ',"Spend",' + acc + ',Settings!B3)+SUMIFS(' + aed + ',' + cy + ',' + cyc + ',' + typ + ',"Income",' + acc + ',Settings!B3,' + cat + ',"Refund")'],
    ['Needs review', '=COUNTIFS(' + cy + ',' + cyc + ',' + sts + ',"Review")'],
  ];
  sh.getRange(4, 1, summary.length, 2).setValues(summary);
  sh.getRange('A4:A9').setFontColor(MUTED);
  sh.getRange('B4:B8').setNumberFormat('"AED "#,##0.00').setFontWeight('bold');
  sh.getRange('B4').setFontColor('#1f9d55');
  sh.getRange('B8').setFontColor(TINT);

  sh.getRange('D3:F3').setValues([['Spending by category', 'AED', 'Share']]);
  var cats = spendCategories_(); // built-ins plus your own from the app
  var catRows = cats.map(function (c, i) {
    var r = 4 + i;
    return [c, '=SUMIFS(' + aed + ',' + cy + ',' + cyc + ',' + typ + ',"Spend",' + cat + ',"' + String(c).replace(/"/g, '""') + '")', '=IF($B$5=0,0,E' + r + '/$B$5)'];
  });
  catRows.push(['Uncategorised', '=SUMIFS(' + aed + ',' + cy + ',' + cyc + ',' + typ + ',"Spend",' + cat + ',"")', '=IF($B$5=0,0,E' + (4 + cats.length) + '/$B$5)']);
  sh.getRange(4, 4, catRows.length, 3).setValues(catRows);
  sh.getRange(4, 5, catRows.length, 1).setNumberFormat('#,##0.00');
  sh.getRange(4, 6, catRows.length, 1).setNumberFormat('0%');

  var accTop = 4 + catRows.length + 2;
  sh.getRange(accTop, 4, 1, 3).setValues([['By account', 'Spent', 'Received']]);
  var accRows = activeNames_().map(function (a) {
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
    .addRange(sh.getRange(4, 4, cats.length, 2))
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
  var fixed = [OVERVIEW, LEDGER, ACCOUNTS_TAB, SETTINGS, MERCHANTS, PLAN];
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
  var cat = L + 'J:J';
  sh.getRange('E5').setFormula('=MAP(A5:A200,LAMBDA(c,IF(c="",,Settings!B2-SUMIFS(' + aed + ',' + cy + ',c,' + typ + ',"Spend",' + acc + ',Settings!B3)+SUMIFS(' + aed + ',' + cy + ',c,' + typ + ',"Income",' + acc + ',Settings!B3,' + cat + ',"Refund"))))');
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
  // an iPhone set to Arabic digits sends "٤٢٫٥٠": make it "42.50"
  s = s.replace(/[٠-٩]/g, function (d) { return String(d.charCodeAt(0) - 0x660); })
    .replace(/[۰-۹]/g, function (d) { return String(d.charCodeAt(0) - 0x6F0); })
    .replace(/٫/g, '.').replace(/٬/g, ',');
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

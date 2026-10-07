// Verification: is undo exact for every mutation? Runs the real docs/js/store.js in Node
// (not connected, not demo → no network), snapshots entries/plan/accounts/settings before a
// mutation and after its undo, and diffs them.
// Usage: node tests/verify-undo.mjs
globalThis.location = { search: '' };
const store = await import('../docs/js/store.js');
const model = await import('../docs/js/model.js');
const { state, addEntry, updateEntry, deleteEntry, saveSettings, savePlan, addAccount, updateAccount, removeAccount, undo, canUndo, setDemo } = store;

let fails = 0, findings = 0;
const ok = (c, m, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}${x ? '  ' + x : ''}`); if (!c) fails++; };
const finding = (m) => { console.log(`FINDING ${m}`); findings++; };

const snap = () => JSON.parse(JSON.stringify({
  entries: [...state.entries].sort((a, b) => (a.id < b.id ? -1 : 1)),
  plan: state.plan, accounts: state.accounts, settings: state.settings,
}));
function diff(a, b, path = '') {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].flatMap((k) => diff(a[k], b[k], `${path}.${k}`));
  }
  return [`${path}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`];
}
function check(name, mutate, { expectExact = true } = {}) {
  const before = snap();
  const h0 = canUndo();
  mutate();
  const mid = snap();
  const changed = diff(before, mid).length > 0;
  undo();
  const after = snap();
  const d = diff(before, after);
  if (expectExact) ok(changed && d.length === 0, `undo exact: ${name}`, d.length ? `\n        ${d.slice(0, 6).join('\n        ')}` : changed ? '' : '(mutation changed nothing!)');
  return d;
}

// seed: a realistic ledger, as it would come back from the sheet
const T = (iso) => new Date(iso).toISOString();
const seed = [
  { id: 's1', date: T('2026-09-20T10:00:00+04:00'), type: 'Adjustment', amount: 1500, currency: 'AED', account: 'ADIB', toAccount: '', category: '', merchant: '', note: 'Matched with bank', source: 'App', status: 'OK' },
  { id: 's2', date: T('2026-09-20T10:00:00+04:00'), type: 'Adjustment', amount: 200, currency: 'AED', account: 'BOTIM', toAccount: '', category: '', merchant: '', note: 'Matched with bank', source: 'App', status: 'OK' },
  { id: 's3', date: T('2026-09-27T08:00:00+04:00'), type: 'Income', amount: 6000, currency: 'AED', account: 'ADIB', toAccount: '', category: 'Salary', merchant: 'Salary', note: '', source: 'Plan:salary', status: 'OK' },
  { id: 's4', date: T('2026-09-27T12:00:00+04:00'), type: 'Transfer', amount: 3000, currency: 'AED', account: 'ADIB', toAccount: 'ADCB', category: '', merchant: '', note: 'Allowance', source: 'Plan:allowance', status: 'OK' },
  { id: 's5', date: T('2026-10-01T12:00:00+04:00'), type: 'Spend', amount: 120, currency: 'AED', account: 'ADCB', toAccount: '', category: 'Groceries', merchant: 'Carrefour', note: '', source: 'Apple Pay', status: 'OK' },
  // USD entry whose AED value came from the bank statement / an older rate (3.6765), not today's 3.6725
  { id: 's6', date: T('2026-10-02T12:00:00+04:00'), type: 'Spend', amount: 20, currency: 'USD', amountAED: 73.53, account: 'BOTIM', toAccount: '', category: 'Shopping', merchant: 'Steam', note: '', source: 'Apple Pay', status: 'OK' },
  // Apple Pay row flagged Review by the sheet because the card was unknown, though it has a category
  { id: 's7', date: T('2026-10-03T12:00:00+04:00'), type: 'Spend', amount: 33, currency: 'AED', account: 'ADCB', toAccount: '', category: 'Food & Drinks', merchant: 'Salt', note: '', source: 'Apple Pay', status: 'Review' },
].map((e) => ({ ...e, cycle: model.cycleOf(e.date, 27), amountAED: e.amountAED ?? e.amount }));
state.entries = seed.map((e) => ({ ...e }));
state.plan = [...model.DEFAULT_PLAN.map((p) => ({ ...p })), { id: 'botim', name: 'BOTIM top-up', kind: 'Move', amount: 400, day: 28, from: 'ADIB', to: 'BOTIM', category: '' }];

console.log('── Entries ──');
check('add spend', () => addEntry({ type: 'Spend', amount: 42, account: 'ADCB', category: 'Food & Drinks', merchant: 'Talabat' }));
ok(state.outbox.length === 0, `outbox after add+undo is empty (${state.outbox.length})`);
check('edit amount/category/account/date', () => updateEntry('s5', { amount: 99, category: 'Shopping', account: 'BOTIM', date: T('2026-10-27T01:00:00+04:00') }));
check('delete', () => deleteEntry('s5'));
const outAfterDel = state.outbox.map((o) => o.op).join(',');
check('swipe-delete (same deleteEntry path)', () => deleteEntry('s3'));
check('bank match / adjustment', () => addEntry({ type: 'Adjustment', amount: -17.5, account: 'ADCB', note: 'Matched with bank', source: 'App' }));
check('payday "It landed" (runPlan → addEntry Income tagged Plan:nafis)', () => addEntry({ type: 'Income', amount: 4500, account: 'ADIB', category: 'Nafis', merchant: 'Nafis', source: 'Plan:nafis' }));
check('payday "Move now" (runPlan → addEntry Transfer)', () => addEntry({ type: 'Transfer', amount: 400, account: 'ADIB', toAccount: 'BOTIM', note: 'BOTIM top-up', source: 'Plan:botim' }));
let d = check('edit note on a USD entry with a sheet-supplied AED value', () => updateEntry('s6', { note: 'gift card' }), { expectExact: false });
if (d.length) finding(`BUG undo-usd: editing only the note of a USD entry re-prices it at today’s rate (store.js:151 finalize() always recomputes amountAED), and undo does not restore it: ${d.join('; ')}`);
d = check('edit note on an Apple Pay row the sheet flagged Review', () => updateEntry('s7', { note: 'lunch' }), { expectExact: false });
if (d.length) finding(`MINOR undo-status: an edit recomputes status (Review → OK) and undo leaves it: ${d.join('; ')}`);

console.log('── Plan & settings ──');
check('plan edit: allowance move 3000 → 3500 (settings.allowance follows)', () => savePlan(state.plan.map((p) => (p.id === 'allowance' ? { ...p, amount: 3500 } : p))));
check('plan: remove an item', () => savePlan(state.plan.filter((p) => p.id !== 'fuel')));
{
  // a plan with no allowance move, then the owner adds one for 2000
  const noMove = state.plan.filter((p) => p.id !== 'allowance');
  savePlan(noMove);
  const before = snap();
  savePlan([...noMove, { id: 'alw2', name: 'Allowance', kind: 'Move', amount: 2000, day: 27, from: 'ADIB', to: 'ADCB', category: '' }]);
  undo();
  const dd = diff(before, snap());
  if (dd.length) finding(`BUG undo-plan-allowance: adding an allowance Move where none existed sets settings.allowance=2000; undo restores the plan but not the allowance (store.js:247-248 only syncs when the restored plan has a positive move): ${dd.join('; ')}`);
  undo(); // restore the allowance move
}
check('settings: cycle start 27 → 25 (re-tags entry cycles)', () => saveSettings({ cycleStart: 25 }));
check('settings: USD rate', () => saveSettings({ usdRate: 3.7 }));
check('settings: allowance account', () => saveSettings({ allowanceAccount: 'BOTIM' }));

console.log('── Accounts ──');
check('account add', () => addAccount({ name: 'Wio', note: 'Savings', color: 'blue' }));
check('account rename BOTIM → Botim Pay (entries, plan, settings follow)', () => updateAccount('BOTIM', { name: 'Botim Pay', note: 'Extra card', color: 'purple', wallet: 'botim' }));
check('account rename the allowance account ADCB → ADCB Card', () => updateAccount('ADCB', { name: 'ADCB Card', note: 'Personal allowance', color: 'red', wallet: 'adcb' }));
check('account recolour only', () => updateAccount('Cash', { name: 'Cash', note: 'Notes & coins', color: 'gold', wallet: '' }));
{
  const bal = model.balances(state.entries, state.settings).get('BOTIM').balance;
  console.log(`      BOTIM balance before removal: ${bal}`);
  check('account remove with closing transfer + plan cascade (BOTIM top-up move dropped)', () => removeAccount('BOTIM', 'ADIB'));
  // negative balance account
  addEntry({ type: 'Spend', amount: 50, account: 'Cash', category: 'Other' });
  check('account remove with a NEGATIVE balance (covering transfer)', () => removeAccount('Cash', 'ADIB'));
  undo();
}

console.log('── Repeated undo (10 mixed actions, then 10 undos) ──');
{
  const before = snap();
  const a = addEntry({ type: 'Spend', amount: 10, account: 'ADCB', category: 'Groceries', merchant: 'Spinneys' });
  updateEntry(a.id, { amount: 11 });
  deleteEntry('s4');
  saveSettings({ cycleStart: 1 });
  savePlan(state.plan.map((p) => (p.id === 'allowance' ? { ...p, amount: 2500 } : p)));
  addAccount({ name: 'Wio', note: '', color: 'blue' });
  updateAccount('Wio', { name: 'Wio Save', note: '', color: 'blue', wallet: '' });
  addEntry({ type: 'Transfer', amount: 100, account: 'ADIB', toAccount: 'Wio Save' });
  removeAccount('Wio Save', 'ADIB');
  addEntry({ type: 'Adjustment', amount: 5, account: 'ADIB', note: 'Matched with bank' });
  let k = 0; while (canUndo() && k < 10) { undo(); k++; }
  const dd = diff(before, snap());
  ok(dd.length === 0 && k === 10, `10 undos return to the exact starting state (undid ${k})`, dd.slice(0, 5).join('; '));
}

console.log('── Undo across demo mode ──');
{
  const realIds = new Set(state.entries.map((e) => e.id));
  while (canUndo()) undo();
  setDemo(true);
  const demoEntry = state.entries.find((e) => e.type === 'Spend');
  deleteEntry(demoEntry.id); // in demo
  setDemo(false);
  const outBefore = state.outbox.length;
  undo();
  const leaked = state.entries.some((e) => e.id === demoEntry.id) && !realIds.has(demoEntry.id);
  const queued = state.outbox.slice(outBefore).some((o) => o.op === 'add' && o.id === demoEntry.id);
  if (leaked) finding(`BUG undo-demo-leak: undo history survives leaving demo mode — deleting demo entry ${demoEntry.id} in demo, exiting demo, then Undo inserts it into the REAL ledger${queued ? ' and queues an "add" to the Google Sheet outbox' : ''} (store.js:345-358 setDemo never clears history)`);
  else ok(true, 'demo undo isolated');
}

console.log(`\n${fails} failed checks, ${findings} findings`);
process.exitCode = fails ? 1 : 0;

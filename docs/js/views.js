// Bits every screen shares: an entry row, the sync badge, the large title with undo, the demo banner.
import { categoryMeta, seriesColor, accountMeta, fmt, timeLabel, toAED, amtAED } from './model.js';
import { state, isConnected, isDemo, undo, canUndo, lastAction } from './store.js';
import { toast, haptic, esc } from './ui.js';
import { t, ltr } from './i18n.js';
import { icon } from './icons.js';

/** One entry as a list row. Pass { selected } in Activity's Select mode to draw a tick circle instead of swipe-to-delete. */
export function entryRow(e, pick) {
  const sel = pick ? ` selecting${pick.selected ? ' picked' : ''}` : '';
  const aria = pick ? ` aria-pressed="${!!pick.selected}"` : '';
  const tick = pick ? `<span class="pick" aria-hidden="true">${pick.selected ? icon('check', { size: 15 }) : ''}</span>` : '';
  if (e.type === 'Adjustment') {
    const v = +e.amount || 0;
    return `<div class="swipe" data-id="${esc(e.id)}"><button class="swipe-del" type="button" tabindex="-1" aria-hidden="true">${icon('trash', { size: 20 })}<span>${t('row.del')}</span></button><button class="row entry adj${sel}" type="button" data-id="${esc(e.id)}"${aria}>
    ${tick}<span class="row-icon" style="--tint:${accountMeta(e.account).color}">${icon('sync', { size: 20 })}</span>
    <span class="row-main"><span class="row-title">${t('row.checked')}</span><span class="row-sub"><bdi>${esc(e.account)}</bdi> · ${timeLabel(e.date)}</span></span>
    <span class="row-amt num tr" role="text" aria-label="${v === 0 ? t('row.matchedSaid') : t(v > 0 ? 'row.adjPlus' : 'row.adjMinus', { amt: amtAED(fmt(Math.abs(v), { fixed: true })) })}">${v === 0 ? t('row.matched') : `${v > 0 ? '+' : '−'}${fmt(Math.abs(v), { fixed: true })}`}</span>
  </button></div>`;
  }
  const isIn = e.type === 'Income', isTr = e.type === 'Transfer';
  const meta = isTr ? null : categoryMeta(e.category, e.type);
  const tint = isTr ? 'var(--label-2)' : isIn ? 'var(--good)' : meta ? seriesColor(meta.slot) : 'var(--warn)';
  const ic = isTr ? 'transfer' : meta ? meta.icon : e.status === 'Review' ? 'tray' : 'dots';
  const title = e.merchant || (isTr ? `${e.account} → ${e.toAccount}` : categoryMeta(e.category, e.type)?.label || e.category || t('row.uncat'));
  const bits = [];
  if (isTr) bits.push(t('type.Transfer')); else bits.push(meta ? esc(meta.label) : e.category ? esc(e.category) : `<span class="needs">${t('row.needsCat')}</span>`);
  // names and notes are user data in any script: each is its own bidi isolate (<bdi>) inside the line
  if (!isTr) bits.push(`<bdi>${esc(accountMeta(e.account).name)}</bdi>`);
  else if (e.merchant) bits.push(`<bdi>${esc(e.account)} → ${esc(e.toAccount)}</bdi>`);
  bits.push(timeLabel(e.date));
  const amt = ltr(`${isIn ? '+' : ''}${e.currency === 'USD' ? '$' : ''}${fmt(e.amount, { fixed: true })}`);
  // what a screen reader says for the amount: the verb, the currency and the number ("spent AED 37.50")
  const amtSaid = e.currency === 'USD' ? t('row.usdSaid', { n: fmt(e.amount, { fixed: true }), aed: amtAED(fmt(toAED(e, state.settings), { fixed: true })) }) : amtAED(fmt(e.amount, { fixed: true }));
  const said = t(isIn ? 'row.received' : isTr ? 'row.moved' : 'row.spent', { amt: amtSaid });
  return `<div class="swipe" data-id="${esc(e.id)}"><button class="swipe-del" type="button" tabindex="-1" aria-hidden="true">${icon('trash', { size: 20 })}<span>${t('row.del')}</span></button><button class="row entry${e.status === 'Review' ? ' review' : ''}${sel}" type="button" data-id="${esc(e.id)}"${aria}>
    ${tick}<span class="row-icon" style="--tint:${tint}">${icon(ic, { size: 20 })}</span>
    <span class="row-main"><span class="row-title">${esc(title)}</span><span class="row-sub">${bits.join(' · ')}${e.note ? ` · <bdi class="row-note">${esc(e.note)}</bdi>` : ''}</span></span>
    <span class="row-amt num ${isIn ? 'in' : isTr ? 'tr' : ''}" role="text" aria-label="${said}">${amt}${e.currency === 'USD' ? `<small>≈ ${amtAED(fmt(toAED(e, state.settings), { fixed: true }))}</small>` : ''}</span>
  </button></div>`;
}

export function syncBadge() {
  if (isDemo()) return `<button class="sync-badge demo" type="button" data-go="settings">${t('sync.demo')}</button>`;
  if (!isConnected()) return `<button class="sync-badge off" type="button" data-go="settings">${icon('link', { size: 15 })}${t('sync.connect')}</button>`;
  const s = state.sync.status;
  const pending = state.outbox.length;
  if (s === 'syncing') return `<span class="sync-badge spin" role="status">${icon('sync', { size: 15 })}${t('sync.syncing')}</span>`;
  if (s === 'error') return `<button class="sync-badge err" type="button" data-act="sync" title="${esc(state.sync.error)}">${icon('warn', { size: 15 })}${pending ? `${t('sync.waiting', { n: pending })}` : t('sync.retry')}</button>`;
  if (pending) return `<button class="sync-badge pend" type="button" data-act="sync">${icon('sync', { size: 15 })}${t('sync.waiting', { n: pending })}</button>`;
  return `<button class="sync-badge ok" type="button" data-act="sync" aria-label="${t('sync.okLabel')}">${icon('check', { size: 15 })}${t('sync.synced')}</button>`;
}

export function largeTitle(title, sub = '', right = '') {
  return `<header class="large-title"><div><h1>${title}</h1>${sub ? `<p class="lt-sub">${sub}</p>` : ''}</div><div class="lt-right"><span class="undo-slot">${undoButton()}</span>${right}</div></header>`;
}
export function undoButton() {
  return canUndo() ? `<button type="button" class="undo-btn" data-act="undo" aria-label="${t('undo.label', { what: esc(lastAction()) })}" title="${t('undo.label', { what: esc(lastAction()) })} (⌘Z)">${icon('undo', { size: 18 })}</button>` : '';
}
export function doUndo() {
  if (!canUndo()) return;
  haptic();
  const label = undo();
  toast(t('undo.done', { what: esc(label) }), { icon: icon('undo', { size: 18 }) });
}

export function demoBanner() {
  return isDemo() ? `<div class="banner demo-banner">${icon('sparkle', { size: 18 })}<span>${t('demo.banner')}</span><button type="button" class="text-btn" data-act="exit-demo">${t('demo.exit')}</button></div>` : '';
}

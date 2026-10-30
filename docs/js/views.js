// Bits every screen shares: an entry row, the sync badge, the large title with undo, the demo banner.
import { categoryMeta, seriesColor, accountMeta, fmt, timeLabel, toAED } from './model.js';
import { state, isConnected, isDemo, undo, canUndo, lastAction } from './store.js';
import { toast, haptic, esc } from './ui.js';
import { icon } from './icons.js';

export function entryRow(e) {
  if (e.type === 'Adjustment') {
    const v = +e.amount || 0;
    return `<div class="swipe" data-id="${esc(e.id)}"><button class="swipe-del" type="button" tabindex="-1" aria-hidden="true">${icon('trash', { size: 20 })}<span>Delete</span></button><button class="row entry adj" type="button" data-id="${esc(e.id)}">
    <span class="row-icon" style="--tint:${accountMeta(e.account).color}">${icon('sync', { size: 20 })}</span>
    <span class="row-main"><span class="row-title">Checked with bank</span><span class="row-sub">${esc(e.account)} · ${timeLabel(e.date)}</span></span>
    <span class="row-amt num tr">${v === 0 ? '✓ matched' : `${v > 0 ? '+' : '−'}${fmt(Math.abs(v), { fixed: true })}`}</span>
  </button></div>`;
  }
  const isIn = e.type === 'Income', isTr = e.type === 'Transfer';
  const meta = isTr ? null : categoryMeta(e.category, e.type);
  const tint = isTr ? 'var(--label-2)' : isIn ? 'var(--good)' : meta ? seriesColor(meta.slot) : 'var(--warn)';
  const ic = isTr ? 'transfer' : meta ? meta.icon : e.status === 'Review' ? 'tray' : 'dots';
  const title = e.merchant || (isTr ? `${e.account} → ${e.toAccount}` : e.category || 'Uncategorised');
  const bits = [];
  if (isTr) bits.push('Transfer'); else bits.push(e.category || '<span class="needs">Needs category</span>');
  if (!isTr) bits.push(esc(accountMeta(e.account).name));
  else if (e.merchant) bits.push(`${esc(e.account)} → ${esc(e.toAccount)}`);
  bits.push(timeLabel(e.date));
  const amt = `${isIn ? '+' : ''}${e.currency === 'USD' ? '$' : ''}${fmt(e.amount, { fixed: true })}`;
  return `<div class="swipe" data-id="${esc(e.id)}"><button class="swipe-del" type="button" tabindex="-1" aria-hidden="true">${icon('trash', { size: 20 })}<span>Delete</span></button><button class="row entry${e.status === 'Review' ? ' review' : ''}" type="button" data-id="${esc(e.id)}">
    <span class="row-icon" style="--tint:${tint}">${icon(ic, { size: 20 })}</span>
    <span class="row-main"><span class="row-title">${esc(title)}</span><span class="row-sub">${bits.join(' · ')}${e.note ? ` · <span class="row-note">${esc(e.note)}</span>` : ''}</span></span>
    <span class="row-amt num ${isIn ? 'in' : isTr ? 'tr' : ''}">${amt}${e.currency === 'USD' ? `<small>≈ AED ${fmt(toAED(e, state.settings), { fixed: true })}</small>` : ''}</span>
  </button></div>`;
}

export function syncBadge() {
  if (isDemo()) return `<button class="sync-badge demo" type="button" data-go="settings">Demo</button>`;
  if (!isConnected()) return `<button class="sync-badge off" type="button" data-go="settings">${icon('link', { size: 15 })}Connect</button>`;
  const s = state.sync.status;
  const pending = state.outbox.length;
  if (s === 'syncing') return `<span class="sync-badge spin" role="status">${icon('sync', { size: 15 })}Syncing</span>`;
  if (s === 'error') return `<button class="sync-badge err" type="button" data-act="sync" title="${esc(state.sync.error)}">${icon('warn', { size: 15 })}${pending ? `${pending} waiting` : 'Retry'}</button>`;
  if (pending) return `<button class="sync-badge pend" type="button" data-act="sync">${icon('sync', { size: 15 })}${pending} waiting</button>`;
  return `<button class="sync-badge ok" type="button" data-act="sync" aria-label="Synced. Tap to sync again">${icon('check', { size: 15 })}Synced</button>`;
}

export function largeTitle(title, sub = '', right = '') {
  return `<header class="large-title"><div><h1>${title}</h1>${sub ? `<p class="lt-sub">${sub}</p>` : ''}</div><div class="lt-right"><span class="undo-slot">${undoButton()}</span>${right}</div></header>`;
}
export function undoButton() {
  return canUndo() ? `<button type="button" class="undo-btn" data-act="undo" aria-label="Undo: ${esc(lastAction())}" title="Undo: ${esc(lastAction())} (⌘Z)">${icon('undo', { size: 18 })}</button>` : '';
}
export function doUndo() {
  if (!canUndo()) return;
  haptic();
  const label = undo();
  toast(`Undone · ${esc(label)}`, { icon: icon('undo', { size: 18 }) });
}

export function demoBanner() {
  return isDemo() ? `<div class="banner demo-banner">${icon('sparkle', { size: 18 })}<span><b>Demo data.</b> Made-up numbers so you can look around.</span><button type="button" class="text-btn" data-act="exit-demo">Exit</button></div>` : '';
}

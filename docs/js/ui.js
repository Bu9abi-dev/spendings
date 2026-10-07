// Motion + chrome primitives: spring easings, bottom sheets with drag-to-dismiss, toasts, haptics.

export const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * A spring as a CSS linear() easing. Apple's two-parameter model:
 * damping 1 = critically damped (no overshoot), response = seconds to (mostly) arrive.
 */
const springCache = new Map();
export function spring(damping = 1, response = 0.4) {
  const key = `${damping}/${response}`;
  if (springCache.has(key)) return springCache.get(key);
  const w0 = (2 * Math.PI) / response, z = damping, dt = 1 / 120;
  let x = 0, v = 0, t = 0;
  const pts = [0];
  while (t < 3) {
    const a = -w0 * w0 * (x - 1) - 2 * z * w0 * v;
    v += a * dt; x += v * dt; t += dt;
    pts.push(x);
    if (t > 0.1 && Math.abs(1 - x) < 0.0008 && Math.abs(v) < 0.01) break;
  }
  pts[pts.length - 1] = 1;
  const step = Math.max(1, Math.round(pts.length / 64));
  const sampled = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
  const out = { easing: `linear(${sampled.map((p) => +p.toFixed(4)).join(', ')})`, duration: Math.round(t * 1000) };
  springCache.set(key, out);
  return out;
}

/* ───── Haptics: iOS 18+ ticks a haptic when a native switch toggles. ───── */
let hapticLabel;
export function haptic() {
  try {
    if (navigator.vibrate) { navigator.vibrate(8); return; }
    if (!hapticLabel) {
      hapticLabel = document.createElement('label');
      hapticLabel.setAttribute('aria-hidden', 'true');
      hapticLabel.style.cssText = 'position:fixed;left:-100px;top:-100px;opacity:0;pointer-events:none';
      const input = document.createElement('input');
      input.type = 'checkbox'; input.setAttribute('switch', ''); input.tabIndex = -1;
      hapticLabel.appendChild(input);
      document.body.appendChild(hapticLabel);
    }
    hapticLabel.click();
  } catch { /* no haptics here */ }
}

/* ───── Toast ───── */
let toastTimer;
export function toast(text, { action, onAction, icon = '', tone = '' } = {}) {
  const host = document.getElementById('toast');
  clearTimeout(toastTimer);
  host.className = `toast glass ${tone}`;
  host.innerHTML = `${icon}<span class="toast-text">${text}</span>${action ? `<button class="toast-action" type="button">${action}</button>` : ''}`;
  host.hidden = false;
  requestAnimationFrame(() => host.classList.add('show'));
  if (action) host.querySelector('.toast-action').onclick = () => { onAction?.(); hide(); };
  const hide = () => { host.classList.remove('show'); setTimeout(() => { host.hidden = true; }, 300); };
  toastTimer = setTimeout(hide, action ? 5000 : 2600);
}

/* ───── Bottom sheet ───── */
const stack = [];

export function openSheet({ html, label = 'Sheet', onMount, onClose, tall = true }) {
  const layer = document.getElementById('sheets');
  const app = document.getElementById('app');
  const prevFocus = document.activeElement;

  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  const sheet = document.createElement('section');
  sheet.className = `sheet glass-solid${tall ? ' tall' : ''}`;
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', label);
  sheet.innerHTML = `<div class="grabber" aria-hidden="true"></div>${html}`;
  layer.append(backdrop, sheet);
  stack.push(sheet);
  document.documentElement.classList.add('sheet-open');
  app.classList.add('behind');

  let anim = null;
  const h = () => sheet.getBoundingClientRect().height;
  const currentY = () => new DOMMatrix(getComputedStyle(sheet).transform).m42;

  function animateTo(y, { velocity = 0, done } = {}) {
    const from = currentY();
    anim?.cancel();
    if (reduceMotion()) {
      sheet.style.transform = `translateY(${y}px)`;
      backdrop.style.opacity = y > 0 ? 0 : 1;
      done?.();
      return;
    }
    // momentum-carried moves get a touch of bounce; plain opens settle critically damped
    const sp = Math.abs(velocity) > 300 ? spring(0.85, 0.36) : spring(1, 0.42);
    anim = sheet.animate([{ transform: `translateY(${from}px)` }, { transform: `translateY(${y}px)` }], { duration: sp.duration, easing: sp.easing, fill: 'forwards' });
    backdrop.animate([{ opacity: getComputedStyle(backdrop).opacity }, { opacity: y > 0 ? 0 : 1 }], { duration: 260, easing: 'ease-out', fill: 'forwards' });
    anim.onfinish = () => { sheet.style.transform = `translateY(${y}px)`; anim?.cancel(); anim = null; done?.(); };
  }

  // Keep the sheet above the iPhone keyboard: shrink to the visible area and keep the focused field in view.
  const vv = window.visualViewport;
  const fit = () => {
    if (!vv) return;
    const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    sheet.style.setProperty('--kb', `${kb}px`);
    sheet.classList.toggle('kb-open', kb > 80);
  };
  vv?.addEventListener('resize', fit);
  vv?.addEventListener('scroll', fit);
  fit();
  sheet.addEventListener('focusin', (ev) => {
    if (!ev.target.matches('input, select, textarea')) return;
    setTimeout(() => ev.target.scrollIntoView({ block: 'nearest', behavior: reduceMotion() ? 'auto' : 'smooth' }), 280);
  });

  let closed = false;
  function close(velocity = 0) {
    if (closed) return;
    closed = true;
    vv?.removeEventListener('resize', fit);
    vv?.removeEventListener('scroll', fit);
    app.classList.toggle('behind', stack.length > 1);
    animateTo(h() + 40, {
      velocity,
      done: () => {
        backdrop.remove(); sheet.remove();
        stack.splice(stack.indexOf(sheet), 1);
        if (!stack.length) document.documentElement.classList.remove('sheet-open');
        prevFocus?.focus?.({ preventScroll: true });
        onClose?.();
      },
    });
  }

  sheet.style.transform = `translateY(${h() + 40}px)`;
  backdrop.style.opacity = 0;
  requestAnimationFrame(() => animateTo(0));

  // Drag to dismiss: 1:1 tracking from where you grabbed, velocity handoff, momentum projection.
  let drag = null;
  sheet.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const scroller = e.target.closest('.sheet-scroll');
    const onChrome = e.target.closest('.grabber, .sheet-head');
    if (!onChrome && !(scroller && scroller.scrollTop <= 0 && !e.target.closest('input, textarea, select, button, .keypad, .chips, .cat-grid'))) return;
    drag = { id: e.pointerId, y0: e.clientY, base: currentY(), hist: [[e.timeStamp, e.clientY]], active: false };
  });
  sheet.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y0;
    if (!drag.active) {
      if (dy < 6) { if (dy < -6) drag = null; return; }
      drag.active = true;
      anim?.cancel(); anim = null;
      sheet.setPointerCapture(e.pointerId);
    }
    let y = drag.base + dy;
    if (y < 0) y = -Math.sqrt(-y) * 2; // rubber-band past the top
    sheet.style.transform = `translateY(${y}px)`;
    backdrop.style.opacity = Math.max(0, 1 - y / h());
    drag.hist.push([e.timeStamp, e.clientY]);
    if (drag.hist.length > 6) drag.hist.shift();
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null;
    if (!d.active) return;
    const [t0, y0] = d.hist[0], [t1, y1] = d.hist[d.hist.length - 1];
    const v = t1 > t0 ? ((y1 - y0) / (t1 - t0)) * 1000 : 0; // px/s
    const y = currentY();
    const projected = y + ((v / 1000) * 0.998) / (1 - 0.998);
    if (projected > h() * 0.45 || v > 1100) close(v);
    else animateTo(0, { velocity: v });
  };
  sheet.addEventListener('pointerup', end);
  sheet.addEventListener('pointercancel', end);

  backdrop.addEventListener('click', () => close());
  sheet.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });

  onMount?.(sheet, close);
  setTimeout(() => (sheet.querySelector('[autofocus]') || sheet).focus?.({ preventScroll: true }), 30);
  sheet.tabIndex = -1;
  return { el: sheet, close };
}

/** Animate a number from its current text to a new value. */
export function rollNumber(el, to, format) {
  const from = +el.dataset.value || 0;
  el.dataset.value = to;
  if (reduceMotion() || from === to) { el.textContent = format(to); return; }
  const t0 = performance.now(), dur = 520;
  const tick = (t) => {
    const p = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - p, 4);
    el.textContent = format(from + (to - from) * e);
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

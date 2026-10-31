import { t } from './i18n.js';
// Appearance: theme mode, accent preset (drives the tint and the allowance liquid), and card colours.
// Every preset was contrast-checked in both themes: text ≥ 4.5:1 on its surface, button text ≥ 4.5:1 on the tint.

// [tint, tint as text, text on tint, liquid top, liquid bottom, text on liquid]
export const ACCENTS = [
  // v37 redesign: Apple's vivid system colours, each nudged just enough to keep the contrast promises above.
  // Ids stay the same so a saved choice keeps working; only the names shown changed (Slate is now "Blue").
  { id: 'slate', name: 'Blue', l: ['#0a6ee0', '#0062c9', '#ffffff', '#d4e6ff', '#9cc6ff', '#002a5c'], d: ['#3d9bff', '#5eb0ff', '#00142e', '#123c6e', '#0b2648', '#e6f1ff'] },
  { id: 'teal', name: 'Teal', l: ['#007f8c', '#00707b', '#ffffff', '#ccf0f2', '#8edde3', '#00393f'], d: ['#40c8e0', '#5ad4e8', '#00262c', '#0d4a52', '#073238', '#e0fafc'] },
  { id: 'sage', name: 'Green', l: ['#1a7f3a', '#17733a', '#ffffff', '#d3f5dc', '#9fe3b0', '#073a17'], d: ['#30d158', '#4cd96e', '#04260f', '#145a2a', '#0c3a1b', '#e5fbe9'] },
  { id: 'indigo', name: 'Indigo', l: ['#5856d6', '#4f4dcc', '#ffffff', '#e2e1fb', '#bdbbf5', '#22206a'], d: ['#7d7aff', '#9896ff', '#0e0d3a', '#33317a', '#211f52', '#eeeefe'] },
  { id: 'plum', name: 'Purple', l: ['#9a3fc4', '#8c36b5', '#ffffff', '#f1def9', '#ddb4f0', '#45165c'], d: ['#bf5af2', '#cd7cf5', '#2a0a3a', '#5a2a73', '#3b1a4d', '#f8ebfe'] },
  { id: 'rose', name: 'Pink', l: ['#d12a5c', '#bf2553', '#ffffff', '#fde0e8', '#f7b0c4', '#5c0f27'], d: ['#ff6482', '#ff8099', '#3a0a16', '#7a2a3c', '#521a28', '#ffeef2'] },
  { id: 'amber', name: 'Orange', l: ['#c25400', '#b04c00', '#ffffff', '#ffe6cc', '#ffc48a', '#4f2300'], d: ['#ff9f0a', '#ffb340', '#2e1a00', '#6e4210', '#4a2c08', '#fff3e0'] },
  { id: 'graphite', name: 'Graphite', l: ['#4a4f57', '#3d4148', '#ffffff', '#e4e6ea', '#c9cdd4', '#1f2227'], d: ['#adb3bc', '#c0c5cd', '#1a1c20', '#3e424a', '#2b2e34', '#f0f2f5'] },
];

// Vivid mid-tones that read on both white and black; icons on them stay ≥ 3:1.
export const CARD_COLORS = [
  { id: 'red', name: 'Red', hex: '#e5484d' },
  { id: 'orange', name: 'Orange', hex: '#d4690c' },
  { id: 'gold', name: 'Gold', hex: '#b58500' },
  { id: 'green', name: 'Green', hex: '#2fa84f' },
  { id: 'teal', name: 'Teal', hex: '#13a3a8' },
  { id: 'sky', name: 'Sky', hex: '#1f9bd6' },
  { id: 'blue', name: 'Blue', hex: '#2f7cf6' },
  { id: 'indigo', name: 'Indigo', hex: '#5e5ce6' },
  { id: 'purple', name: 'Purple', hex: '#a259e0' },
  { id: 'pink', name: 'Pink', hex: '#e0508f' },
  { id: 'graphite', name: 'Graphite', hex: '#7a7f88' },
];
// Colour names are shown in the current language (strings: color.<id>); ids are what's saved.
for (const x of [...ACCENTS, ...CARD_COLORS]) Object.defineProperty(x, 'name', { get: () => t(`color.${x.id}`), enumerable: true });

export const DEFAULT_APPEARANCE = {
  theme: 'system',
  accent: 'slate',
  cards: { 'Account 1': 'teal', 'Account 2': 'red', Cash: 'green' },
};

const KEYS = ['tint', 'text', 'on', 'lt', 'lb', 'ink'];

export function normalizeAppearance(a) {
  a = a || {};
  return {
    theme: ['system', 'light', 'dark'].includes(a.theme) ? a.theme : DEFAULT_APPEARANCE.theme,
    accent: ACCENTS.some((x) => x.id === a.accent) ? a.accent : DEFAULT_APPEARANCE.accent,
    cards: { ...DEFAULT_APPEARANCE.cards, ...(a.cards || {}) },
  };
}

export function applyAppearance(raw) {
  const a = normalizeAppearance(raw);
  const root = document.documentElement;
  if (a.theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = a.theme;

  const acc = ACCENTS.find((x) => x.id === a.accent);
  KEYS.forEach((k, i) => {
    root.style.setProperty(`--p-${k}-l`, acc.l[i]);
    root.style.setProperty(`--p-${k}-d`, acc.d[i]);
  });

  // status bar colour follows the page
  const dark = a.theme === 'dark' || (a.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', dark ? '#000000' : '#f2f2f7'));
  return a;
}

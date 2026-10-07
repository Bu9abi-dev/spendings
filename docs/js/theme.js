// Appearance: theme mode, accent preset (drives the tint and the allowance liquid), and card colours.
// Every preset was contrast-checked in both themes: text ≥ 4.5:1 on its surface, button text ≥ 4.5:1 on the tint.

// [tint, tint as text, text on tint, liquid top, liquid bottom, text on liquid]
export const ACCENTS = [
  { id: 'slate', name: 'Slate', l: ['#3d6ea8', '#2f5f99', '#ffffff', '#d6e4f5', '#aac4e6', '#16304f'], d: ['#86a6d4', '#9db8e0', '#101a29', '#33496a', '#223349', '#eef3fa'] },
  { id: 'teal', name: 'Teal', l: ['#2b7f80', '#1f6d6e', '#ffffff', '#d3ecea', '#a6d6d2', '#0f3b3a'], d: ['#74bdb6', '#8fd0ca', '#0d2422', '#285450', '#193836', '#e6f4f2'] },
  { id: 'sage', name: 'Sage', l: ['#4a7656', '#3f6a49', '#ffffff', '#dcebdc', '#b5d3b7', '#1d3a22'], d: ['#93bf9a', '#a6ceac', '#142417', '#34503a', '#213426', '#e9f3ea'] },
  { id: 'indigo', name: 'Indigo', l: ['#5257b8', '#4b50b3', '#ffffff', '#e0e1f7', '#c0c3ee', '#24275e'], d: ['#a3a6ec', '#b3b6f0', '#15163a', '#3d4076', '#282a50', '#eceefb'] },
  { id: 'plum', name: 'Plum', l: ['#844b89', '#7a427f', '#ffffff', '#efdff0', '#dcbcdf', '#3d1f40'], d: ['#cc9fd3', '#d6b0dc', '#2b142e', '#573c5c', '#3a263d', '#f5eaf6'] },
  { id: 'rose', name: 'Rose', l: ['#a84a61', '#a3455c', '#ffffff', '#f6dfe4', '#ebbcc7', '#4d1f2a'], d: ['#e69aab', '#eeb0bd', '#33141c', '#603742', '#42252d', '#fbecef'] },
  { id: 'amber', name: 'Amber', l: ['#93590f', '#8a530f', '#ffffff', '#f6e6cc', '#ebcd98', '#4a2d06'], d: ['#e0b26e', '#e8c38c', '#2e1e08', '#5c4625', '#3f3018', '#fbf1e2'] },
  { id: 'graphite', name: 'Graphite', l: ['#4a4f57', '#3d4148', '#ffffff', '#e4e6ea', '#c9cdd4', '#1f2227'], d: ['#adb3bc', '#c0c5cd', '#1a1c20', '#3e424a', '#2b2e34', '#f0f2f5'] },
];

// Mid-tones that read on both white and black; icons on them stay ≥ 3:1.
export const CARD_COLORS = [
  { id: 'red', name: 'Red', hex: '#cf4b47' },
  { id: 'orange', name: 'Orange', hex: '#c9692a' },
  { id: 'gold', name: 'Gold', hex: '#a87a17' },
  { id: 'green', name: 'Green', hex: '#47905a' },
  { id: 'teal', name: 'Teal', hex: '#2a8a84' },
  { id: 'sky', name: 'Sky', hex: '#3584a6' },
  { id: 'blue', name: 'Blue', hex: '#4a72b8' },
  { id: 'indigo', name: 'Indigo', hex: '#5f62c4' },
  { id: 'purple', name: 'Purple', hex: '#8360c2' },
  { id: 'pink', name: 'Pink', hex: '#bb5585' },
  { id: 'graphite', name: 'Graphite', hex: '#6b7078' },
];

export const DEFAULT_APPEARANCE = {
  theme: 'system',
  accent: 'slate',
  cards: { ADCB: 'red', ADIB: 'teal', BOTIM: 'purple', Cash: 'green' },
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

---
version: 1
slug: "docs-index-html"
primary_target: "docs/index.html"
related_targets: []
---

Scope: the whole app (docs/index.html): Home, Activity, Insights, Settings, the Add/Edit sheet, and the Lock screen. Visitor mode: Operate.
Audience and job: the owner, one-handed on an iPhone, logging money in and out and checking what's left of the ADCB allowance this cycle.
Direction was pinned by the user (Apple design language, Liquid Glass), so no concept roll was run.

## Direction contract
THESIS: An iOS-native money lens. It refuses the dashboard of stat cards; the first viewport answers one question, "what's left", with a liquid level.
OWN-WORLD:
- Base: Apple system grouped backgrounds, SF Pro / SF Rounded numerals, Apple system tints.
- Liquid Glass only on floating chrome: the capsule tab bar, a round add button, sheets, segmented controls, the lock screen.
- Lists are solid inset-grouped rows.
STORY: Open the app and see the allowance left as liquid in a glass capsule. Spend and watch it drain. The details follow below.
FIRST VIEWPORT:
- A large-title cycle name with its date range.
- The Allowance capsule: glass with a liquid fill and a gently moving surface, AED left in large rounded numerals, and a per-day pace.
- Money in, out and net as three plain figures.
- The review inbox, when there are entries to review.
SIGNATURE: The liquid capsule. Its level springs to the new value after each entry. The tab bar's glass droplet slides between tabs on a spring.
RISK: Heavy blur on scrolling content stutters. Glass is kept to fixed chrome, and the motion respects prefers-reduced-motion.

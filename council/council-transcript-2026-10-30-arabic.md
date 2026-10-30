# Council: Arabic / English toggle (branch claude/arabic), 30 Oct 2026

Two advisors: an Arabic UI copy reviewer (Opus) and the Outsider (RTL screenshots, Sonnet).

## Arabic copy (verdict: good MSA, fix before shipping)
- **المصروف means "allowance" in the Gulf** — the file also used it for "spending". Spending is now الصرف / صُرف / صرفت;
  المصروف is only the allowance.
- One verb root for spend (صرف, not أنفق); masculine agreement with amounts (مُرحَّل); gender-neutral wording for
  friends (الطرف الآخر, الاسم, الحصة); لك / عليك for owed; "حتى يُدفع القسط" (القسط is masculine); imperative تخطَّ;
  جديد هذه الدورة (cycles, not calendar months); رصيد سالب instead of مكشوف; معاملة instead of قيد for an entry.
- **Currency after the number in Arabic** («120 د.إ», like UAE bank apps); the minus stays inside the LTR isolate.

### Glossary
spend الصرف · income دخل / الوارد · transfer تحويل · allowance المصروف · safe to spend المتاح للصرف · cycle الدورة ·
payday يوم الراتب · budget ميزانية · limit حدّ · subscription اشتراك · BNPL اشترِ الآن وادفع لاحقًا (instalment قسط) ·
split تقسيم / حصة · owed لك / عليك · goal هدف · net worth صافي الثروة · category فئة · account حساب ·
entry معاملة · payment دفعة · undo تراجع

## RTL on iPhone (Outsider; verdict: ship after a small fix pass)
Works: mirrored tab bar, FAB, chevrons, headers, chips; LTR keypad and amounts; merchant names; flipped swipe; dark mode.
### Must fix
1. BNPL rows truncate the matched-payment line mid-date ("وُجدت: د.إ 200 · 11 أكتوبر ..."): wrap to two lines.
2. Mixed-direction rows cut Latin text from the wrong end ("...wance · 18:00"): isolate notes (`<bdi>`/`dir="auto"`,
   `unicode-bidi: plaintext` on the ellipsis element).
3. Report footnote joins two sentences without a space; "د.إ" and the number split across lines: join with a space,
   no-break space between currency and number everywhere amounts are formatted.
### Should fix
- Native date inputs show mm/dd/yyyy and a doubled calendar icon in Arabic.
- Pace chart legend glyph on the wrong side; y-axis labels crowd the dashed line.
- Demo labels left in English ("Car & phone"); "تحديد" and "إدارة" links need 44px hit areas.

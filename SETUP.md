# Setting up Spendings

Allow about 15 minutes, once. There are four parts:

1. **The Google Sheet**: it stores everything.
2. **The app**: hosted on GitHub Pages and installed on your iPhone.
3. **The Apple Pay Shortcut**: logs each payment as it happens.
4. **Optional:** Face ID lock.

---

## 1. The Google Sheet (5 min)

1. Open your empty Google Sheet. Rename it if you like, e.g. "Spendings".
2. Go to **Extensions → Apps Script**.
3. Delete the code that's there. Paste in **all** of [`apps-script/Code.gs`](apps-script/Code.gs) and press **Save** (💾).
4. In the function menu at the top, choose **`setup`** and press **Run**.
   - Google asks for permission. Choose **Review permissions**, then your account, then **Advanced**, then **Go to … (unsafe)**, then **Allow**.
   - It says "unsafe" only because you wrote the script yourself and Google hasn't reviewed it. It can only touch this one sheet.
5. Go back to the sheet. A popup shows your **app key**. Copy it somewhere for a minute. You can always see it again from the **Spendings → Show my app key** menu in the sheet.
6. Back in Apps Script, click **Deploy → New deployment**:
   - Click the gear icon ⚙ and choose **Web app**.
   - **Execute as:** Me.
   - **Who has access:** Anyone. The app key is what keeps strangers out.
   - Click **Deploy** and copy the **Web app URL**. It ends in `/exec`.

The sheet now has these tabs:

| Tab | What it is |
| --- | --- |
| **Overview** | One row per pay cycle: money in, money out, net, allowance left, and how many entries need review. |
| **Oct 2026**, **Nov 2026**… | One tab per cycle (27th → 26th), named after the month the cycle ends in. Each has totals, a category table with a donut chart, a per-account table, and every entry. New tabs appear automatically. |
| **Ledger** | Every entry, one row each. This is the true record, and every other tab is calculated from it. You can fix typos here by hand. |
| **Settings** | Allowance (3,000), allowance card (ADCB), emergency card (ADIB), cycle start day (27), USD rate (3.6725), and how Wallet card names map to your cards. |
| **Merchants** | Merchant → category pairs the app has learned, e.g. Carrefour → Groceries. |

> **If you change the script later:** use **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**. This keeps the same URL. A *New deployment* would give you a new URL.

## 2. The app (5 min)

### Host it on GitHub Pages
1. Merge this branch into `main`.
2. In the repo on GitHub, open **Settings → Pages**. Set **Source** to *Deploy from a branch*, choose **`main`** and **`/docs`**, then **Save**.
3. After a minute the app is live at **https://bu9abi-dev.github.io/spendings/**.

> **Private repo:** GitHub Pages for a private repo needs a paid plan (GitHub Pro). The Pages *site* is still reachable by anyone who knows the URL, but it holds no data. Your numbers live only in your Google Sheet, behind your app key.

### Install it on your iPhone
1. Open the link in **Safari**.
2. Tap **Share → Add to Home Screen → Add**.
3. Open **Spendings** from your Home Screen, go to **Settings**, paste the **Web app URL** and **app key**, then tap **Connect**. You should see "Connected to …".

## 3. The Apple Pay Shortcut (5 min)

These steps are also in the app, with copy buttons, under **Settings → Log Apple Pay payments**.

1. Open **Shortcuts**, go to the **Automation** tab, tap **+**, and choose **Transaction**.
2. Under **Cards**, pick **ADIB**, **ADCB** and **BOTIM**. Choose **Run Immediately** and turn **Notify When Run** off. Tap **Next**, then **Create New Shortcut**.
3. Add a **Choose from List** action. Its list has one item per line:
   `Food & Drinks`, `Transport & Fuel`, `Groceries`, `Entertainment`, `Shopping`, `Travel`, `Bills & Subscriptions`, `Health`, `Family & Gifts`, `Other`, `Decide later`.
   Set the prompt to "What was it for?".
4. Add **Get Contents of URL**:
   - **URL:** your Web app URL.
   - **Method:** POST. **Request Body:** JSON.
   - Add these fields, all of type **Text**:

     | Key | Value |
     | --- | --- |
     | `token` | your app key |
     | `source` | `applepay` |
     | `amount` | Shortcut Input → **Amount** |
     | `merchant` | Shortcut Input → **Merchant** |
     | `card` | Shortcut Input → **Card** (sometimes shown as **Name**) |
     | `category` | **Chosen Item** |
5. Add **Get Dictionary Value**. Set it to get the **Value** for key `message` in **Contents of URL**.
6. Add **Show Notification** with **Dictionary Value** as the text.

When you next pay with Apple Pay, you pick a category and get a notification like:

> AED 42 · Carrefour · ADCB
> AED 1,380 left of your allowance

**What happens to each payment:**
- **Zero taps:** skip step 3 and type `Decide later` as the category. Merchants you've filed before are categorised automatically. The rest go to **Needs review** on the app's Home screen.
- **Duplicates:** if the automation fires twice for one payment, the duplicate is ignored.
- **USD payments:** stored in USD and converted at 3.6725.
- **Other currencies:** saved too, but sent to Needs review so you can check the AED amount.
- **Unrecognised card names:** if a card's Wallet name doesn't contain "ADIB", "ADCB" or "BOTIM", add a row to the mapping table in the sheet's **Settings** tab.
- **No signal:** the Shortcut can't reach the sheet and shows an error. Add that payment with **+** in the app later. The app itself queues entries offline and syncs them when you're back online.

## 4. Face ID lock (optional)

In the app, go to **Settings → Lock with Face ID**. The app then asks for Face ID when you open it, and again after it has been in the background for over a minute. This is a privacy screen on your phone; the real protection for your data is the app key.

---

## Troubleshooting

| You see | Do this |
| --- | --- |
| "Wrong app key" | Copy it again from **Spendings → Show my app key** in the sheet. Paste it into the app and into the Shortcut's `token` field. |
| "Couldn't reach the sheet" | Check that the URL ends in `/exec` and that the deployment's access is **Anyone**. |
| Shortcut asks before running | Edit the automation and choose **Run Immediately**. |
| A month tab looks wrong after editing the Ledger by hand | In the sheet, run **Spendings → Rebuild all cycle tabs**. |
| Someone may have your app key | In the sheet, run **Spendings → Make a new app key**, then update it in the app and in the Shortcut. |
| See the app without real data | **Settings → Demo data**, or open the link with `?demo=1` at the end. |

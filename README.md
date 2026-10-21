# Our Tax — work trips and tax deductions (version 1.03)

Work kilometres (cents per km), work expenses with receipt photos, a summary for each tax year and an end-of-year PDF for the accountant — for Shaun and Lyndsey on their own phones.
Runs on your phone, works offline, and keeps a shared live copy in your own Dropbox (synced on Wi‑Fi).

App address: **https://sskehan.github.io/tax/**

## Files in this repository
index.html · app.js · sw.js · manifest.webmanifest · icon-192.png · icon-512.png · README.md

Only program files go here. The repository is public, so **never upload a backup file to GitHub.**

## 1. Put it on GitHub (one time)
1. On GitHub: **New repository** → name **tax** → **Public** → **Create repository**.
2. **Add file → Upload files** → drag in all the files above → **Commit changes**.
3. **Settings → Pages** → Source **Deploy from a branch** → Branch **main** / **(root)** → **Save**.
   After a minute or two the app address above works.

## 2. The Dropbox app (one time — done: OurTax, App key uqt88mydb2aa1fx)
1. Go to **dropbox.com/developers/apps** → **Create app**.
2. Choose **Scoped access** → **App folder** → name it **OurTax** (if that name is taken, try **OurTax Skehan**) → **Create app**.
3. **Permissions** tab: tick `files.metadata.read`, `files.content.read`, `files.content.write` → **Submit**.
4. **Settings** tab → **OAuth 2 → Redirect URIs**: add `https://sskehan.github.io/tax/` exactly → **Add**.
   Leave **Allow public clients (Implicit Grant & PKCE)** set to **Allow**.
5. Copy the **App key** (not the App secret — that is never used).

The App key is built into the app, so there's nothing to paste.

## 3. Install on each phone
1. Open the app address in **Chrome**.
2. Tap **⋮ → Install app** (or **Add to Home screen → Install**).
3. Open **Our Tax** and choose whose phone it is (Shaun or Lyndsey).
4. **Settings → Backup & sync → Connect Dropbox** → sign in with the **same Dropbox account on both phones** → **Allow**.
   If the sign-in comes back in a Chrome tab, close the tab and open Our Tax from the home screen.
5. Long-press the icon for the **Add trip** and **Add expense** shortcuts.

## 4. Everyday use
- **Trip:** tap **Trip**, tap the court (Windsor 46 km, Mt Druitt 30 km, Blacktown 52 km), pick the purpose, **Save**. Today is chosen already.
- **A week at the same court:** **Date range** → From / To → **Weekdays only** → it saves one trip per day.
- **Expense:** tap **Expense**, pick the category, type what it was and the cost, set the work % if it's not 100%, add a receipt photo, **Save**.
- **Records:** tap any record to change it. Every change is logged with who made it and when.
- **Removing:** a removed record stops counting but is kept (and can be restored) for 7 years after the end of its tax year. **Records › Show removed** shows them.
- **Summary:** one page per tax year, per person or the household, with itemised vs standard deduction when that applies.
- **End-of-year PDF:** Summary → **Run end-of-year PDF** → **Make PDF** → in the print screen choose **Save as PDF** → email it to Positive Tax Solutions.

## 5. Changing rules (future-proof)
Nothing about the tax rules is fixed in the program. **Settings → Tax year rules** holds, for each tax year:
the cents-per-km rate, the km cap per car, whether the cents-per-km method applies, whether the standard deduction applies and its amount,
which categories count toward it, and the immediate-deduction limit for equipment.
Each July tap **Start 2027-28** — it copies the last year, so usually only the rate needs changing. Past years never change.
Places, cars, purposes, categories and people can all be added, renamed or hidden in Settings; past records keep the names they were saved with.

## 6. Dropbox, two phones and changing phones
- Our Tax can only see its own folder, **Dropbox › Apps › OurTax**:
  - `live/ourtax.json` — the current copy; `live/files/` — receipt photos.
  - `snapshots/` — one copy per day for 60 days, plus one before every restore.
  - `archive/` — the last copy of each month, kept for 8 years.
- **Only sync on Wi‑Fi** is on: changes made on mobile data wait (the status shows **changes waiting for Wi‑Fi**) and go when the phone is on Wi‑Fi. **Sync now** sends straight away if you need it.
- Both phones can add records at the same time; on each sync the copies are merged record by record.
- New phone or cleared Chrome: install the app, choose whose phone it is, connect Dropbox — everything comes back.
- When clearing Chrome's history, untick **Cookies and site data** — ticking it deletes the copy on the phone (Dropbox still has it).
- **Backup file** (Backup & sync) saves one file with everything — an extra copy for the QNAP.

## 7. Updating the app
1. Make sure the status says **in Dropbox ✓**.
2. Upload the changed files to this repository (**Add file → Upload files → Commit changes**).
3. In the app: **Settings → Check for update** (tap twice if the version number doesn't change).

Your data is not affected. When a file changes, `APP_VERSION` at the top of `app.js` and `VERSION` in `sw.js` change together.

## Version history
- **1.03** — New logo (road tick) and colours: navy header with the logo, teal for buttons and selections, plum for Lyndsey (warnings stay amber); the PDF carries the logo; "sample" and "removed" tags no longer stretch across the row.
- **1.02** — New app identity so Chrome can install it cleanly (fixes "This app is already installed" / "Could not open app"); the Our Tax title no longer wraps beside a long sync status.
- **1.01** — Dropbox App key built in (no pasting needed).
- **1.0** — Trips with saved places and date ranges, expenses with receipt photos and work %, records with change history and 7-year keeping, tax year summary, end-of-year PDF, per-year tax rules (rate, cap, standard deduction), two phones through Dropbox (Wi‑Fi only), 2025-26 sample data, starter trips 31 Jul 2026 (Windsor, covering) and 19 Oct 2026 (Mt Druitt).

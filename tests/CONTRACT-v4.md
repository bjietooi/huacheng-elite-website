# v4 brief (27 Sep 2026) — typed credits, packages, part-day leave, ranged reports

Six changes the client asked for. Everything else from the earlier rounds stands (coaches as data,
coach "My classes", remarks coach-only, one-offs + camps admin-only, Reports = dashboard, Students =
the list of students with credits, no parent-portal link in the console, shared family credits).

1. **Leave for part of a day** — a coach marks e.g. 16:00–18:00 off; only classes overlapping that
   window close. Whole-day leave still works.
2. **Reports by date range** — pick a period; credits bought/used/refunded, revenue and activity in
   that period, balances as at the end of it.
3. **Typed credits** — a credit belongs to a credit TYPE and only books that type's classes:
   Junior, Elite, Competitive, and Private (one type per coach). A family can hold several wallets.
4. **No public sign-up** — parents can't create accounts; admins create the family, parent and
   children in the console.
5. **Admin-managed packages** — a Packages view: name, credit type, credits, price, tag, on/off sale.
6. **Private 1-to-1 packages** — e.g. "Private (Coach A)" 1 credit S$200, "Private (Coach B)" S$160.

## Store API — hc-store.js v4 (VERSION 4, re-seeds; read the file)

Credit types and packages
- `creditTypes({includeInactive})` → `[{ id, name, short, kind: "class"|"private", coach?, programmes[], order, active }]`
  (`junior`, `elite`, `competitive`, `private-coach-a`, `private-coach-b`, …)
- `creditType(id)`, `creditTypeName(id)`, `creditTypeShort(id)`
- `creditTypeFor(occ | { programmeId, coach })` → the credit type id a class needs
- `packages({ includeInactive, creditType })`, `packageById(id)`
- `addPackage({ name, creditType, credits, price, tag, note, active }, { by })`,
  `updatePackage(id, patch, { by })`, `retirePackage(id, { by })` (never deleted — purchases point at them)
- `programmes()` — HC.programmes + the console-only **Private 1-to-1** programme (`id: "private"`,
  `maxSize: 1`, tier `"private"`); `programme(id)`; `privateProgramme`

Wallets
- `balance(familyId)` → every credit; `balance(familyId, typeId)` → one wallet
- `balances(familyId)` → `[{ type, credits }]` (wallets held + types the children's classes need)
- `ledger({ familyId, childId, creditType, type, from, to })` — rows carry `creditType`
- `ledgerWithBalance(familyId, filter?)` → rows with `balanceAfter` (that wallet) and `totalAfter`
- `adjustCredits(familyId, delta, { creditType (required unless the family holds exactly one), reason, note, amount, by, allowNegative })`
- `purchase(familyId, packageId, { by })` — credits land in that package's type
- `book()` charges the class's own type → `{ ok:false, code:"credits", creditType, error:"No Elite credits left." }`
- occurrences carry `creditType` + `creditTypeName`; bookings carry `creditType`; refunds return the same type

Leave
- `addLeave({ coach, date, reason, from?, to? }, { by })` — omit from/to for the whole day; overlapping
  leave on the same day is refused
- `leavesOn(coach, date)` → all entries that day; `leaveFor(coach, date, time?, duration?)` → the entry
  covering a class (or the first that day); `leaveLabel(leave)` → "All day" / "4:00 PM – 6:00 PM"
- `leaveTargets(coach, date, window?)`, `leaveImpact(coach, date, window?)` — window `{ from, to }`
- occurrences blocked by leave expose `leaveWindow` (`null` = all day)

Reports
- `creditReport({ from, to, dormantDays })` — `to` defaults to today, `from` to the 1st of that month.
  Balances are **as at `to`**; `bought / spent / refunded / addedByStaff / takenByStaff / revenue /
  attended` on each row are **within the range**. Row also has `byType` and `wallets`.
  `totals` adds `byType: [{ type, credits }]`; `movement` covers the range and has `byType` and `net`;
  new `activity: { classes, booked, present, late, absent, unmarked }`; `aging` unchanged.

## Core — admin/js/core.js
- New admin nav entry **Packages** (`#packages`), icon `tag`.
- `Admin.h.creditChip(typeId, credits?)`, `Admin.h.wallets(list)`, `Admin.h.creditTypeOptions(selected, { all })`.

## Tests — now live in the repo (`tests/`), not in a temp folder
The old suites were lost with the session scratchpad. Rebuild yours as `tests/<module>.test.js`:
- `cd tests && node <module>.test.js`, and `./run.sh` runs them all.
- `tests/dom-harness.js`: `openConsole({ staff, hash, storage, now })`, `openPortal({ family, hash, now, page })`,
  `openPage(relPath, …)`; `now: "2026-10-06T12:00"` freezes the page clock.
- `tests/store.test.js` covers the store (green) — a good example of the house style: plain node,
  `assert`, a counted `ok()/eq()` helper, prints "N checks passed".
- Cover the happy path, the permission rules, the awkward cases you know about, and print a count.
  Zero `c.errors`. Never touch the network or write into the repo.

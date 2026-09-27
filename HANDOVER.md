# Huacheng Elite — booking mock: where things stand

_Last updated: 27 Sep 2026._

Two clickable prototypes, no backend. Both read and write one mock database (`hc-store.js`) kept in
the browser's `localStorage`, so a change made by staff shows up for parents straight away.

| | Repo / folder | Review link (no-index) |
|---|---|---|
| Website + parent portal | this repo (`index.html`, `login.html`, `portal.html`, `app.js`) | https://sv-demo-portal.vercel.app |
| Coach & admin console | `admin/` here, shipped from `bjietooi/huacheng-elite-admin` | https://sv-demo-console.vercel.app |

Demo logins — console: **Studio Admin** or **Coach A** (any password). Portal: **Continue with demo
account** (Jane Tan, children Ethan & Chloe), or any seeded parent email such as
`marcus.lim@example.com`. "Reset demo data" in the console's account menu restores everything; the
demo re-seeds itself each new day so the walkthrough always starts from "today".

## What is live right now (store version 3)

Shared family credits · parent booking with a "Who's coming?" dropdown (one or several children) ·
camps (one-off sessions across several date ranges) · coaches managed by admins · coach "My classes"
view with Upcoming / Now / Passed and attendance state · blocking, deleting (one date, weekly series
or a whole camp), whole-day leave · attendance, coach remarks · Students list with credits ·
Credits (manual adjustments + log) · Reports dashboard with CSV export.

## Work in progress (store version 4) — branch `v4-typed-credits`

The client asked for six things on 27 Sep. The data layer is **done and tested**
(`tests/store.test.js`, 1,059 checks); the screens were being rebuilt when this note was written.

1. **Leave for part of a day** — `addLeave({coach, date, from, to})`; only classes overlapping the
   window close. Several windows a day allowed. _Store done; Leave screen in progress._
2. **Reports by date range** — `creditReport({from, to})`: balances as at `to`, money and activity
   within the range, plus `activity` and per-type totals. _Store done; Reports in progress._
3. **Typed credits** — a credit belongs to a credit type and books only that type's classes:
   Junior, Elite, Competitive, and Private (one type per coach). A family holds several wallets
   (`balance(familyId, typeId)`, `balances(familyId)`). _Store done; screens in progress._
4. **No public sign-up** — admins create the family, parent and children in the console.
   _Store already supports it; Students screen + portal sign-up removal in progress._
5. **Admin-managed packages** — `packages()`, `addPackage`, `updatePackage`, `retirePackage`.
   _Store done; new Packages page in progress._
6. **Private 1-to-1 packages** — console-only `private` programme (capacity 1) plus per-coach credit
   types and packages (Coach A S$200, Coach B S$160 in the demo data). _Store done._

**Not deployed.** The review links still show version 3. Deploy only once the screens match the new
store and the suites pass, otherwise Credits, Reports, Students and the portal's buy page will break.

## Picking the work back up

```bash
cd tests && npm install        # once (jsdom)
./run.sh                       # every suite
node store.test.js             # just the data layer
```

`tests/CONTRACT-v4.md` is the brief the screens are being built against — read it first. The suites
live in the repo now (an earlier set was lost with a temp folder).

Deploy, once green:

```bash
# console repo
cd "../Hua Cheng Elite Admin" && tools/sync-from-website.sh && git add -A && git commit && git push
# both review links (bundles are rebuilt from the repos, no-index headers included)
tools/build-staging.sh /tmp/staging
cd /tmp/staging/sv-demo-portal  && npx vercel deploy --prod --yes
cd /tmp/staging/sv-demo-console && npx vercel deploy --prod --yes
```

Git: the website work sits on `coach-admin-site` (v3, matches what's deployed) and
`v4-typed-credits` (this round). `main` is untouched, so the indexed
`huacheng-elite-website.vercel.app` production site still shows the old marketing site.

## Open questions for the client / next session

- **Private sessions**: modelled as the studio scheduling a 1-to-1 slot that the parent then books
  with private credits. If parents should instead request a time for the studio to confirm, that's a
  different flow.
- **Strict credit types**: Junior credits can't book an Elite class. The Packages page will let an
  admin change which classes each credit type covers if that's too strict.
- **Old indexed staging site**: `huacheng-elite-website.vercel.app` is still indexable. Offer: a
  `noindex` header for `*.vercel.app` only (a custom domain later stays searchable), or delete that
  Vercel project.
- **Camp pricing** stays out of scope (client's call); camp sessions are booked one at a time.
- **Still placeholders** from earlier rounds: real WhatsApp number, email and Instagram; coach names
  are generic ("Coach A/B") until the timetable's coach tagging is confirmed.

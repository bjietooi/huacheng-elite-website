# Huacheng Elite — booking mock: where things stand

_Last updated: 27 Sep 2026 (v4 complete)._

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

## What the prototypes do (store version 4)

Credits belong to a family **and to a credit type** — Junior, Elite, Competitive, or Private with one
coach — and a credit only books its own kind of class. A family can hold several wallets; any of
their children can spend them.

**Parents** — sign in with the email the studio holds (no public sign-up). Book one or several
children at once from a dropdown, see which credits each class uses, buy packages grouped by credit
type, and read attendance, coach remarks, notices and credit history.

**Coaches** — "My classes" for the week with Upcoming / Now / Passed and whether attendance is
marked; take attendance; write remarks; block a class; delete one date; book leave for a whole day
**or a few hours**; add a student to a class.

**Admins** — Today dashboard; whole schedule; one-off classes, camps (several date ranges) and
private 1-to-1 sessions; coaches (logins, renames, handing over weekly classes); students and
families created in the console; typed credit adjustments; **Packages** (price points per credit
type, including private rates); and a **Reports** dashboard filtered by any date range with CSV
export.

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

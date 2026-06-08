# Huacheng Elite — Wushu Academy Website

A high-conversion, lead-generation landing site for **Huacheng Elite (华承精锐)**, built to match the brand deck (cream / ink / copper palette, elegant serif + clean sans) and drive **WhatsApp enquiries and free-trial bookings**.

It's a fast, dependency-free static site — just HTML, CSS and a little JavaScript. No build step.

---

## 📁 Files

| File | What it is |
|------|-----------|
| `index.html` | The whole page (all sections) |
| `styles.css` | All styling, fully responsive |
| `script.js` | Menu, scroll effects, and the WhatsApp lead form |
| `.claude/` | Local preview server (used for development only) |

---

## ▶️ How to view it

**Easiest:** double-click `index.html` to open it in your browser.

**With a local server** (recommended, mirrors production):
```bash
cd "Hua Cheng Elite"
node .claude/server.js     # then open http://localhost:4599
```

---

## ✏️ The 3 things to change before going live

### 1. Your contact details — `script.js` (top of the file)
```js
const CONFIG = {
  whatsapp: "6588888888",            // ← real WhatsApp number, digits only, with country code
  phoneDisplay: "+65 8888 8888",     // ← how it's shown on the page
  email: "hello@huachengelite.com"   // ← real email
};
```
Every WhatsApp button, the floating chat bubble, and the enquiry form all read from here — change it once and the whole site updates.

> The free-trial form **pre-fills a WhatsApp message** with the parent's details and opens a chat. No backend, no server, no monthly fee — enquiries land straight in your WhatsApp.

### 2. Photos & video
The hero, About/Mission, Studio and Our Clients sections use your supplied photos (in the `images/` folder: `hero.jpg`, `mission.jpg`, `studio.jpg`, `pathway.jpg`, `team.jpg`). To change any of them, just replace the file in `images/` (keep the same name) or edit the `src` in `index.html`.

The **"Why Wushu, Why Now"** section is a full-screen **slow-motion video** (your ImageKit clip), desaturated and tinted to the brand copper via a duotone overlay, with frosted-glass cards on top.

The **hero** also has a subtle **ink-wash painting video** (`bg.mp4`) washed into the cream background via `mix-blend-mode: multiply` with a left/bottom fade so the headline stays readable. Tune its strength with `.hero__video video { opacity }` and `.hero__video::after` (the readability fade) in `styles.css`.

Both background videos use `data-autoplay` (and optional `data-rate` for slow-mo) on the `<video>` tag — `script.js` plays them, slows them, and pauses them when off-screen. To swap a clip, change the `src`/`poster` URL on its `<video>` tag.

**Still placeholders — the 3 coaches.** These are specific real people, so they shouldn't use generic stock. In `index.html`, find each `<div class="coach__photo">` and swap the `<span>武</span>` for `<img src="images/royce.jpg" alt="Dr Royce Ang">` (their headshots are in your brand deck). Drop the files into `images/`.

### 3. Real testimonials
The "Our Clients" section uses sample reviews as placeholders. Replace the text in each `<blockquote>` with genuine parent quotes once you have consent to publish them.

Also worth a quick look: the **announcement bar** text at the top of `index.html` (current enrolment message).

---

## 🎯 Conversion features built in

- **WhatsApp-first** — your chosen CTA is everywhere: header, hero, every programme, a sticky floating bubble, and the form.
- **Free-trial form** that compiles into a tidy WhatsApp message (name, child's age, programme, preferred times).
- **Trust front-and-centre** — National Team head coach, Asian champion advisor, IWUF accreditation, affiliations strip.
- **DSA angle** — a dedicated section + FAQ, since that's a top reason parents enquire in Singapore.
- **Benefits for parents** — discipline, confidence, health, values, competition pathway.
- **Full journey** — all 8 programmes, coaches, studio, testimonials, FAQ, contact.
- **SEO ready** — page title, meta description, Open Graph tags, and LocalBusiness structured data (`SportsActivityLocation`).
- **Cinematic imagery + motion** — dramatic photos with an "unveil" scale-in, directional scroll reveals, a subtle parallax on the DSA band, and an animated count-up on the stats.
- **Brush calligraphy** — Chinese characters (华承精锐, 武, 武德, and the philosophy line) render in a calligraphy typeface (`Ma Shan Zheng`) for an authentic, premium feel.
- **Fast, accessible, mobile-first** — semantic HTML, keyboard-friendly menu, reduced-motion support (animations and parallax switch off for users who prefer reduced motion).

---

## 🚀 Deploying

It's static, so it hosts anywhere for free/cheap:
- **Netlify / Vercel / Cloudflare Pages** — drag-and-drop the folder, or connect a repo.
- **GitHub Pages** — push the folder and enable Pages.
- Any web host — upload the files to the web root.

Remember to update the structured-data `telephone`, `email` and `address` in `index.html` too.

---

## 🔮 Phase-2 features from the brief (not yet built)

The brand brief also listed **online booking, payment, member login and live chat**. These need backend services and are natural next steps:

- **Booking / scheduling** — Calendly, Acuity, or a class-management tool (e.g. ClassPass/Glofox/TeamUp) embedded into the page.
- **Payments** — Stripe Payment Links / HitPay (popular in SG) buttons, or the booking tool's built-in checkout.
- **Member login & live chat** — a platform like Glofox/TeamUp (members) and a chat widget (e.g. WhatsApp Business, Intercom, or tawk.to).
- **Blog / Insights** — the section is scaffolded with placeholders; wire it to a simple CMS or hand-author article pages.

The current site is designed to convert visitors into enquiries first — the highest-leverage goal — and these tools slot in cleanly when you're ready.

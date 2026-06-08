/* ============================================================
   HUACHENG ELITE — interactions
   ⚙️  EDIT YOUR CONTACT DETAILS HERE (one place):
   ============================================================ */
const CONFIG = {
  // WhatsApp number — digits only, including country code (no +, spaces or dashes).
  whatsapp: "6588888888",          // TODO: replace with the real WhatsApp number
  phoneDisplay: "+65 8888 8888",   // TODO: shown on the page
  email: "hello@huachengelite.com" // TODO: replace with the real email
};

const DEFAULT_WA_MSG = "Hi Huacheng Elite! I'd like to find out more and book a free trial class.";

document.addEventListener("DOMContentLoaded", () => {
  /* ---- Year ---- */
  const yr = document.getElementById("year");
  if (yr) yr.textContent = new Date().getFullYear();

  /* ---- Wire up WhatsApp / email / phone from CONFIG ---- */
  const waBase = `https://wa.me/${CONFIG.whatsapp}`;
  document.querySelectorAll("[data-wa]").forEach((el) => {
    const msg = el.getAttribute("data-wa-msg") || DEFAULT_WA_MSG;
    el.setAttribute("href", `${waBase}?text=${encodeURIComponent(msg)}`);
    el.setAttribute("target", "_blank");
    el.setAttribute("rel", "noopener");
  });
  document.querySelectorAll("[data-email]").forEach((el) => {
    el.setAttribute("href", `mailto:${CONFIG.email}`);
    if (!el.textContent.trim() || el.hasAttribute("data-email-text")) el.textContent = CONFIG.email;
  });
  document.querySelectorAll("[data-phone-display]").forEach((el) => {
    el.textContent = CONFIG.phoneDisplay;
  });

  /* ---- Announcement dismiss ---- */
  const announce = document.getElementById("announce");
  const announceClose = document.getElementById("announceClose");
  if (announceClose) announceClose.addEventListener("click", () => announce.classList.add("is-hidden"));

  /* ---- Sticky header shadow ---- */
  const nav = document.getElementById("nav");
  const onScroll = () => nav.classList.toggle("is-stuck", window.scrollY > 8);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  /* ---- Mobile nav ---- */
  const toggle = document.getElementById("navToggle");
  const links = document.getElementById("navLinks");
  const scrim = document.createElement("div");
  scrim.className = "nav-scrim";
  document.body.appendChild(scrim);

  const closeMenu = () => {
    links.classList.remove("is-open");
    scrim.classList.remove("is-open");
    document.body.classList.remove("nav-open");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Open menu");
  };
  const openMenu = () => {
    links.classList.add("is-open");
    scrim.classList.add("is-open");
    document.body.classList.add("nav-open");
    toggle.setAttribute("aria-expanded", "true");
    toggle.setAttribute("aria-label", "Close menu");
  };
  toggle.addEventListener("click", () =>
    links.classList.contains("is-open") ? closeMenu() : openMenu()
  );
  scrim.addEventListener("click", closeMenu);
  links.querySelectorAll("a").forEach((a) => a.addEventListener("click", closeMenu));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });

  /* ---- Scroll reveal ---- */
  const reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry, i) => {
          if (entry.isIntersecting) {
            // light stagger for siblings entering together
            const delay = Math.min(i * 60, 240);
            entry.target.style.transitionDelay = `${delay}ms`;
            entry.target.classList.add("in");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    reveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add("in"));
  }

  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---- Parallax (subtle, rAF-throttled) ---- */
  const parallaxEls = Array.from(document.querySelectorAll("[data-parallax]"));
  if (parallaxEls.length && !prefersReduced) {
    let ticking = false;
    const update = () => {
      const vh = window.innerHeight;
      parallaxEls.forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.bottom < -80 || r.top > vh + 80) return;
        const speed = parseFloat(el.dataset.parallax) || 0.08;
        const centerOffset = r.top + r.height / 2 - vh / 2;
        el.style.setProperty("--py", `${(-centerOffset * speed).toFixed(1)}px`);
      });
      ticking = false;
    };
    const onScrollP = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
    window.addEventListener("scroll", onScrollP, { passive: true });
    window.addEventListener("resize", onScrollP, { passive: true });
    update();
  }

  /* ---- Stat count-up ---- */
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const animateCount = (el) => {
    const m = el.textContent.trim().match(/^(\d+)(\D*)$/);
    if (!m) return; // leave non-numeric values (e.g. "Asian", "IWUF")
    const target = parseInt(m[1], 10);
    const suffix = m[2];
    const dur = 1300;
    let startT = null;
    const tick = (now) => {
      if (startT === null) startT = now;
      const p = Math.min((now - startT) / dur, 1);
      el.textContent = Math.round(easeOutCubic(p) * target) + suffix;
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  const statsList = document.querySelector(".stats");
  if (statsList && "IntersectionObserver" in window && !prefersReduced) {
    const so = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.querySelectorAll(".stats__n").forEach(animateCount);
            so.unobserve(e.target);
          }
        });
      },
      { threshold: 0.4 }
    );
    so.observe(statsList);
  }

  /* ---- Background videos (autoplay can be blocked, so nudge them) ---- */
  const autoVideos = Array.from(document.querySelectorAll("video[data-autoplay]"));
  if (autoVideos.length) {
    const playVideo = (v) => {
      const rate = parseFloat(v.dataset.rate);
      if (rate) v.playbackRate = rate; // re-apply: rate can reset on (re)load
      const p = v.play();
      if (p && p.catch) p.catch(() => {});
    };
    autoVideos.forEach((v) => {
      v.muted = true; // required for programmatic play on most browsers
      const rate = parseFloat(v.dataset.rate);
      if (rate) v.defaultPlaybackRate = rate;
      playVideo(v);
      if ("IntersectionObserver" in window) {
        new IntersectionObserver(
          (entries) => entries.forEach((e) => (e.isIntersecting ? playVideo(v) : v.pause())),
          { threshold: 0.05 }
        ).observe(v);
      }
    });
    const kick = () => autoVideos.forEach(playVideo);
    ["pointerdown", "touchstart", "scroll", "keydown"].forEach((ev) =>
      window.addEventListener(ev, kick, { once: true, passive: true })
    );
  }

  /* ---- FAQ: keep one open at a time ---- */
  const faqItems = document.querySelectorAll(".faq__item");
  faqItems.forEach((item) => {
    item.addEventListener("toggle", () => {
      if (item.open) {
        faqItems.forEach((other) => { if (other !== item) other.open = false; });
      }
    });
  });

  /* ---- Trial form → WhatsApp ---- */
  const form = document.getElementById("trialForm");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const nameEl = form.elements["name"];
      if (!nameEl.value.trim()) {
        nameEl.classList.add("invalid");
        nameEl.focus();
        return;
      }
      nameEl.classList.remove("invalid");

      const data = {
        Name: form.elements["name"].value.trim(),
        "Child's age": form.elements["age"].value.trim(),
        Programme: form.elements["programme"].value,
        "Preferred times": form.elements["time"].value.trim(),
        Notes: form.elements["message"].value.trim()
      };

      let msg = "Hi Huacheng Elite! I'd like to book a *free trial class*.%0A%0A";
      Object.entries(data).forEach(([k, v]) => {
        if (v) msg += `*${k}:* ${v}%0A`;
      });
      msg += "%0AThank you!";

      window.open(`${waBase}?text=${msg}`, "_blank", "noopener");
    });

    // clear invalid state on input
    form.elements["name"].addEventListener("input", (e) =>
      e.target.classList.remove("invalid")
    );
  }
});

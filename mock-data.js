/* ============================================================
   HUACHENG ELITE — shared mock data (booking concept)
   ------------------------------------------------------------
   Single source of truth for the programmes, the weekly class
   schedule, credit packages and the demo account. It is read by
   BOTH the public schedule preview (index.html) and the booking
   portal mockup (login.html / portal.html).

   ⚠️  Everything here is ILLUSTRATIVE for the UX concept —
   timetable, pricing and coach tagging are not yet finalised.
   ============================================================ */
(function () {
  "use strict";

  const HC = (window.HC = window.HC || {});

  /* ---- Brand / contact (mirrors CONFIG in script.js) ---- */
  HC.brand = {
    name: "Huacheng Elite",
    cn: "华承精锐",
    whatsapp: "6588888888",                 // TODO: real WhatsApp number (digits, with country code)
    phoneDisplay: "+65 8888 8888",          // TODO: real display number
    email: "hello@huachengelite.com",       // TODO: real email
    instagram: "https://www.instagram.com/", // TODO: real Instagram handle
    hours: "Mon–Sun · 10am–10pm",
    address: {
      line1: "11 Tanjong Katong Road",
      unit: "#02-35/36 (Kinex Mall)",
      postal: "Singapore 437157",
      maps: "https://maps.google.com/?q=Kinex+Mall+11+Tanjong+Katong+Road+Singapore+437157"
    }
  };

  /* ---- Programmes (bookable classes) ----
     Names follow the pricing spreadsheet headings exactly.
     tier: pricing group → "junior" ($220/$425/$800 for 5/10/20),
           "elite" ($250/$475/$900), "competitive" (max 6).
     maxSize: hard cap on class size. */
  HC.programmes = [
    {
      id: "tots", name: "Wushu Tots", level: "Junior",
      age: "Age 4+", credits: 1, duration: 60, tier: "junior", maxSize: 20,
      blurb: "A playful, foundational class for our youngest students — building coordination, listening skills and a love of movement."
    },
    {
      id: "wushu-jr", name: "Wushu Junior", level: "Junior",
      age: "Age 6+", credits: 1, duration: 75, tier: "junior", maxSize: 20,
      blurb: "Our core, structured Wushu curriculum — progressive training that takes younger students from the fundamentals to confident routines."
    },
    {
      id: "wushu-elite", name: "Wushu Elite", level: "Elite",
      age: "By assessment", credits: 1, duration: 90, tier: "elite", maxSize: 20,
      blurb: "For advancing athletes training across all routines — from fists to long and short weapons."
    },
    {
      id: "flips-jr", name: "Flips & Jumps (Junior)", level: "Junior",
      age: "Age 8+", credits: 1, duration: 60, tier: "junior", maxSize: 20,
      blurb: "A dedicated skills class for jumping and flipping — so students execute dynamic taolu movements safely and powerfully."
    },
    {
      id: "flips-elite", name: "Flips & Jumps (Elite)", level: "Elite",
      age: "Advanced", credits: 1, duration: 60, tier: "elite", maxSize: 20,
      blurb: "Advanced aerial work — refining height, rotation and landings for competition-standard jumping and flipping."
    },
    {
      id: "cond-jr", name: "Physical & Jumps Conditioning (Junior)", level: "Junior",
      age: "Age 8+", credits: 1, duration: 60, tier: "junior", maxSize: 20,
      blurb: "Build stamina and strengthen the muscle groups behind powerful Wushu — the perfect complement to Flips & Jumps."
    },
    {
      id: "cond-elite", name: "Physical & Jumps Conditioning (Elite)", level: "Elite",
      age: "Advanced", credits: 1, duration: 60, tier: "elite", maxSize: 20,
      blurb: "High-intensity strength and jump conditioning for elite athletes — the engine behind explosive, competition-grade movement."
    },
    {
      id: "competitive", name: "Competitive Private Group", level: "Competitive",
      age: "By assessment", credits: 1, duration: 120, tier: "competitive", maxSize: 6,
      blurb: "High-performance coaching in a small group capped at 6 — refining routines, scoring elements and competition strategy."
    }
  ];

  /* ---- Private 1-to-1 coaching (by appointment, not group-scheduled) ---- */
  HC.privateCoaching = [
    { id: "private-royce",  name: "Private Class (Coach Royce)",  ratePerHour: 200 },
    { id: "private-huaiyu", name: "Private Class (Coach Huaiyu)", ratePerHour: 160 }
  ];

  /* ---- Special / seasonal programmes (coming soon) ---- */
  HC.specialProgrammes = [
    {
      id: "camp-jun", name: "June Training Camp", when: "June", status: "coming-soon",
      blurb: "An intensive seasonal camp during the mid-year school holidays."
    },
    {
      id: "camp-dec", name: "December Training Camp", when: "December", status: "coming-soon",
      blurb: "A year-end intensive to sharpen skills before the new competition season."
    }
  ];

  /* ---- Coaches (generic tags — real profiles deferred) ---- */
  HC.coaches = ["Coach A", "Coach B"];

  /* ---- Credit packages (PayNow checkout is mocked) ----
     Prices follow the Junior-level class packages on the pricing sheet
     (5/$220, 10/$425, 20/$800). Elite, Competitive & private 1-to-1
     rates differ — see the full pricing section on the site. */
  HC.packages = [
    { id: "trial",  name: "Free Trial",  credits: 1,  price: 0,   tag: "Start here", note: "One complimentary trial class for new students" },
    { id: "pack5",  name: "5 Classes",   credits: 5,  price: 220, tag: "",           note: "5 credits · Junior-level rate" },
    { id: "pack10", name: "10 Classes",  credits: 10, price: 425, tag: "Popular",    note: "10 credits · Junior-level rate" },
    { id: "pack20", name: "20 Classes",  credits: 20, price: 800, tag: "Best value", note: "20 credits · Junior-level rate" }
  ];

  /* ---- Weekly schedule ----
     day: 0=Mon … 6=Sun.  time: 24h "HH:MM" (studio hours 10:00–22:00). */
  HC.dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  HC.dayShort = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  HC.schedule = [
    // Monday
    { id: "m1", day: 0, time: "16:00", programmeId: "tots",         coach: "Coach A", capacity: 16, booked: 5 },
    { id: "m2", day: 0, time: "17:30", programmeId: "wushu-jr",     coach: "Coach A", capacity: 18, booked: 9 },
    { id: "m3", day: 0, time: "19:00", programmeId: "wushu-elite",  coach: "Coach B", capacity: 14, booked: 7 },
    { id: "m4", day: 0, time: "20:30", programmeId: "cond-elite",   coach: "Coach B", capacity: 16, booked: 4 },
    // Tuesday
    { id: "t1", day: 1, time: "16:00", programmeId: "wushu-jr",     coach: "Coach A", capacity: 18, booked: 6 },
    { id: "t2", day: 1, time: "17:30", programmeId: "flips-jr",     coach: "Coach B", capacity: 14, booked: 8 },
    { id: "t3", day: 1, time: "19:00", programmeId: "competitive",  coach: "Coach B", capacity: 6,  booked: 5 },
    { id: "t4", day: 1, time: "20:30", programmeId: "wushu-elite",  coach: "Coach B", capacity: 14, booked: 6 },
    // Wednesday
    { id: "w1", day: 2, time: "16:00", programmeId: "tots",         coach: "Coach A", capacity: 16, booked: 3 },
    { id: "w2", day: 2, time: "17:30", programmeId: "wushu-jr",     coach: "Coach A", capacity: 18, booked: 16 },
    { id: "w3", day: 2, time: "19:00", programmeId: "wushu-elite",  coach: "Coach B", capacity: 14, booked: 9 },
    { id: "w4", day: 2, time: "20:30", programmeId: "flips-elite",  coach: "Coach B", capacity: 14, booked: 5 },
    // Thursday
    { id: "h1", day: 3, time: "16:00", programmeId: "wushu-jr",     coach: "Coach A", capacity: 18, booked: 7 },
    { id: "h2", day: 3, time: "17:30", programmeId: "cond-jr",      coach: "Coach B", capacity: 16, booked: 5 },
    { id: "h3", day: 3, time: "19:00", programmeId: "competitive",  coach: "Coach B", capacity: 6,  booked: 4 },
    { id: "h4", day: 3, time: "20:30", programmeId: "flips-jr",     coach: "Coach B", capacity: 14, booked: 6 },
    // Friday
    { id: "f1", day: 4, time: "16:00", programmeId: "tots",         coach: "Coach A", capacity: 16, booked: 6 },
    { id: "f2", day: 4, time: "17:30", programmeId: "wushu-elite",  coach: "Coach B", capacity: 14, booked: 8 },
    { id: "f3", day: 4, time: "19:00", programmeId: "wushu-jr",     coach: "Coach A", capacity: 18, booked: 10 },
    { id: "f4", day: 4, time: "20:30", programmeId: "cond-elite",   coach: "Coach B", capacity: 16, booked: 5 },
    // Saturday
    { id: "s1", day: 5, time: "10:00", programmeId: "tots",         coach: "Coach A", capacity: 16, booked: 9 },
    { id: "s2", day: 5, time: "11:30", programmeId: "wushu-jr",     coach: "Coach A", capacity: 18, booked: 18 },
    { id: "s3", day: 5, time: "13:30", programmeId: "flips-jr",     coach: "Coach B", capacity: 14, booked: 6 },
    { id: "s4", day: 5, time: "15:00", programmeId: "wushu-elite",  coach: "Coach B", capacity: 14, booked: 8 },
    { id: "s5", day: 5, time: "16:30", programmeId: "competitive",  coach: "Coach B", capacity: 6,  booked: 5 },
    { id: "s6", day: 5, time: "18:00", programmeId: "flips-elite",  coach: "Coach B", capacity: 14, booked: 4 },
    // Sunday
    { id: "u1", day: 6, time: "10:00", programmeId: "tots",         coach: "Coach A", capacity: 16, booked: 4 },
    { id: "u2", day: 6, time: "11:30", programmeId: "wushu-jr",     coach: "Coach A", capacity: 18, booked: 8 },
    { id: "u3", day: 6, time: "13:30", programmeId: "cond-jr",      coach: "Coach B", capacity: 16, booked: 3 },
    { id: "u4", day: 6, time: "15:00", programmeId: "wushu-elite",  coach: "Coach B", capacity: 14, booked: 6 }
  ];

  /* ---- Demo account (the mocked "logged-in" parent) ---- */
  HC.demoAccount = {
    parentName: "Jane Tan",
    email: "demo@huachengelite.com",
    phone: "+65 8888 8888",
    child: { name: "Ethan Tan", age: 7 },
    startingCredits: 6
  };

  /* ---- Helpers ---- */
  HC.getProgramme = function (id) {
    return HC.programmes.find(function (p) { return p.id === id; }) || null;
  };

  // "16:00" -> "4:00 PM"
  HC.formatTime = function (t) {
    const parts = String(t).split(":");
    let h = parseInt(parts[0], 10);
    const m = parts[1];
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12; if (h === 0) h = 12;
    return h + ":" + m + " " + ampm;
  };

  HC.formatPrice = function (n) {
    return n === 0 ? "Free" : "$" + Number(n).toLocaleString("en-SG");
  };

  // schedule entries for a given day index, sorted by time
  HC.scheduleForDay = function (day) {
    return HC.schedule
      .filter(function (s) { return s.day === day; })
      .sort(function (a, b) { return a.time.localeCompare(b.time); });
  };

  HC.spotsLeft = function (entry) {
    return Math.max(0, entry.capacity - entry.booked);
  };

  // The 7 dates of the CURRENT calendar week (Mon→Sun), so the schedule
  // reads like a live calendar. Returns [{day,name,short,date,month,isToday,iso}].
  HC.currentWeek = function () {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const now = new Date();
    const mondayOffset = (now.getDay() + 6) % 7; // JS Sun=0 → days since Monday
    const monday = new Date(now);
    monday.setHours(0, 0, 0, 0);
    monday.setDate(now.getDate() - mondayOffset);
    const todayKey = now.toDateString();
    const pad = function (n) { return n < 10 ? "0" + n : "" + n; };
    const week = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      week.push({
        day: i,
        name: HC.dayNames[i],
        short: HC.dayShort[i],
        date: d.getDate(),
        month: months[d.getMonth()],
        isToday: d.toDateString() === todayKey,
        iso: d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate())
      });
    }
    return week;
  };
})();

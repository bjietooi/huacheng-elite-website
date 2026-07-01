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
    hours: "Mon–Sun · 10am–10pm"
  };

  /* ---- Programmes (6) ---- */
  HC.programmes = [
    {
      id: "tots", name: "Wushu Tots", level: "Starter",
      age: "Age 4+", credits: 1, duration: 60,
      blurb: "A playful, foundational class for our youngest students — building coordination, listening skills and a love of movement."
    },
    {
      id: "training", name: "Training Program", level: "Foundation",
      age: "Age 6+", credits: 1, duration: 75,
      blurb: "Our core, structured Wushu curriculum — progressive training that takes general students from the fundamentals to confident routines."
    },
    {
      id: "elite", name: "Elite Group Classes", level: "Advanced",
      age: "By assessment", credits: 1, duration: 90,
      blurb: "For advancing athletes training across all routines — from fists to long and short weapons."
    },
    {
      id: "competitive", name: "Competitive", level: "Elite",
      age: "By assessment", credits: 2, duration: 120,
      blurb: "High-performance coaching for serious competitors — refining routines, scoring elements and competition strategy."
    },
    {
      id: "flips", name: "Flips & Jumps", level: "Skills",
      age: "Age 8+", credits: 1, duration: 60,
      blurb: "A dedicated skills class for jumping and flipping — so students execute dynamic taolu movements safely and powerfully."
    },
    {
      id: "strength", name: "Strength & Conditioning", level: "Skills",
      age: "Age 8+", credits: 1, duration: 60,
      blurb: "Build stamina and strengthen the muscle groups behind powerful Wushu — the perfect complement to Flips & Jumps."
    }
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

  /* ---- Credit packages (PayNow checkout is mocked) ---- */
  HC.packages = [
    { id: "trial",   name: "Free Trial",  credits: 1,  price: 0,   tag: "Start here", note: "One complimentary trial class" },
    { id: "starter", name: "Starter",     credits: 4,  price: 120, tag: "",           note: "4 credits · great for trying a programme" },
    { id: "value",   name: "Value",       credits: 10, price: 280, tag: "Popular",    note: "10 credits · save vs. drop-in" },
    { id: "elite",   name: "Elite",       credits: 20, price: 520, tag: "Best value", note: "20 credits · for regular trainers" }
  ];

  /* ---- Weekly schedule ----
     day: 0=Mon … 6=Sun.  time: 24h "HH:MM" (studio hours 10:00–22:00). */
  HC.dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  HC.dayShort = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  HC.schedule = [
    // Monday
    { id: "m1", day: 0, time: "16:00", programmeId: "tots",        coach: "Coach A", capacity: 12, booked: 5 },
    { id: "m2", day: 0, time: "17:30", programmeId: "training",    coach: "Coach A", capacity: 14, booked: 9 },
    { id: "m3", day: 0, time: "19:00", programmeId: "elite",       coach: "Coach B", capacity: 10, booked: 7 },
    { id: "m4", day: 0, time: "20:30", programmeId: "strength",    coach: "Coach B", capacity: 12, booked: 4 },
    // Tuesday
    { id: "t1", day: 1, time: "16:00", programmeId: "training",    coach: "Coach A", capacity: 14, booked: 6 },
    { id: "t2", day: 1, time: "17:30", programmeId: "flips",       coach: "Coach B", capacity: 10, booked: 8 },
    { id: "t3", day: 1, time: "19:00", programmeId: "competitive", coach: "Coach B", capacity: 8,  booked: 6 },
    // Wednesday
    { id: "w1", day: 2, time: "16:00", programmeId: "tots",        coach: "Coach A", capacity: 12, booked: 3 },
    { id: "w2", day: 2, time: "17:30", programmeId: "training",    coach: "Coach A", capacity: 14, booked: 11 },
    { id: "w3", day: 2, time: "19:00", programmeId: "elite",       coach: "Coach B", capacity: 10, booked: 9 },
    { id: "w4", day: 2, time: "20:30", programmeId: "flips",       coach: "Coach B", capacity: 10, booked: 5 },
    // Thursday
    { id: "h1", day: 3, time: "16:00", programmeId: "training",    coach: "Coach A", capacity: 14, booked: 7 },
    { id: "h2", day: 3, time: "17:30", programmeId: "strength",    coach: "Coach B", capacity: 12, booked: 5 },
    { id: "h3", day: 3, time: "19:00", programmeId: "competitive", coach: "Coach B", capacity: 8,  booked: 7 },
    // Friday
    { id: "f1", day: 4, time: "16:00", programmeId: "tots",        coach: "Coach A", capacity: 12, booked: 6 },
    { id: "f2", day: 4, time: "17:30", programmeId: "elite",       coach: "Coach B", capacity: 10, booked: 8 },
    { id: "f3", day: 4, time: "19:00", programmeId: "training",    coach: "Coach A", capacity: 14, booked: 10 },
    // Saturday
    { id: "s1", day: 5, time: "10:00", programmeId: "tots",        coach: "Coach A", capacity: 12, booked: 9 },
    { id: "s2", day: 5, time: "11:30", programmeId: "training",    coach: "Coach A", capacity: 14, booked: 12 },
    { id: "s3", day: 5, time: "13:30", programmeId: "flips",       coach: "Coach B", capacity: 10, booked: 6 },
    { id: "s4", day: 5, time: "15:00", programmeId: "elite",       coach: "Coach B", capacity: 10, booked: 8 },
    { id: "s5", day: 5, time: "16:30", programmeId: "competitive", coach: "Coach B", capacity: 8,  booked: 5 },
    // Sunday
    { id: "u1", day: 6, time: "10:00", programmeId: "tots",        coach: "Coach A", capacity: 12, booked: 4 },
    { id: "u2", day: 6, time: "11:30", programmeId: "training",    coach: "Coach A", capacity: 14, booked: 8 },
    { id: "u3", day: 6, time: "13:30", programmeId: "strength",    coach: "Coach B", capacity: 12, booked: 3 },
    { id: "u4", day: 6, time: "15:00", programmeId: "elite",       coach: "Coach B", capacity: 10, booked: 6 }
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

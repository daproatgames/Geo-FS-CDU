// ==UserScript==
// @name         GeoFS CDU - (AIRCRAFT + VNAV-Lite + DIR + LEGS + AP)
// @namespace    ButterMasterr.geofs.cdu
// @version      1.0
// @description  Unique CDU for GeoFS: aircraft profiles, VNAV-lite T/D, DIR-TO bearing, legs import, and AP targets via EXEC.
// @author       ButterMasterr
// @match        *://www.geo-fs.com/*
// @grant        none
// ==/UserScript==

(() => {
  "use strict";

  // -------------------- helpers --------------------
  const norm360 = (d) => ((d % 360) + 360) % 360;
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const pad3 = (n) => String(Math.round(n)).padStart(3, "0");
  const isoDate = () => new Date().toISOString().slice(0, 10);

  // great-circle initial bearing (deg) from (lat1,lon1)->(lat2,lon2)
  function bearingDeg(lat1, lon1, lat2, lon2) {
    const toRad = (x) => (x * Math.PI) / 180;
    const toDeg = (x) => (x * 180) / Math.PI;
    const φ1 = toRad(lat1), φ2 = toRad(lat2);
    const Δλ = toRad(lon2 - lon1);
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return norm360(toDeg(Math.atan2(y, x)));
  }

  function safeNum(x) {
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  }

  // -------------------- GeoFS accessors --------------------
  const geoReady = () => !!(window.geofs?.animation?.values && window.geofs?.autopilot);
  const LV = () => window.geofs.animation.values;
  const APV = () => window.geofs.autopilot.values;

  function getCallsign() {
    const u = window.geofs?.user?.username;
    if (u) return String(u).toUpperCase();

    const el = document.querySelector(".geofs-callsign");
    if (!el) return "GEOFS";
    const text = [...el.childNodes]
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => (n.textContent || "").trim())
      .join(" ")
      .replace(/\s+/g, " ")
      .replace(/no_account|account_circle/gi, "")
      .trim();
    return (text || "GEOFS").toUpperCase();
  }

  // Works in many builds; if not writable, it still won’t crash.
  function setAPTargets({ hdg, spd, alt, vs }) {
    if (!geoReady()) return { ok: false, why: "no geofs" };

    try { geofs.autopilot.on = true; } catch {}
    try { geofs.autopilot.mode = "HDG"; } catch {}

    // Direct writes
    try { if (hdg !== undefined) geofs.autopilot.values.course = norm360(Number(hdg)); } catch {}
    try { if (spd !== undefined) geofs.autopilot.values.speed = String(Number(spd)); } catch {}
    try { if (alt !== undefined) geofs.autopilot.values.altitude = String(Number(alt)); } catch {}
    try { if (vs !== undefined) geofs.autopilot.values.verticalSpeed = Number(vs); } catch {}

    // UI-sync fallback (best compatibility)
    const setInput = (sel, val) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      el.value = String(val);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    };

    const dom = {
      hdg: hdg !== undefined ? setInput("input.geofs-autopilot-course", norm360(Number(hdg))) : null,
      spd: spd !== undefined ? setInput("input.geofs-autopilot-speed", Number(spd)) : null,
      alt: alt !== undefined ? setInput("input.geofs-autopilot-altitude", Number(alt)) : null,
      vs:  vs  !== undefined ? setInput("input.geofs-autopilot-verticalSpeed", Number(vs)) : null
    };

    try { geofs.autopilot.update?.(); } catch {}
    try { geofs.autopilot.refresh?.(); } catch {}
    try { geofs.autopilot.sync?.(); } catch {}

    return { ok: true, dom };
  }

  // Route import from GeoFS nav.flightPlan when available; or else DOM idents
  function importFlightPlan() {
    const legs = [];

    // Prefer geofs.nav.flightPlan if present
    const fp = window.geofs?.nav?.flightPlan;
    if (Array.isArray(fp) && fp.length) {
      for (const p of fp) {
        const ident = (p.ident || p.name || "").toString().trim().toUpperCase();
        const lat = safeNum(p.lat ?? p.latitude);
        const lon = safeNum(p.lon ?? p.longitude);
        if (ident) legs.push({ ident, lat, lon });
      }
      return legs;
    }

    // Fallback method DOM waypoint labels (no lat/lon)
    const nodes = [...document.querySelectorAll(".geofs-waypointIdent")];
    for (const n of nodes) {
      const ident = (n.textContent || "").trim().toUpperCase().replace(/[0-9\.\,\s-]+$/, "").trim();
      if (ident) legs.push({ ident, lat: null, lon: null });
    }
    return legs;
  }

  // Try to read current lat/lon from animation values
  function getPos() {
    if (!geoReady()) return null;
    const v = LV();
    const lat = safeNum(v.lat ?? v.latitude ?? v.gpsLat);
    const lon = safeNum(v.lon ?? v.longitude ?? v.gpsLon);
    if (lat === null || lon === null) return null;
    return { lat, lon };
  }

  // -------------------- Aircraft profiles --------------------
  const AIRCRAFT_DB = {
    A320: { name: "AIRBUS A320", vmo: 340, mmo: 0.82, maxAlt: 39000, maxVS: 6000, vnav: { climbVS: 2200, descVS: -2200 } },
    B738: { name: "BOEING 737-800", vmo: 340, mmo: 0.82, maxAlt: 41000, maxVS: 6000, vnav: { climbVS: 2300, descVS: -2300 } },
    B772: { name: "BOEING 777-200", vmo: 330, mmo: 0.84, maxAlt: 43000, maxVS: 6000, vnav: { climbVS: 1800, descVS: -1800 } },
    E190: { name: "EMBRAER E190", vmo: 320, mmo: 0.82, maxAlt: 41000, maxVS: 6000, vnav: { climbVS: 2000, descVS: -2000 } },
    C172: { name: "CESSNA 172", vmo: 140, mmo: null, maxAlt: 14000, maxVS: 1500, vnav: { climbVS: 700, descVS: -500 } },
    SR22: { name: "CIRRUS SR22", vmo: 200, mmo: null, maxAlt: 25000, maxVS: 2500, vnav: { climbVS: 1200, descVS: -800 } },
  };

  function getProfile(code) {
    const k = (code || "").toUpperCase().trim();
    return AIRCRAFT_DB[k] || { name: "CUSTOM", vmo: 300, mmo: null, maxAlt: 40000, maxVS: 6000, vnav: { climbVS: 2000, descVS: -2000 } };
  }

  // -------------------- CDU state --------------------
  const state = {
    page: "IDENT", // IDENT | AIRCRAFT | INIT | LEGS | DIR | VNAV | PROG | APCTL
    scratch: "",
    msg: "",
    execLit: false,
    legsPage: 0,
    dirPage: 0,

    act: {
      ident: { box: "GEOFS CDU", callsign: getCallsign(), date: isoDate(), aircraft: "A320" },
      init:  { from: "----", to: "----", flt: "------", crz: 35000, cost: 30 },
      legs:  [],
      vnav:  { desAlt: 3000, vs: -2200 }, // VNAV-Lite settings
    },
    mod: null
  };

  const activeData = () => state.mod || state.act;
  const modTag = () => (state.mod ? "<span class='amber'>MOD</span>" : "<span class='dim'>ACT</span>");

  function armExec() {
    if (!state.mod) state.mod = JSON.parse(JSON.stringify(state.act));
    state.execLit = true;
  }
  function clearMod() {
    state.mod = null;
    state.execLit = false;
  }

  function commitExec() {
    // push staged AP writes first
    if (state.execLit && state.mod && state.mod.__apWrite && geoReady()) {
      const w = state.mod.__apWrite;
      setAPTargets(w);
      delete state.mod.__apWrite;
    }

    // commit data
    if (state.execLit && state.mod) {
      state.act = state.mod;
      clearMod();
      state.msg = "";
    }
  }

  // -------------------- UI --------------------
  let root, screen, execLamp;

  function make(tag, cls, txt) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (txt !== undefined) el.textContent = txt;
    return el;
  }

  function mount() {
    if (document.getElementById("unique-geofs-cdu")) return;

    root = make("div", "cdu-root");
    root.id = "unique-geofs-cdu";

    const style = make("style");
    style.textContent = `
      .cdu-root{
        position:fixed; right:18px; bottom:70px; z-index:999999;
        background:#141414; border:2px solid #4b4b4b; border-radius:0;
        box-shadow:0 0 14px #000;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
        transform:scale(.86); transform-origin:bottom right;
        user-select:none;
      }
      .cdu-topbar{
        display:flex; align-items:center; justify-content:space-between;
        padding:6px 10px; border-bottom:2px solid #2b2b2b; background:#101010;
        color:#d6ffd6; letter-spacing:1px; font-size:12px;
      }
      .exec-lamp{
        width:54px; text-align:center; padding:2px 0;
        border:1px solid #2b2b2b; background:#000; color:#2a2a2a;
        font-weight:900;
      }
      .exec-lamp.on{ color:#b8ffb8; border-color:#5a5a5a; }
      .cdu-body{ display:flex; gap:10px; padding:10px; }
      .lsk-col{ display:flex; flex-direction:column; gap:8px; }
      .lsk{
        width:44px; height:34px; background:#1c1c1c; border:2px solid #3a3a3a;
        color:#d6ffd6; font-weight:900; cursor:pointer;
      }
      .lsk:active{ background:#2a2a2a; }
      .screen{
        width:380px; height:270px; background:#000; border:2px solid #2f2f2f;
        padding:8px 10px;
        color:#b8ffb8; font-size:14px; line-height:1.25;
        display:flex; flex-direction:column; justify-content:space-between;
      }
      .title{ text-align:center; font-weight:900; letter-spacing:1px; }
      .row{ display:flex; justify-content:space-between; }
      .dim{ opacity:.78; }
      .white{ color:#f1fff1; }
      .amber{ color:#ffd27a; }
      .cyan{ color:#7fd7ff; }
      .mag{ color:#a6a6ff; }
      .msg{ color:#ff6a6a; min-height:18px; }
      .scratch{ color:#7fd7ff; min-height:18px; }
      .bottom{
        display:flex; justify-content:space-between; align-items:center;
        border-top:2px solid #2b2b2b; padding-top:6px; margin-top:6px;
      }
      .keys{
        display:grid; grid-template-columns:repeat(8, 46px); gap:6px;
        padding:10px; border-top:2px solid #2b2b2b; background:#101010;
      }
      .k{
        height:34px; background:#1c1c1c; border:2px solid #3a3a3a;
        color:#d6ffd6; font-weight:900; cursor:pointer;
      }
      .k:active{ background:#2a2a2a; }
      .k.fn{ color:#ffd27a; }
      .k.wide{ grid-column:span 2; }
    `;
    document.head.appendChild(style);

    const top = make("div", "cdu-topbar");
    const left = make("div", "", "CDU");
    const mid = make("div", "", getCallsign());
    execLamp = make("div", "exec-lamp", "EXEC");
    top.append(left, mid, execLamp);

    const body = make("div", "cdu-body");
    const lcol = make("div", "lsk-col");
    const rcol = make("div", "lsk-col");

    for (let i = 1; i <= 6; i++) {
      const b = make("button", "lsk", `L${i}`);
      b.addEventListener("click", () => onLSK("L", i));
      lcol.appendChild(b);
    }
    for (let i = 1; i <= 6; i++) {
      const b = make("button", "lsk", `R${i}`);
      b.addEventListener("click", () => onLSK("R", i));
      rcol.appendChild(b);
    }

    screen = make("div", "screen");
    body.append(lcol, screen, rcol);

    const keys = make("div", "keys");
    const keyLayout = [
      ["IDENT","AIR","INIT","LEGS","DIR","VNAV","PROG","APCTL"],
      ["A","B","C","D","E","F","G","H"],
      ["I","J","K","L","M","N","O","P"],
      ["Q","R","S","T","U","V","W","X"],
      ["Y","Z","/","-",".","SP","DEL","CLR"],
      ["1","2","3","4","5","6","7","8"],
      ["9","0","+","↑","↓","IMPORT","EXEC","HIDE"]
    ];

    keyLayout.forEach((row) => row.forEach((label) => {
      const btn = make("button", "k", label);
      if (["IDENT","AIR","INIT","LEGS","DIR","VNAV","PROG","APCTL","IMPORT","EXEC","CLR","HIDE"].includes(label)) btn.classList.add("fn");
      if (label === "IMPORT") btn.classList.add("wide");
      btn.addEventListener("click", () => onKey(label));
      keys.appendChild(btn);
    }));

    root.append(top, body, keys);
    document.body.appendChild(root);

    // keyboard input
    document.addEventListener("keydown", (e) => {
      if (!root || root.style.display === "none") return;

      if (/^[a-zA-Z0-9]$/.test(e.key)) {
        e.preventDefault(); e.stopPropagation();
        state.scratch += e.key.toUpperCase();
        state.msg = "";
        render();
        return;
      }
      if (e.key === "Backspace") {
        e.preventDefault(); e.stopPropagation();
        state.scratch = state.scratch.slice(0, -1);
        render();
        return;
      }
      if (e.key === " ") {
        e.preventDefault(); e.stopPropagation();
        state.scratch += " ";
        render();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault(); e.stopPropagation();
        if (state.execLit) commitExec();
        render();
      }
    }, true);

    render();
    startLiveRefresh();
  }

  function line(l, r) {
    return `<div class="row"><span>${l || ""}</span><span>${r || ""}</span></div>`;
  }

  function vnavComputeTD() {
    if (!geoReady()) return null;

    const lv = LV();
    const gs = safeNum(lv.groundSpeedKnt) ?? 0;

    const d = activeData();
    const curAlt = safeNum(lv.altitude) ?? 0;
    const tgtAlt = safeNum(d.vnav.desAlt) ?? 0;

    const vs = safeNum(d.vnav.vs);
    const useVS = (vs !== null && vs !== 0) ? vs : -2000; // fpm

    const delta = curAlt - tgtAlt;
    if (delta <= 0) return { nm: 0, min: 0 };

    const minutes = delta / Math.abs(useVS);
    const nm = (gs * minutes) / 60;

    return { nm, min: minutes };
  }

  function render() {
    if (!screen) return;
    execLamp.classList.toggle("on", state.execLit);

    const d = activeData();
    const prof = getProfile(d.ident.aircraft);

    // keep topbar callsign live
    state.act.ident.callsign = getCallsign();

    let html = "";

    if (state.page === "IDENT") {
      html += `<div class="title">${d.ident.box} ${modTag()}</div>`;
      html += line("CALLSIGN", `<span class="white">${d.ident.callsign}</span>`);
      html += line("AIRCRAFT", `<span class="white">${d.ident.aircraft}</span>`);
      html += line("MODEL", `<span class="dim">${prof.name}</span>`);
      html += line("DATE", `<span class="white">${d.ident.date}</span>`);
      html += `<div class="dim">L6 AIR  |  R6 APCTL</div>`;
    }

    if (state.page === "AIRCRAFT") {
      html += `<div class="title">AIRCRAFT ${modTag()}</div>`;
      html += line("TYPE", `<span class="cyan">${d.ident.aircraft}</span>`);
      html += line("NAME", `<span class="dim">${prof.name}</span>`);
      html += line("MAX ALT", `<span class="white">${prof.maxAlt} FT</span>`);
      html += line("VMO", `<span class="white">${prof.vmo} KT</span>`);
      html += line("MAX VS", `<span class="white">${prof.maxVS} FPM</span>`);
      html += `<div class="dim">Type e.g. A320/B738/C172 then L1</div>`;
    }

    if (state.page === "INIT") {
      html += `<div class="title">INIT ${modTag()}</div>`;
      html += line("FROM", `<span class="${d.init.from==="----"?"amber":"white"}">${d.init.from}</span>`);
      html += line("TO", `<span class="${d.init.to==="----"?"amber":"white"}">${d.init.to}</span>`);
      html += line("FLT NO", `<span class="${d.init.flt==="------"?"amber":"white"}">${d.init.flt}</span>`);
      html += line("COST IDX", `<span class="white">${d.init.cost}</span>`);
      html += line("CRZ ALT", `<span class="white">${d.init.crz} FT</span>`);
      html += `<div class="dim">L1 FROM  L2 TO  L3 FLT  L4 COST  L5 CRZ</div>`;
    }

    if (state.page === "LEGS") {
      html += `<div class="title">LEGS ${modTag()}</div>`;
      const per = 6;
      const legs = d.legs || [];
      const pages = Math.max(1, Math.ceil(legs.length / per));
      state.legsPage = clamp(state.legsPage, 0, pages - 1);
      const start = state.legsPage * per;
      const slice = legs.slice(start, start + per);

      html += line("SEQ", "WPT");
      if (!slice.length) {
        html += `<div class="amber">NO LEGS — PRESS IMPORT</div>`;
      } else {
        slice.forEach((w, i) => {
          const ident = w.ident || w;
          html += line(String(start + i + 1).padStart(2, "0"), `<span class="white">${ident}</span>`);
        });
      }
      html += `<div class="dim">PAGE ${state.legsPage + 1}/${pages} | ↑↓ scroll | L6 IMPORT</div>`;
    }

    if (state.page === "DIR") {
      html += `<div class="title">DIR TO ${modTag()}</div>`;
      const per = 6;
      const legs = d.legs || [];
      const pages = Math.max(1, Math.ceil(legs.length / per));
      state.dirPage = clamp(state.dirPage, 0, pages - 1);
      const start = state.dirPage * per;
      const slice = legs.slice(start, start + per);

      html += line("SELECT", "WAYPOINT");
      if (!slice.length) {
        html += `<div class="amber">IMPORT LEGS FIRST</div>`;
      } else {
        slice.forEach((w, i) => {
          const ident = w.ident || w;
          html += line(`L${i + 1}`, `<span class="white">${ident}</span>`);
        });
      }
      html += `<div class="dim">Press L1..L6 to DIR. Sets HDG to bearing. EXEC applies.</div>`;
      html += `<div class="dim">PAGE ${state.dirPage + 1}/${pages} | ↑↓ scroll</div>`;
    }

    if (state.page === "VNAV") {
      html += `<div class="title">VNAV-LITE ${modTag()}</div>`;
      const td = vnavComputeTD();
      const tdNm = td ? td.nm : null;
      const tdMin = td ? td.min : null;

      html += line("CRZ ALT", `<span class="white">${d.init.crz} FT</span>`);
      html += line("DES ALT", `<span class="white">${d.vnav.desAlt} FT</span>`);
      html += line("DES VS", `<span class="white">${d.vnav.vs} FPM</span>`);
      html += line("T/D", tdNm === null ? `<span class="amber">NO DATA</span>` : `<span class="mag">${tdNm.toFixed(1)} NM</span>`);
      html += line("T/D TIME", tdMin === null ? "" : `<span class="mag">${tdMin.toFixed(1)} MIN</span>`);
      html += `<div class="dim">L1 DES ALT  L2 DES VS  |  L6 LOAD VS->AP then EXEC</div>`;
    }

    if (state.page === "PROG") {
      html += `<div class="title">PROG</div>`;
      if (!geoReady()) {
        html += `<div class="amber">WAITING FOR GEOFS…</div>`;
      } else {
        const lv = LV();
        const ap = APV();
        html += line("ALT", `<span class="white">${Math.round(lv.altitude)} FT</span>`);
        html += line("GS", `<span class="white">${Math.round(lv.groundSpeedKnt)} KT</span>`);
        html += line("HDG", `<span class="white">${Math.round(lv.heading)}°</span>`);
        html += line("AP HDG", `<span class="mag">${pad3(ap.course)}°</span>`);
        html += line("AP SPD", `<span class="mag">${String(ap.speed)}</span>`);
        html += line("AP ALT", `<span class="mag">${String(ap.altitude)}</span>`);
      }
      html += `<div class="dim">R6 APCTL</div>`;
    }

    if (state.page === "APCTL") {
      html += `<div class="title">AP CONTROL ${modTag()}</div>`;
      if (!geoReady()) {
        html += `<div class="amber">GEOFS NOT READY</div>`;
      } else {
        const ap = APV();
        html += line("HDG SEL", `<span class="white">${pad3(ap.course)}°</span>`);
        html += line("SPD SEL", `<span class="white">${String(ap.speed)}</span>`);
        html += line("ALT SEL", `<span class="white">${String(ap.altitude)} FT</span>`);
        html += line("VS SEL", `<span class="white">${ap.verticalSpeed ?? 0} FPM</span>`);
        html += line("LIMITS", `<span class="dim">VMO ${prof.vmo} | MAXALT ${prof.maxAlt}</span>`);
        html += `<div class="dim">Type then L1=HDG L2=SPD L3=ALT L4=VS, then EXEC</div>`;
      }
    }

    const bottomLeft = state.msg
      ? `<div class="msg">${state.msg}</div>`
      : `<div class="scratch">${state.scratch || ""}</div>`;

    html += `<div class="bottom">${bottomLeft}<div class="dim">${state.page}</div></div>`;
    screen.innerHTML = html;
  }

  // -------------------- input handling --------------------
  function takeScratch() {
    const s = (state.scratch || "").trim().toUpperCase();
    state.scratch = "";
    return s;
  }

  function onKey(label) {
    state.msg = "";

    if (label === "HIDE") { root.style.display = "none"; return; }
    if (label === "EXEC") { commitExec(); render(); return; }
    if (label === "CLR") { state.scratch = ""; state.msg = ""; render(); return; }
    if (label === "DEL") { state.scratch = state.scratch.slice(0, -1); render(); return; }
    if (label === "SP") { state.scratch += " "; render(); return; }

    if (label === "↑") {
      if (state.page === "LEGS") state.legsPage = Math.max(0, state.legsPage - 1);
      if (state.page === "DIR") state.dirPage = Math.max(0, state.dirPage - 1);
      render(); return;
    }
    if (label === "↓") {
      if (state.page === "LEGS") state.legsPage += 1;
      if (state.page === "DIR") state.dirPage += 1;
      render(); return;
    }

    // page keys
    if (label === "AIR") label = "AIRCRAFT";
    if (["IDENT","AIRCRAFT","INIT","LEGS","DIR","VNAV","PROG","APCTL"].includes(label)) {
      state.page = label;
      render();
      return;
    }

    if (label === "IMPORT") {
      const legs = importFlightPlan();
      if (!legs.length) { state.msg = "NO ROUTE FOUND"; render(); return; }
      armExec();
      state.mod.legs = legs;
      state.page = "LEGS";
      render();
      return;
    }

    // typeable keys
    if (/^[A-Z0-9\/\-\.\+]$/.test(label)) {
      state.scratch += label;
      render();
    }
  }

  function invalid() {
    state.msg = "INVALID ENTRY";
    render();
  }

  function onLSK(side, idx) {
    const s = takeScratch();
    const d = activeData();
    const prof = getProfile(d.ident.aircraft);

    // IDENT shortcuts
    if (state.page === "IDENT") {
      if (side === "L" && idx === 6) state.page = "AIRCRAFT";
      if (side === "R" && idx === 6) state.page = "APCTL";
      render(); return;
    }

    // AIRCRAFT set (L1)
    if (state.page === "AIRCRAFT") {
      if (side === "L" && idx === 1) {
        if (!s || !/^[A-Z0-9]{3,5}$/.test(s)) return invalid();
        armExec();
        state.mod.ident.aircraft = s;
        // adjust default vnav vs if profile exists
        const p2 = getProfile(s);
        state.mod.vnav.vs = p2.vnav.descVS;
        // clamp CRZ
        state.mod.init.crz = clamp(state.mod.init.crz, 0, p2.maxAlt);
        render(); return;
      }
      render(); return;
    }

    // INIT setters
    if (state.page === "INIT") {
      if (!s) return render();
      if (side === "L" && idx === 1) { if (!/^[A-Z]{4}$/.test(s)) return invalid(); armExec(); state.mod.init.from = s; }
      else if (side === "L" && idx === 2) { if (!/^[A-Z]{4}$/.test(s)) return invalid(); armExec(); state.mod.init.to = s; }
      else if (side === "L" && idx === 3) { if (!/^[A-Z0-9]{2,8}$/.test(s)) return invalid(); armExec(); state.mod.init.flt = s; }
      else if (side === "L" && idx === 4) { if (!/^\d{1,3}$/.test(s)) return invalid(); armExec(); state.mod.init.cost = clamp(parseInt(s,10),0,999); }
      else if (side === "L" && idx === 5) {
        if (!/^\d{1,5}$/.test(s)) return invalid();
        armExec();
        const a = clamp(parseInt(s,10), 0, prof.maxAlt);
        state.mod.init.crz = a;
      }
      render(); return;
    }

    // LEGS import on L6
    if (state.page === "LEGS") {
      if (side === "L" && idx === 6) {
        const legs = importFlightPlan();
        if (!legs.length) { state.msg = "NO ROUTE FOUND"; render(); return; }
        armExec(); state.mod.legs = legs;
        render(); return;
      }
      render(); return;
    }

    // DIR TO: L1..L6 selects waypoint, stage heading, EXEC applies
    if (state.page === "DIR") {
      const per = 6;
      const legs = d.legs || [];
      const start = state.dirPage * per;
      const chosen = legs[start + (idx - 1)];

      if (side === "L" && idx >= 1 && idx <= 6) {
        if (!chosen) { state.msg = "NO WPT"; return render(); }

        const pos = getPos();
        if (!pos) { state.msg = "NO POS"; return render(); }

        const lat2 = safeNum(chosen.lat);
        const lon2 = safeNum(chosen.lon);

        if (lat2 === null || lon2 === null) {
          state.msg = "NO LAT/LON";
          return render();
        }

        const hdg = bearingDeg(pos.lat, pos.lon, lat2, lon2);
        armExec();
        state.mod.__apWrite = state.mod.__apWrite || {};
        state.mod.__apWrite.hdg = hdg;
        state.msg = `DIR ${chosen.ident} HDG ${pad3(hdg)}`;
        render();
        return;
      }
      render(); return;
    }

    // VNAV-Lite
    if (state.page === "VNAV") {
      if (side === "L" && idx === 1) { // DES ALT
        if (!/^\d{1,5}$/.test(s)) return invalid();
        armExec();
        state.mod.vnav.desAlt = clamp(parseInt(s,10), 0, prof.maxAlt);
        render(); return;
      }
      if (side === "L" && idx === 2) { // DES VS
        if (!/^-?\d{1,5}$/.test(s)) return invalid();
        armExec();
        state.mod.vnav.vs = clamp(parseInt(s,10), -prof.maxVS, prof.maxVS);
        render(); return;
      }
      if (side === "L" && idx === 6) { // load VNAV VS to AP then EXEC
        if (!geoReady()) { state.msg = "NO GEOFS"; return render(); }
        armExec();
        state.mod.__apWrite = state.mod.__apWrite || {};
        state.mod.__apWrite.vs = clamp(parseInt(String(d.vnav.vs),10), -prof.maxVS, prof.maxVS);
        state.msg = "VNAV VS LOADED -> EXEC";
        render(); return;
      }
      render(); return;
    }

    // APCTL setters
    if (state.page === "APCTL") {
      if (!geoReady()) { state.msg = "NO GEOFS"; return render(); }
      if (!s) return render();

      armExec();
      state.mod.__apWrite = state.mod.__apWrite || {};

      if (side === "L" && idx === 1) { // HDG
        if (!/^\d{1,3}$/.test(s)) return invalid();
        state.mod.__apWrite.hdg = norm360(parseInt(s, 10));
      } else if (side === "L" && idx === 2) { // SPD
        if (!/^\d{1,3}$/.test(s)) return invalid();
        state.mod.__apWrite.spd = clamp(parseInt(s, 10), 0, prof.vmo);
      } else if (side === "L" && idx === 3) { // ALT
        if (!/^\d{1,5}$/.test(s)) return invalid();
        state.mod.__apWrite.alt = clamp(parseInt(s, 10), 0, prof.maxAlt);
      } else if (side === "L" && idx === 4) { // VS
        if (!/^-?\d{1,5}$/.test(s)) return invalid();
        state.mod.__apWrite.vs = clamp(parseInt(s, 10), -prof.maxVS, prof.maxVS);
      }
      render(); return;
    }

    // PROG shortcut
    if (state.page === "PROG") {
      if (side === "R" && idx === 6) state.page = "APCTL";
      render(); return;
    }

    render();
  }

  // -------------------- live refresh --------------------
  function startLiveRefresh() {
    setInterval(() => {
      if (!root || root.style.display === "none") return;

      // update topbar callsign
      const top = root.querySelector(".cdu-topbar > div:nth-child(2)");
      if (top) top.textContent = getCallsign();

      render();
    }, 400);
  }

  // -------------------- open button --------------------
  function addButton() {
    if (document.getElementById("cdu-open-btn-unique")) return;

    const btn = document.createElement("button");
    btn.id = "cdu-open-btn-unique";
    btn.textContent = "CDU";
    btn.style.cssText = `
      position:fixed; right:18px; bottom:18px; z-index:999998;
      width:54px; height:40px; border-radius:0;
      border:2px solid #4b4b4b; background:#101010; color:#d6ffd6;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-weight:900; cursor:pointer;
      box-shadow:0 0 10px #000;
    `;
    btn.onclick = () => {
      const r = document.getElementById("unique-geofs-cdu");
      if (!r) mount();
      else r.style.display = (r.style.display === "none") ? "block" : "none";
    };
    document.body.appendChild(btn);
  }

  function boot() {
    addButton();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

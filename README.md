
# GeoFS CDU Suite (AIRCRAFT + VNAV-Lite + DIR + LEGS + AP)

A lightweight CDU-style control panel for GeoFS that can **stage** changes (MOD) and **apply** them with **EXEC**.  
Includes **AP target control**, **route/legs import**, **DIR-TO bearing**, and a **VNAV-Lite top-of-descent estimate**.

---

## Features
- **APCTL (Autopilot Control):** set **HDG / SPD / ALT / VS** via CDU (staged → EXEC).
- **LEGS:** import flight plan legs from GeoFS (best via `geofs.nav.flightPlan`).
- **DIR:** select a waypoint to compute **bearing** and stage **HDG** to it (EXEC applies).
- **VNAV-Lite:** quick **T/D estimate** based on current altitude, target altitude, GS, and descent VS.
- **Aircraft profiles:** basic limits (VMO, max alt, max VS) for common types (A320, B738, etc.).
- **Live refresh:** CDU updates a few times per second.

---

## Install
1. Install **Tampermonkey** (Chrome/Edge) or **Violentmonkey** (Firefox).
2. Create a **New Script**.
3. Paste the full script code.
4. Save.
5. Open **https://www.geo-fs.com/** and start a flight.

---

## Open / Close
- Click the **CDU** button at the bottom-right of the screen to show/hide the CDU panel.
- Inside the CDU, you can also use the **HIDE** key.

---

## How input works (IMPORTANT)
- Type with your keyboard or click CDU keys.
- Text goes into the **scratchpad** (bottom-left line).
- Press the correct **LSK** (L1–L6 or R1–R6) to load the scratch value into a field.
- If you see **MOD**, your change is staged.
- Press **EXEC** to apply staged changes.

---

## Pages + Controls

### IDENT
- Overview + shortcuts
- **L6** → AIRCRAFT  
- **R6** → APCTL

### AIRCRAFT
- Type an aircraft code then **L1** to set:
  - Examples: `A320`, `B738`, `C172`, `SR22`

### INIT
Type then press:
- **L1** = FROM (4-letter ICAO)
- **L2** = TO (4-letter ICAO)
- **L3** = FLT NO (2–8 chars)
- **L4** = COST INDEX (0–999)
- **L5** = CRZ ALT (feet)

### LEGS
- **IMPORT** (or **L6**) to load legs from GeoFS
- Use **↑ / ↓** to scroll pages

### DIR (Direct-To)
- Requires imported legs **with lat/lon** (best when route comes from `geofs.nav.flightPlan`)
- Press **L1–L6** to select a waypoint → stages heading to the bearing
- Press **EXEC** to apply heading to AP

### VNAV-Lite
- **L1** = DES ALT (feet)
- **L2** = DES VS (fpm, usually negative)
- Shows **T/D NM** and **T/D time**
- **L6** loads VNAV VS into AP staging → press **EXEC** to apply

### PROG
- Shows live aircraft data + AP target readout

### APCTL (Autopilot Control)
Type then press:
- **L1** = HDG (0–359)
- **L2** = SPD (knots, limited by aircraft VMO)
- **L3** = ALT (feet, limited by max alt)
- **L4** = VS (fpm, limited by max VS)
Then press **EXEC** to apply.

---

## Troubleshooting
**Nothing changes after I enter values**
- You must press **EXEC** to apply staged changes.
- Open GeoFS **autopilot panel** at least once (some builds don’t create the AP input boxes until opened).
- Wait until GeoFS is fully loaded (the CDU will show “waiting” style behavior if `geofs` isn’t ready).

**DIR says “NO LAT/LON”**
- Your legs were imported without coordinates (common if only DOM waypoint labels were found).
- Fix: import a route that exists in `geofs.nav.flightPlan` (preferred source).

**“Attempted to assign to readonly property”**
- Some GeoFS builds lock certain AP fields.
- This CDU tries a DOM input fallback; if a field is locked in your build, some direct writes may be ignored.

---

## Notes / Safety
- This is a simulation helper. use responsibly in flights.

---

## License
There is a MIT License. Personal/educational use. If you share it, credit the author of this unique script and don’t re-upload as someone else’s work.

## Acknowledgements
Some development assistance and iteration was supported by AI tools.
All design decisions, testing, integration with GeoFS, and final implementation
were done by me.

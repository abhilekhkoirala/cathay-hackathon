# Cathay Student — Flights & Rewards (hackathon demo)

A responsive student flights-and-rewards app (desktop + mobile) with a small Node backend for **.edu student verification**. No build step. The UI follows the Figma file *Cathay Student — Flight & Rewards* (Home, No Flight Booked, Mobile Home, Mobile No Flight).

> **Concept prototype.** All flights, fares, points, bookings and people are illustrative.

## Quick start

```bash
npm install
cp .env.example .env     # optional — leave SMTP_* empty for demo mode
npm start                # http://localhost:3000   (phone-frame view: /mobile.html)
```

Without any SMTP settings the app runs in **demo mode**: the 6-digit code is shown on screen instead of being emailed. Everything else works the same.

## Demo account (already signed in)

| | |
|---|---|
| Name | Abhilekh Koirala (shown as "Abhilekh K.") |
| Email | `abhilekh@example.com` |
| Password | `demo1234` |
| Member no. | CS 2026 4821 |
| Points | 12,480 (illustrative; 1,240 earned this month) |

Seeded bookings: `K7M2QX` (HKG ⇄ KTM, first flight 38 days from today) · `M7S2HK` (Moscow → HKG, Economy, departs tomorrow so check-in is open: student seating, seat map and perks demo) · `P8C4HN` (past). *Settings → Reset demo data* restores everything.

**Home states:** with an upcoming booking you get the full dashboard (points donut, next flight, flight companion with the 7-day chat lock). With no upcoming booking (cancel `M7S2HK` and `K7M2QX` in *My flights*) it switches to the *No Flight Booked* layout. Inside 7 days of departure the chat card shows as open.
**To demo online check-in** (opens 48 h before departure), change `addDays(38, …)` to `addDays(1, …)` in `data.js` and reset the demo data.

## Student verification ("Cathay Student Verify")

1. Settings → **Verify student status** (or the banner on *Student offers*).
2. Enter any email whose domain has an `edu` label: `name@mit.edu`, `name@cuhk.edu.hk`, `name@student.unsw.edu.au`. (`gmail.com`, `notedu.com` and `edu.com` are rejected.)
3. A 6-digit code is emailed (or shown on screen in demo mode). It expires in 10 minutes, allows 5 attempts, and can be resent every 30 s.
4. After confirming, a **green tick** appears next to the username in the header, on the home greeting, the member card and the profile.

### Sending real email with Amazon SES (SMTP)

1. In the SES console (use the region you'll send from), **verify a sender identity** — a domain or an address like `you@gmail.com`.
2. **SES sandbox:** new accounts can only send *to verified addresses*. Either verify each test recipient (e.g. your `.edu` address) as an identity, or request production access.
3. SES console → **SMTP settings → Create SMTP credentials**. These are *not* your normal AWS access keys.
4. Fill in `.env` (see `.env.example`): `SMTP_HOST` (e.g. `email-smtp.ap-southeast-1.amazonaws.com`), `SMTP_PORT=587`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`.
5. `npm start` — the console prints `Email: SMTP via ...` when it's active.

**Never commit `.env`** (it's in `.gitignore`) and never put credentials in frontend files.

### Hosting notes

- **AWS (recommended): see [DEPLOY.md](DEPLOY.md).** `SENDER_EMAIL=you@gmail.com ./aws/deploy.sh` puts the site on S3 + CloudFront and runs the verify API on Lambda + DynamoDB + SES, all from `aws/template.yaml`.
- **GitHub Pages** is static, so there's no backend: the verify flow automatically falls back to the on-screen demo code. The rest of the app works as before.
- To send real email from a hosted site, deploy `server.js` somewhere (Render, Fly, EC2, a container…), set the `.env` values there, set `ALLOWED_ORIGIN` to your Pages origin, and set `apiBase` in `config.js` to the backend URL.
- State (pending codes) is in memory — fine for a demo; use Redis/DynamoDB if you scale it.

## Student seating

Verified students (18+) are automatically seated next to another student, so a student flying to a new city for the first time can talk to people going to the same university about campus, housing, getting there and everything else, instead of just sleeping through the flight. Verified students see one question, in *Review & pay* and on the trip page: **"Do you want to be seated next to students?"** *Yes* shows a confirmation pop-up and they are seated next to students automatically; *No* means they book and check in like any other passenger. Students never choose their seat themselves.

There is **no student section**. The planner seats students in small groups of 2–3 side by side, e.g. `9A 9B 9C`, then `13A 13B`, from the same university when possible, otherwise any students. **Every other seat stays on sale.** When a paying passenger buys a seat that was planned for a student, the planner re-runs and moves only the students whose group was broken; everyone else keeps their seat. A student's seat is fixed once they check in.

**Demo flow** (after *Settings → Reset demo data* and verifying with e.g. `name@link.cuhk.edu.hk`):

1. *My trips* → `M7S2HK` Moscow → Hong Kong → answer **Yes** to *Do you want to be seated next to students?*
2. **Check in** → *Your seat*: the seat is already chosen, next to another student (e.g. *"40G, next to Mei · CUHK · Same university as you"*).
3. The boarding pass shows a **STUDENT** tag and who you're seated next to.
4. **See how students are seated (demo)** opens the planner: tap any seat to sell it to a paying passenger and watch the affected students get re-seated (the change log lists every move).

Non-students check in with a normal seat map and can pick any free seat, including seats the planner had in mind for students.

**How the planner decides**

1. Students who still sit next to another student keep their seats; checked-in students never move.
2. Everyone else is grouped: same-university groups of 3 or 2 first, then mixed groups (never a group of 1 if it can be avoided).
3. Each group goes into the tightest run of free seats side by side that fits, so bigger gaps stay free for paying passengers.
4. If a group doesn't fit: split it, pair leftover students together, sit them beside any seated student, or borrow one student from a group of 3. Only as a last resort does a student sit alone.

All other students and paying passengers on a flight are **simulated** (generated per flight in `student-zone.js`).

## Student perks

Unlocked automatically by the verified student membership (*Points & rewards*, or the *Student perks* quick link on the Overview), no promo codes:

| Perk | What the student gets | Why it costs Cathay almost nothing |
|---|---|---|
| **Free travel adapter** | A welcome gift for new students: a free adapter for the country of their university (worked out from the verified email: `cuhk.edu.hk` → Hong Kong, Type G; `.ac.uk` → UK; `.edu` → US…), on their first flight to that country, handed out on board by the crew. **Once per study programme.** Not offered when the home plugs are the same. Shown on the trip page and the boarding pass. | A few HK$, once per student, only for those who claim it (crew loads exactly what was claimed). |
| **Invite friends** | Personal link (`#/r/JOHN-XXXX`). When a friend verifies with it and takes their first flight, both get 1,000 miles. Up to 10 friends a year. The link opens the verify page with an "A friend invited you" note. | Miles are only paid after the friend has flown (a new paying customer); capped per year. |
| **Student points** | While studying, flights earn 1.5 student points for every Asia Mile a normal member would earn (*instead of* miles; credited at check-in). Asia Miles from cards, partners and invites keep coming as usual. Both balances show side by side on the member card. Points are **spent during studies** on Economy trips, from each trip page (*Pay with student points*) or the perks page: Wi-Fi messaging pass (1,000), full-flight Wi-Fi (5,000), preferred seat if still empty at check-in (1,000), lounge pass (6,000). At graduation **70% of what's left converts to Asia Miles**, the rest expires. | Cathay pays ≈ 0.89× normal miles, students get 1.05×; every reward is priced at or above its cost to Cathay (maths below). |
| **Graduation gift** | One status tier up for **12 months** (e.g. Gold → Diamond) + 3,000 bonus miles + the student points conversion. Expected graduation date can be saved. | A few lounge visits and miles, to keep the graduate when they start flying for work. |

**Why 70%?** Let k = 1.5 student points per normal mile, r = share converted, p ≈ 85% = students who actually convert at graduation (drop-outs, inactive accounts). Breakage on Asia Miles is the same for everyone, so it cancels out.

- Cathay must not lose: k·r·p ≤ 1, so r ≤ 1 / (1.5 × 0.85) = 78.4%
- Students must not lose vs normal miles: k·r ≥ 1, so r ≥ 66.7%

| r | Student gets | Cathay pays | |
|---|---|---|---|
| 60% | 0.90× | 0.77× | students worse off |
| 65% | 0.98× | 0.83× | students worse off |
| **70%** | **1.05×** | **0.89×** | **chosen** |
| 75% | 1.13× | 0.96× | margin too thin |
| 80% | 1.20× | 1.02× | Cathay loses |

**Rewards during studies:** a student point costs Cathay at most 0.7 × 0.85 × US$0.006 ≈ US$0.0036 if converted. None of these rewards is in the current student fare (which already includes extra baggage and a free date change): Wi-Fi in Economy is paid (US$3.95 messaging on flights up to 6 h, US$12.95–24.95 full Wi-Fi), lounge passes (US$75) can only be bought from Silver tier up, and preferred seats are paid on Light/Essential fares. Messaging pass 1,000 pts ≈ US$3.60 and full Wi-Fi 5,000 pts ≈ US$18 are close to the retail price, so Cathay breaks even even counting lost sales; an empty preferred seat costs ~US$0; a lounge visit (~US$20) is priced 6,000 pts ≈ US$21.60.

70% still breaks even if up to 95% of students convert (1 / (1.5 × 0.95) = 70.2%). The graduation gift (≈ 5,500 miles' worth, ~34% of a typical student's 16,000 miles over 4 years) is covered by the 11% saved on points plus ≈ US$20 of extra margin per student over 4 years (at ~US$0.006 per mile): one extra Cathay flight from one student in five. *(Assumptions to validate with Cathay's real data.)*

Miles from perks are added to the member card; the graduation status shows on the member card and header. Demo buttons simulate a friend joining, their first flight, a term flight (student points) and graduating.

## What works

- **Overview (Home)** — student points + breakdown donut, next flight, flight companion (locks until 7 days before departure), student exclusives, quick links (incl. Student perks), recent activity
- **My flights** — upcoming / past, details, online check-in with seat map (Economy), automatic student seating + seating planner, boarding pass (demo QR), cancel; plus **Book a flight** (return / one-way search, date strip, passenger form → saved in localStorage)
- **Points & rewards** — student points balance, breakdown, student perks (adapter, invites, rewards paid with points, graduation gift) and activity list
- **Student offers** — destination offers from Hong Kong, student verification prompt
- **Retrieve booking** — works signed out (`K7M2QX` + `Koirala`)
- **Travel tools** (from My flights) — flight status, timetable, baggage calculator (others are placeholders)
- **Settings** — account card (student points, Asia Miles), preferences, student verification, sign out
- *Travel community* and *Help centre* are placeholders

## Structure

```
index.html    app shell (sidebar on desktop, header + 4-icon tab bar below 860px)
styles.css    design tokens + responsive styles
data.js       airports, flight generator, seeded Abhilekh + trips + points
student-zone.js  simulated students per flight, economy cabin layout, student seat planner, perks data
app.js        router, views, booking / check-in / seat map / perks / verification UI
config.js     apiBase for the verification backend
server.js     Express: POST /api/verify/start, /api/verify/confirm, GET /api/health (local / any Node host)
mobile.html   phone-frame wrapper around index.html (9:41 status bar)
.env.example  SMTP settings template (server.js only)
aws/          AWS deployment: template.yaml (SAM), lambda/ (same API on Lambda), deploy.sh, destroy.sh, ses-verify.sh, test/
DEPLOY.md     step-by-step AWS install + deploy guide
```

## Ideas to extend

A real flight-companion chat (the card is the entry point), student-only fares behind the green tick, live flight-status API, PWA install.

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

## Public interface first

The app opens as a normal **Cathay** site: book flights, manage bookings, Asia Miles. Nothing about students is shown until you sign in. After signing in, members who aren't verified students get a one-time pop-up (*"Studying at university?"*) with **Verify my student email** and **Discover student benefits** (`#/discover`). Once verified, the student interface appears: student points, perks, student seating, student offers.

## Accounts

There are **no built-in users or bookings**. Create an account (*Sign in → Create an account*: name, email, password, date of birth); a member number and a personal invite code are generated. New accounts start empty: no trips, 0 student points, 0 Asia Miles.

- **With the server** (`npm start` or the Lightsail deployment): accounts, bookings, perks and student verification are stored on the server (`accounts.js`, passwords hashed with scrypt, 30-day sessions), so the same account works on any phone or laptop.
- **Without a server** (static hosting): accounts are stored in that browser only, and the sign-in page says so.

*Settings → Clear my bookings and perks* empties the current account (the account and student verification stay).

## Fares and seat selection

Economy is sold as **Light, Essential and Flex**, as on cathaypacific.com: on **Light, seat selection is a paid extra**; on Essential, Flex and every premium cabin it's included.

- **Economy Light check-in:** the seat map is locked. Unlock seat choice for that flight with **1,000 student points** (verified students) or **2,500 Asia Miles**, or take a free assigned seat.
- **Verified students who answer Yes** to student seating are seated automatically next to students on any Economy fare (they don't choose a seat).
- **Premium Economy (2-4-2), Business (1-2-1) and First (1-1-1)** have their own seat maps with free choice. Seats are claimed on the server: if two people pick the same seat at once, the second is told it was just taken.
- **New verified students** get a one-time **1,500 student points welcome bonus**, enough for one seat unlock.

## Landing page (`landing.html`)

A cinematic, scroll-driven opening page for the pitch: one camera move from a jet at the gate at sunset, into the cabin window, out above the clouds and into the light, with two-line headlines (Family Circle → student seating → student points → "Stay in the circle. Until 25.") and a counter in the corner. Below it: Cathay at a glance, what's inside the app (live features + coming next) and why it works for Cathay. Every button opens the app (`index.html`).

- Drawn entirely on a `<canvas>` (no images or libraries), so it works offline; respects *reduce motion*.
- `landing.html?p=0.5` freezes the story at that point (useful for screenshots and slides).
- Facts used: founded 1946 in Hong Kong, 100+ destinations, founding oneworld member (Cathay Pacific, 2026).

## Live demo: shared flights and seats (two phones)

With `npm start` (or on a cloud machine, see below), every phone that opens the site shares **one set of flights and seats**:

- **Real schedules:** searches return real Cathay Pacific flights from the **OAG Flight Info API**, fetched by the server. Set `OAG_KEY` in `.env`; the key never reaches the browser. Answers are cached per route and day to save quota. Without a key, or when OAG fails, the app shows the simulated schedule and labels it.
- **Shared seats, real data only:** bookings, check-in seats and student seating are stored on the server (`data/live-db.json`). There are no simulated passengers or students: every taken seat and every ★ is a real booking. When anyone books or checks in, every open phone updates within a second (Server-Sent Events).
- **Real students together:** verified students on different phones are seated side by side, same university first (verify both with the same university domain for the demo). If another passenger chooses a seat planned for them, they move together, and the planner's change log says so (no names).
- **Two people, one seat:** if two people pick the same seat at once, the second gets "That seat was just taken".

**Demo:**
1. Create an account on each phone and verify both as students (same university domain).
2. Book the same flight for tomorrow with "Yes" to student seating.
3. Check in on both: each is seated next to the other.
4. Open *See how students are seated* on a laptop and sell the seat planned for one of them. Both phones re-seat live.

**Without the server** (any static host, `python3 -m http.server`), everything still works per device in localStorage.

**Hosting for phones over the internet:** `HOST=ubuntu@<ip> SSH_KEY=<key.pem> bash aws/seat-server.sh` puts it on a Lightsail or EC2 Ubuntu machine. That needs no IAM role, just SSH; open TCP port 3000 in the firewall. Quick alternative from a laptop: `npm start`, then `cloudflared tunnel --url http://localhost:3000`.

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

**Privacy:** names are never shown to other passengers, on any screen or in any API answer: other students appear as **★ Student**. A student's university is shown only if they ticked *"Show my university to students seated near me"* when booking (changeable on the trip page). Hover a ★ in the planner for a small panel: *"Student · CUHK"* or *"Student · university not shared"*.

**Demo flow** (verify with e.g. `name@link.cuhk.edu.hk`):

1. Book an Economy flight for tomorrow (check-in opens 48 h before) and answer **Yes** to *Do you want to be seated next to students?*
2. **Check in** → *Your seat*: the seat is already chosen, next to other students (e.g. *"40G, next to 2 students · one from CUHK · Same university as you"*).
3. The boarding pass shows a **STUDENT** tag and how many students you're seated next to.
4. **See student seating on this flight** opens a live, read-only view of the cabin: students as ★, other passengers, free seats and a change log. It isn't offered on Economy Light (no seat choice there).

Non-students check in with a normal seat map and can pick any free seat, including seats the planner had in mind for students.

**How the planner decides**

1. Students who still sit next to another student keep their seats; checked-in students never move.
2. Everyone else is grouped: same-university groups of 3 or 2 first, then mixed groups (never a group of 1 if it can be avoided).
3. Each group goes into the tightest run of free seats side by side that fits, so bigger gaps stay free for paying passengers.
4. If a group doesn't fit: split it, pair leftover students together, sit them beside any seated student, or borrow one student from a group of 3. Only as a last resort does a student sit alone.

Only real bookings are shown. (`SIMULATE` in `student-zone.js` can switch simulated background passengers back on for offline demos.)

## Student flight chat (safety by design)

A group chat per flight for verified students, run by our server (`chat-server.js`). Every rule below is enforced on the server, not only in the browser. It replaces the earlier AppSync chat, whose public API key let anyone with the site post in any room: **delete that stack if it was deployed** (`aws cloudformation delete-stack --stack-name aurelia-chat`).

**Implemented in the prototype**

- **Who:** signed-in account + student status recorded by the server when the university-email code was confirmed + aged 18+ on the departure date + an active booking on that flight + not removed for conduct.
- **When:** opens 7 days before departure; messages deleted 48 h after arrival (scheduled arrival here; use the actual arrival from a flight-status feed in production).
- **Group only:** one room per flight, no private or one-to-one messages. Joining is voluntary (guidelines must be accepted) and students can leave at any time.
- **Data minimisation:** others see a first name, a verified tick and, only if the student opted in when booking, a university. Never a surname, email, booking, seat or seating preference.
- **Private seat opt-out:** *"Don't seat me next to them"* on a message moves the other person at the next seating run. Nobody is told, and nobody can ask to sit next to someone.
- **Reporting:** report any message with a reason (harassment, sexual, discrimination, bullying, threat, impersonation, doxxing, spam, solicitation, other). The reported person never learns who reported them.
- **Moderation** (`#/moderation`, for accounts listed in `MODERATORS` in `.env`): moderators see the report with its context, set a severity (low / medium / high / critical) and dismiss it or confirm a violation. Confirmed messages are removed for everyone.
- **Two-strike rule (team policy):** 1st confirmed violation = warning in the chat; 2nd = removed from the chat and the booking on that flight cancelled **with no refund**. Critical cases (threats, safety) are also removed from the chat at once and escalated to the airline's security team. A device can't undo a server-side cancellation.
- **Evidence retention:** a report copies the message and its context to a separate, moderator-only store: up to 180 days, 30 days if dismissed, longer only under a legal hold. Everything else follows the 48 h deletion.
- **Information pages:** *Safety & privacy* (`#/chat-safety`) for students and an FAQ for parents (`#/parents`). Parents never get access to adult students' conversations.

**Proposed, not implemented (needs people and process):** a staffed moderation team with response times; appeals; an escalation path to airline security and the police; a PDPO-compliant privacy notice and data access/correction process; a retention schedule confirmed by legal; and cabin-crew guidance.

**For review by qualified Hong Kong legal counsel and the airline's safeguarding team:**

- **The two-strike rule:** cancellation without refund for chat conduct may be challenged as unfair under consumer law and the conditions of carriage.
- **The 180 / 30-day evidence periods.**
- **Cross-border data:** the server runs in Sydney (`ap-southeast-2`), not in Hong Kong.
- **What university-email verification proves:** access to a mailbox, not identity or enrolment.
- **Moderators reading reported content.**
- **Retaliation protections.**

## Student perks

Unlocked automatically by the verified student membership (*Points & rewards*, or the *Student perks* quick link on the Overview), no promo codes:

| Perk | What the student gets | Why it costs Cathay almost nothing |
|---|---|---|
| **Free travel adapter** | A welcome gift for new students: a free adapter for the country of their university (worked out from the verified email: `cuhk.edu.hk` → Hong Kong, Type G; `.ac.uk` → UK; `.edu` → US…), on their first flight to that country, handed out on board by the crew. **Once per study programme.** Not offered when the home plugs are the same. Shown on the trip page and the boarding pass. | A few HK$, once per student, only for those who claim it (crew loads exactly what was claimed). |
| **Invite friends** | Personal link (`#/r/JOHN-XXXX`). It opens sign-up with an "Invited by a friend" note; when the friend verifies and takes their first flight, you get 1,000 miles (shown as *Friend J.*, initial only). Up to 10 friends a year. | Miles are only paid after the friend has flown (a new paying customer); capped per year. |
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

Miles from perks are added to the member card; the graduation status shows on the member card and header. *Simulate graduation (demo)* shows the graduation gift, since nobody graduates during a pitch. Every balance change (check-in points, welcome bonus, seat unlocks, rewards, invites) is listed under *Recent activity*.

## What works

- **Overview (Home)** — student points + breakdown donut, next flight, flight companion (locks until 7 days before departure), student exclusives, quick links (incl. Student perks), recent activity
- **My flights** — upcoming / past, details, online check-in with seat maps for every cabin, automatic student seating + live student seating view, student flight chat, boarding pass (demo QR), cancel; plus **Book a flight** (return / one-way search, date strip, passenger form → saved in localStorage)
- **Points & rewards** — student points balance, breakdown, student perks (adapter, invites, rewards paid with points, graduation gift) and activity list
- **Student offers** — destination offers from Hong Kong, student verification prompt
- **Retrieve booking** — booking reference + family name (bookings made on this device)
- **Travel tools** (from My flights) — flight status, timetable, baggage calculator (others are placeholders)
- **Settings** — account card (student points, Asia Miles), preferences, student verification, sign out
- *Travel community* and *Help centre* are placeholders

## Structure

```
index.html    app shell (sidebar on desktop, header + 4-icon tab bar below 860px)
styles.css    design tokens + responsive styles
data.js       airports, cabins, fares (Light / Essential / Flex), simulated flight generator
student-zone.js  cabin layouts, student seat planner (incl. private exclusions), perks data
app.js        router, views, booking / check-in / seat map / perks / verification UI
config.js     apiBase for the verification backend
server.js     Express: POST /api/verify/start, /api/verify/confirm, GET /api/health (local / any Node host)
accounts.js   sign-up / sign-in / sessions / per-user data / referrals (/api/auth, /api/me)
db.js         JSON-file database shared by accounts.js and live.js
chat-server.js student flight chat: eligibility, reports, moderation, two-strike rule, retention (/api/chat, /api/mod)
live.js       live demo API (/api/live): shared flights and seats, student planner on the server, Server-Sent Events
oag.js        OAG Flight Info API client (server-side, key from .env)
mobile.html   phone-frame wrapper around index.html (9:41 status bar)
.env.example  SMTP settings template (server.js only)
aws/          AWS deployment: template.yaml (SAM), lambda/ (same API on Lambda), deploy.sh, destroy.sh, ses-verify.sh, seat-server.sh (live demo on Lightsail/EC2), test/
DEPLOY.md     step-by-step AWS install + deploy guide
```

## Ideas to extend

Message history for the flight chat (it is live and multi-person now, see DEPLOY.md), student-only fares behind the green tick, live flight-status API, PWA install.

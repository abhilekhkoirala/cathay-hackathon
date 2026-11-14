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

Economy is sold as **Light, Essential and Flex**, as on cathaypacific.com: on **Light, seat selection is a paid extra**; on Essential, Flex and every premium cabin it's included. The server enforces this; see [docs/SEATING.md](docs/SEATING.md).

- **Seat assignment vs seat selection:** an *assigned* seat (the airline picks it) is free on every fare; *selecting* a seat (you pick it) depends on the fare.
- **Economy Light check-in:** seat choice is locked. Buy seat selection for that flight with **1,000 student points** (verified students) or **2,500 Asia Miles**, or check in and get a free assigned seat.
- **Verified students who answer Yes** are allocated a seat in the **Student Zone** on any Economy fare. The zone doesn't override fare rules: Light students get their zone seat assigned; Essential and Flex students can pick another available zone seat.
- **Premium Economy (2-4-2), Business (1-2-1) and First (1-1-1)** have their own seat maps with free choice. Seats are held and confirmed on the server: if two people pick the same seat at once, the second is told it was just taken.
- **New verified students** get a one-time **1,500 student points welcome bonus**, enough for one seat unlock.

## Landing page (`landing.html`)

A cinematic, scroll-driven opening page for the pitch: one camera move from a jet at the gate at sunset, into the cabin window, out above the clouds and into the light, with two-line headlines (Family Circle → student seating → student points → "Stay in the circle. Until 25.") and a counter in the corner. Below it: Cathay at a glance, what's inside the app (live features + coming next) and why it works for Cathay. Every button opens the app (`index.html`).

- Drawn entirely on a `<canvas>` (no images or libraries), so it works offline; respects *reduce motion*.
- `landing.html?p=0.5` freezes the story at that point (useful for screenshots and slides).
- Facts used: founded 1946 in Hong Kong, 100+ destinations, founding oneworld member (Cathay Pacific, 2026).

## Live demo: shared flights and seats (two phones)

With `npm start` (or on a cloud machine, see below), every phone that opens the site shares **one set of flights and seats**:

- **Real schedules:** searches return real Cathay Pacific flights from the **OAG Flight Info API**, fetched by the server. Set `OAG_KEY` in `.env`; the key never reaches the browser. Answers are cached per route and day to save quota. Without a key, or when OAG fails, the app shows the simulated schedule and labels it.
- **One seat inventory on the server:** bookings, the Student Zone, holds and check-in seats are managed by the seating service (`seating/`). There are no simulated passengers. When anything changes, each signed-in phone gets **its own** updated seat map within a second (Server-Sent Events). It never contains other passengers' identities.
- **Students together in the Student Zone:** verified students on different phones are seated side by side in the zone, same university first (verify both with the same university domain for the demo).
- **Two people, one seat:** if two people pick the same seat at once, the second gets "That seat was just taken".

**Demo:**
1. Set `SEAT_OPS=you@example.com` in `.env` (operations console) and `VERIFIERS` (student ID review).
2. Create an account on each phone and verify both as students (same university domain).
3. Book the same flight for tomorrow with "Yes" to student seating. Both get Student Zone seats side by side (trip page → *Student Zone & private seating preferences*).
4. On the ops account (*Settings → Seating operations*), block one of their seats or shrink the zone. The affected phone re-seats live.
5. Check in on both phones.

**Without the server** (any static host, `python3 -m http.server`), search, booking and check-in work per device in localStorage. The Student Zone needs the server.

**Hosting for phones over the internet:** `HOST=ubuntu@<ip> SSH_KEY=<key.pem> bash aws/seat-server.sh` puts it on a Lightsail or EC2 Ubuntu machine. That needs no IAM role, just SSH; open TCP port 3000 in the firewall. Quick alternative from a laptop: `npm start`, then `cloudflared tunnel --url http://localhost:3000`.

## Student verification ("Cathay Student Verify")

Two steps, both checked on the server. A university email alone shows access to a mailbox, not current enrolment, so a student ID is now required too.

**Step 1: university email** (unchanged, `server.js`)
1. Settings → **Verify student status** (or any "verify" banner).
2. Enter any email whose domain has an `edu` label: `name@mit.edu`, `name@cuhk.edu.hk`, `name@student.unsw.edu.au`. (`gmail.com`, `notedu.com` and `edu.com` are rejected.)
3. A 6-digit code is emailed (or shown on screen in demo mode). It expires in 10 minutes, allows 5 attempts, and can be resent every 30 s. One university email can be linked to only one Cathay account at a time.

**Step 2: student ID** (`student-verify.js`)
4. Upload a photo, screenshot or PDF of the student ID (JPG, PNG or PDF, up to 5 MB): from files or the camera, with a preview and *Replace* / *Remove*. The page lists what must be readable (full name, institution, expiry date if any, photo if any) and says the ID number may be covered.
5. Confirm the name and institution as shown, and the expiry date, or tick **"My card doesn't show an expiry date"**. Cards without one are **not rejected**: the student can add an **enrolment letter or official digital student-status record**, or submit anyway; a reviewer then sets validity to the end of the academic year.
6. A reviewer approves or asks for more information. The **green tick** and every student feature appear only after approval.

### Statuses

| Status | Meaning / next step shown to the student |
|---|---|
| Not submitted | Start with your university email. |
| Awaiting document upload | Email verified; upload your student ID. |
| Pending review | A reviewer will check it (1–2 working days); replace it if it's wrong or unclear. |
| Verified | Student features unlocked until the validity date; a reminder appears 30 days before it ends. |
| Rejected — additional information required | The reason (unreadable, name mismatch, expired…) and the reviewer's note; upload a new document. |
| Expired — re-verification required | The validity date passed or the policy changed; student features pause at once. |

**Validity** = the document's expiry date (or the reviewer's date), capped at **12 months**, so everyone re-verifies at least once a year. If the university email was confirmed more than a year ago it must be confirmed again. Raising `STUDENT_POLICY_VERSION` makes every student re-verify. A student re-verifying early keeps access until their current date. If the validity ends before a booked flight, the student is warned, and student features are refused **for that flight** until they re-verify.

### Automated checks (flag only, never reject)

Every upload is checked automatically; the results are shown to the reviewer, and the ones the student can fix are shown to them too:

- **File:** real JPG/PNG/PDF (checked from the file's bytes, not its name), ≤ 5 MB; password-protected PDFs and PDFs with scripts or attachments are refused with an explanation. Images whose shorter side is under 600 px are flagged as possibly unreadable.
- **Same person:** the name typed for the document is compared with the account name (order, accents and middle names ignored). The university email is verified on the same account.
- **Institution:** the email domain is checked against a list of recognised institutions. Unlisted `.edu` domains go to a reviewer; they are not rejected. The institution typed for the document must match the email's.
- **Validity:** the expiry date is read **from the text of digital PDFs** (only dates next to words like "valid until", "expiry" or "programme end", so a date of birth is never taken for one). Otherwise the date the student typed is used. Expired documents, documents that expire before a booked flight, and typed dates that differ from the document are flagged.
- **Reuse:** the same file as a rejected one, or the same file used by another account.

**Automated checks never reject a student. Only a reviewer can.** With `STUDENT_AUTO_APPROVE=pdf-text`, a digital PDF with no flags, whose text contains the account name, a recognised institution and a future expiry date, is approved without a reviewer. This is off by default, because a PDF is easy to fake without a provider that checks authenticity.

### Reviewer console (`#/review`)

**Skip the review for a demo:** set `STUDENT_AUTO_APPROVE=all` in `.env` and restart. Every student ID upload that passes the file checks is then approved immediately. Demo only: nobody checks the document.

**Demo logins:** copy `.env.example` to `.env` and sign in as `verifier@cathay.demo` / `verify-demo-2026` (verification team) or `ops@cathay.demo` / `ops-demo-2026` (seating operations). These accounts are created when the server starts, from `SEED_*` values in `.env`. Change the passwords, and never use them on a server others can reach (the deploy script doesn't copy them).

For accounts listed in `VERIFIERS` (`.env`). It shows the queue with the student's typed details, the automated checks, booked flight dates and a suggested validity date. Documents open from memory (never cached). The reviewer approves (validity date, max 12 months) or rejects with a reason and an optional note. Reviewers can't review their own submission, and a decision made on a document the student has since replaced is refused.

### Security and privacy

- **Server-enforced:** the browser's copy of "verified" is display-only. `/api/me/data` ignores a `verified` value sent by a device, and only a currently verified student can add student-only perks (welcome bonus, rewards paid with student points, adapter). Student seating (`live.js`) and the student chat (`chat-server.js`) check the server record **for the flight date**, and the student's university comes from the verified email, not the request.
- **Private storage:** documents are stored in `data/vault/` (git-ignored, never served by `server.js`) under random ids, **encrypted with AES-256-GCM** using a per-file key wrapped by `DOC_ENCRYPTION_KEY` (envelope encryption).
- **Access:** only reviewers can download a document (`no-store`, sandboxed CSP). Other passengers and students never see documents, ID numbers or verification details; they only see the green tick.
- **Access log:** every submission, view, decision and deletion is logged (`db.verifyAudit`: who, what, when, IP; no document contents) and kept for 365 days.
- **Retention:** a document is **deleted as soon as a decision is made** (deleted on replace or remove too). Unreviewed documents are deleted after 30 days and the student is asked to upload again. Afterwards only the outcome, institution, validity date and a SHA-256 of the file remain. Text read from PDFs is used once and not stored. Students can remove their verification entirely (*Settings → Remove my student verification*).
- **Minimal data:** no passports or other identity documents are asked for, and ID numbers aren't needed or stored.
- Accounts verified with the old email-only flow are moved to *Awaiting document upload*.

### Implemented in the prototype vs. needs a provider or trained people

| Implemented here | Needs a real document-verification provider and/or trained reviewers |
|---|---|
| Email OTP; upload with type/size/content checks; encrypted private storage; status workflow; reviewer console; access log; deletion and retention; expiry, eligibility and policy-version enforcement in chat, seating and perks | **OCR of photos** (reading the name, institution and expiry date from images; the prototype reads digital PDFs only) |
| Name / institution matching against what the student typed, and against PDF text | **Authenticity checks**: tamper/forgery detection, template matching per university, detecting screenshots of screenshots |
| Low-resolution and duplicate-file flags | **Blur / glare / cropping detection** in images; **face match** between the card photo and a selfie (liveness) |
| Recognised-institution list (sample) | The airline's **official eligible-institution list**, kept up to date against official registers |
| Reviewer decisions with reasons | **Trained verification staff**, service levels, appeals, fraud escalation, quality sampling |
| Demo encryption key on disk | **Production storage**: private S3 bucket with SSE-KMS, short-lived presigned URLs for reviewers, lifecycle deletion, KMS key rotation, CloudTrail access logs, region chosen for PDPO cross-border rules |
| | Legal review of retention periods and the privacy notice (PDPO, GDPR for EU students) |

The AWS Lambda edition (`aws/lambda/verify.js`) still covers step 1 (email) only; step 2 runs on the Node server.

**Demo:** set `VERIFIERS=you@example.com` in `.env`, `npm start`, create that reviewer account in one browser and a student account in another. Verify the student's email, upload any card photo, then approve or reject it under *Settings → Student verification queue*.

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

## Student Zone seating

**Full design: [docs/SEATING.md](docs/SEATING.md).** It covers architecture, allocation rules, the data model, the API, production integration and DynamoDB design, and limitations.

Verified students (18+, verification valid on the flight date) who answer **Yes** to *"Do you want to be seated next to students?"* are allocated a seat in the **Student Zone**. This is a block of whole Economy rows on the real seat map (default 48–52 on wide-bodies, 30–33 on the A321neo), set per flight by airline operations.

- **Protected, not wasted:** zone seats can't be sold through other channels while the zone is reserved. Unused zone seats go back on general sale 24 h before departure (configurable), so no seat stays empty because of the zone. Capacity counts real seats only.
- **Grouping:** students are seated in groups of 2–3 side by side, from the same university when possible. Only students whose seat is genuinely affected move when something changes. Checked-in students never move automatically.
- **Private seating preferences:** a student can choose other students on the flight (those visible in its student chat) they'd rather not sit next to. One student's choice applies **both ways**. It's confidential: never shown, never notified, never in any API answer. Students can't ask to sit *next to* someone. The same store is used by *"Don't seat me next to them"* in the chat.
- **Restrictions are hard rules:** if no valid seat exists, the student isn't forced next to someone. They see a neutral *"we need to arrange your seat by hand"* message, and operations get a review to resolve manually (*Settings → Seating operations*).
- **Seat map:** available, selected, your seat, not available (which also covers restricted seats, so nobody can tell why), and Student Zone rows with a subtle marker. No stars and no other passengers' details; a student sees only how many students sit next to them and, if those students chose to share it, their university.
- **Fares:** zone allocation is free on every fare, but choosing a different seat is seat selection: included in Essential and Flex, not in Light.

**Fly with other students:** when a verified student searches, a card suggests dates within ±3 days (same route) whose flights already have the most students booked, and flights show a *"5+ students on this flight"* badge. Only students who chose student seating and were verified by the server are counted, shown only as bands (3+, 5+, 10+): flights with fewer than 3 students are never mentioned, so nobody can be singled out. No names, no exact counts. It uses bookings on our server, not extra OAG calls.


## Student flight chat (safety by design)

A group chat per flight for verified students, run by our server (`chat-server.js`). Every rule below is enforced on the server, not only in the browser. It replaces the earlier AppSync chat, whose public API key let anyone with the site post in any room: **delete that stack if it was deployed** (`aws cloudformation delete-stack --stack-name aurelia-chat`).

**Implemented in the prototype**

- **Who:** signed-in account + verified student status on the server (university email + approved student ID, valid on the departure date) + aged 18+ on the departure date + an active booking on that flight + not removed for conduct.
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
- **What verification proves:** a university email shows access to a mailbox; the student ID check (by a reviewer) adds current enrolment, but not identity to the standard of a passport check.
- **Handling student ID images:** retention, reviewer access and the privacy notice for documents.
- **Moderators reading reported content.**
- **Retaliation protections.**

## Student perks

Unlocked automatically by the verified student membership (*Points & rewards*, or the *Student perks* quick link on the Overview), no promo codes:

| Perk | What the student gets | Why it costs Cathay almost nothing |
|---|---|---|
| **Free travel adapter** | A welcome gift for new students: a free adapter for the country of their university (worked out from the verified email: `cuhk.edu.hk` → Hong Kong, Type G; `.ac.uk` → UK; `.edu` → US…), on their first flight to that country, handed out on board by the crew. **Once per study programme.** Not offered when the home plugs are the same. Shown on the trip page and the boarding pass. | A few HK$, once per student, only for those who claim it (crew loads exactly what was claimed). |
| **Invite friends** | Personal link (`#/r/NAME-XXXX`); it opens sign-up with a pop-up explaining the bonus, and the inviter gets the same explanation the first time they scroll to their invite card. When the friend books their **first flight** (cancelled bookings don't count), **both** get a bonus based on the Asia Miles a normal member earns on that booking: a non-student gets **20%** of it as Asia Miles; a verified student gets **¼ of the booking's student points** (¼ × 1.5 = 0.375 per mile) as student points. Up to 10 friends. Friends show as *Friend J.* (initial only). | The bonus is paid only for a real booking; the student side costs ≈ 0.375 × 0.7 × 0.85 ≈ 0.22 miles per mile, close to the 0.20 of a non-student, while students get more. |
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
- **My flights** — upcoming / past, details, online check-in with seat maps for every cabin, Student Zone allocation with private seating preferences (server-managed, live), student flight chat, boarding pass (demo QR), cancel; plus **Book a flight** (return / one-way search, date strip, passenger form → saved in localStorage)
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
student-zone.js  cabin layouts (shared by app and server), university names, perks helpers
app.js        router, views, booking / check-in / seat map / perks / verification UI
config.js     apiBase for the verification backend
server.js     Express: POST /api/verify/start, /api/verify/confirm (step 1, email), GET /api/health (local / any Node host)
student-verify.js  step 2 (student ID): upload, encrypted storage, status workflow, reviewer API, retention (/api/student, /api/review)
accounts.js   sign-up / sign-in / sessions / per-user data / referrals (/api/auth, /api/me)
db.js         JSON-file database shared by accounts.js and live.js
chat-server.js student flight chat: eligibility, reports, moderation, two-strike rule, retention (/api/chat, /api/mod)
live.js       flight search API (/api/live): OAG schedules (cached) or simulated
seating/      seat inventory + Student Zone (/api/seating): engine.js (allocation), inventory.js (adapter),
              repository.js (persistence), service.js (bookings, holds, check-in, exclusions, reviews), routes.js
docs/SEATING.md  seating architecture, allocation rules, production integration
oag.js        OAG Flight Info API client (server-side, key from .env)
mobile.html   phone-frame wrapper around index.html (9:41 status bar)
.env.example  SMTP settings template (server.js only)
aws/          AWS deployment: template.yaml (SAM), lambda/ (same API on Lambda), deploy.sh, destroy.sh, ses-verify.sh, seat-server.sh (live demo on Lightsail/EC2), test/
DEPLOY.md     step-by-step AWS install + deploy guide
```

## Ideas to extend

Message history for the flight chat (it is live and multi-person now, see DEPLOY.md), student-only fares behind the green tick, live flight-status API, PWA install.

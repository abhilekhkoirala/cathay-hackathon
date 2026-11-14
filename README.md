# Aurelia Air — Hackathon Demo App

A responsive airline app (desktop + mobile) with a small Node backend for **.edu student verification**. No build step.

> **Aurelia Air is a fictional airline.** All flights, fares, bookings and people are fake. It is not affiliated with any real airline or verification provider.

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
| Name | John Doe |
| Email | `john.doe@example.com` |
| Password | `demo1234` |
| Member no. | AU 8800 1234 (Gold) |

Seeded bookings: `K7M2QX` (HKG ⇄ NRT, check-in open) · `R3T9WD` (HKG → LHR) · `P8C4HN` (past). *Profile → Reset demo data* restores everything.

## Student verification ("Aurelia Student Verify")

1. Profile → **Verify student status** (or the banner on Home).
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

## What works

- **Home** — next trip, membership card, offers, verify banner
- **Book** — return / one-way search, date strip, outbound + return selection, passenger form → booking saved in localStorage
- **My trips** — upcoming / past, details, online check-in, boarding pass (demo QR), cancel
- **Retrieve booking** — works signed out (`K7M2QX` + `Doe`)
- **Travel tools** — flight status, timetable, baggage calculator (others are placeholders)
- **Profile** — membership progress, preferences, student verification, sign out

## Structure

```
index.html    app shell
styles.css    responsive styles (tab bar < 860px, top nav above)
data.js       airports, flight generator, seeded John Doe + trips
app.js        router, views, booking / check-in / verification UI
config.js     apiBase for the verification backend
server.js     Express: POST /api/verify/start, /api/verify/confirm, GET /api/health (local / any Node host)
mobile.html   phone-frame wrapper around index.html
.env.example  SMTP settings template (server.js only)
aws/          AWS deployment: template.yaml (SAM), lambda/ (same API on Lambda), deploy.sh, destroy.sh, ses-verify.sh, test/
DEPLOY.md     step-by-step AWS install + deploy guide
```

## Ideas to extend

Seat-map picker, live flight-status API, disruption re-booking assistant, multilingual UI, student-only fares behind the green tick, PWA install.

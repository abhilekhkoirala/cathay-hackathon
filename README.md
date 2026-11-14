# Aurelia Air — Hackathon Demo App

A responsive airline app (desktop + mobile) built with plain HTML/CSS/JS. No build step, no dependencies.

> **Aurelia Air is a fictional airline.** All flights, fares, bookings and people are fake. It is not affiliated with any real airline and is not meant to resemble one's branding.

## Demo account (already signed in)

| | |
|---|---|
| Name | John Doe |
| Email | `john.doe@example.com` |
| Password | `demo1234` |
| Member no. | AU 8800 1234 (Gold) |

The app opens **already logged in as John Doe**. Use *Profile → Sign out* to see the logged-out flow; the sign-in page has a one-click "Continue as John Doe" button. *Profile → Reset demo data* restores the seed.

Seeded bookings: `K7M2QX` (HKG ⇄ NRT, check-in open) · `R3T9WD` (HKG → LHR) · `P8C4HN` (past).

## What works

- **Home** — next trip, membership card, offers
- **Book** — return / one-way search, date strip, outbound + return selection, passenger form, demo payment → creates a real booking in localStorage
- **My trips** — upcoming / past, trip details, online check-in, boarding pass (demo QR), cancel
- **Retrieve booking** — works signed-out (try `K7M2QX` + `Doe`)
- **Travel tools** — flight status, timetable, baggage calculator (others are placeholders to build on)
- **Profile** — membership progress, preferences (saved), sign out

Flights are generated deterministically from route + date (see `generateFlights` in `data.js`), so the demo behaves consistently.

## Run locally

```bash
python3 -m http.server 8000   # or: npx serve
# open http://localhost:8000          (responsive app)
# open http://localhost:8000/mobile.html   (phone-frame preview)
```

## Deploy to GitHub Pages

```bash
git init && git add . && git commit -m "Aurelia Air demo"
git branch -M main
git remote add origin https://github.com/<you>/aurelia-air-demo.git
git push -u origin main
```

Then **Settings → Pages → Deploy from branch → main / (root)**. Your app will be at `https://<you>.github.io/aurelia-air-demo/`.

## Structure

```
index.html    app shell (header, tab bar, toast)
styles.css    responsive styles (tab bar < 860px, top nav above)
data.js       airports, flight generator, seeded John Doe + trips
app.js        router, views, booking / check-in logic
mobile.html   phone-frame wrapper around index.html
```

## Ideas to extend for the hackathon

Real maps, live-data flight status API, seat-map picker, disruption re-booking assistant, multilingual UI, accessibility audit, PWA install (add a manifest + service worker).

# Systems and data flows: Cathay Student

Simple diagrams of how the system fits together and how data moves through it.

**Notation:**
- Solid arrows are built in the prototype.
- **Dashed arrows and "proposed" boxes** are the production design or ideas not yet built.
- Each diagram says what the prototype does today.

Contents:
1. System overview
2. Student verification: data in, decision back to the student
3. Student points: 1.5×, spending, 70% at graduation, Silver / tier-up for 12 months
4. "Fly with other students" (hot pick): how dates are chosen and why counts are shown in bands
5. Student seating: from booking to check-in
6. What we keep, and for how long

---

## 1. System overview

```mermaid
flowchart LR
    subgraph People
        S["Student<br/>(web app, phone or laptop)"]
        P["Other passengers"]
        R["Verification team"]
        O["Seating operations"]
        M["Chat moderators"]
    end

    subgraph App["Cathay Student server (Node.js)"]
        ACC["Accounts & sessions"]
        VER["Student verification"]
        SEAT["Seating service<br/>+ allocation engine"]
        PTS["Points & perks"]
        CHAT["Student flight chat"]
        SRCH["Flight search"]
    end

    subgraph Stores["Data (prototype: one JSON file + encrypted folder)"]
        DB[("Accounts, trips, points,<br/>verification results,<br/>seats, chat")]
        VAULT[("Encrypted ID documents<br/>deleted after decision")]
    end

    subgraph External["Outside services"]
        SHEER["SheerID<br/>(proposed; prototype: own email code)"]
        AI["AI document analysis<br/>(proposed; prototype: rule checks)"]
        MAIL["Email (Amazon SES)"]
        OAG["OAG schedules"]
        PSS["Airline booking & check-in systems<br/>(proposed; prototype: simulated inventory)"]
    end

    S -->|"sign in, book, verify, chat"| App
    P -->|"book, choose seat"| SEAT
    R -->|"approve / reject"| VER
    O -->|"zone size, manual seating"| SEAT
    M -->|"review reports"| CHAT

    ACC --- DB
    PTS --- DB
    CHAT --- DB
    SEAT --- DB
    VER --- DB
    VER --- VAULT

    VER -.->|"university email"| SHEER
    VER -->|"one-time code"| MAIL
    VER -.->|"ID photo"| AI
    SRCH -->|"schedules"| OAG
    SEAT -.->|"seat inventory, check-in"| PSS
```

---

## 2. Student verification: data in, decision back to the student

The student gives two things: a **university email** and a **photo of their student ID**. The diagram follows both until a result reaches the student.

```mermaid
flowchart TD
    A(["Student taps<br/>Verify student status"]) --> B["Enters university email"]
    B --> C{"Email belongs to an<br/>eligible institution?"}
    C -.->|"production: SheerID checks the institution<br/>and confirms the email"| D
    C -->|"prototype: .edu domain + 6-digit code by email"| D["Email verified ✓<br/>status: Awaiting document"]
    C -->|"not eligible"| X1["Told why;<br/>try another email"] --> B

    D --> E["Uploads student ID photo / PDF<br/>(JPG, PNG, PDF ≤ 5 MB)"]
    E --> F["File checks: real image/PDF,<br/>size, no scripts"]
    F -->|"bad file"| X2["Told what to fix"] --> E
    F --> G[("Stored encrypted<br/>private, access-logged")]
    G --> H["Document analysis<br/>production: AI (OCR, tamper check)<br/>prototype: rule checks + PDF text"]
    H --> H1["Checks:<br/>• name matches account<br/>• institution matches email<br/>• valid on flight dates<br/>• readable / not reused"]

    H1 -->|"all clear<br/>(auto-approve on)"| OK
    H1 -->|"anything unclear<br/>(never auto-rejected)"| Q["Manual review queue<br/>status: Pending review"]
    Q --> REV{"Reviewer decision"}
    REV -->|"approve + validity date"| OK["Verified ✓<br/>valid until ≤ 12 months"]
    REV -->|"needs more info + reason"| RJ["Rejected: additional<br/>information required"]

    OK --> DEL["Document deleted;<br/>keep outcome + expiry only"]
    RJ --> DEL2["Document deleted"]
    DEL --> U(["Student sees Verified<br/>green tick, student features on"])
    DEL2 --> U2(["Student sees the reason<br/>and uploads again"])
    U2 --> E
    U --> EXP{"Validity date passed<br/>or policy changed?"}
    EXP -->|"yes"| RV(["Expired: re-verify"]) --> E
```

What the student sees at each stage: **Not submitted → Awaiting document → Pending review → Verified**, or **Rejected (more info)** and **Expired**, each with its next step.

---

## 3. Student points: earning, spending and graduation

```mermaid
flowchart LR
    F(["Student flies<br/>(credited at check-in)"]) --> M["Asia Miles a normal member<br/>would earn on this flight<br/>(distance × cabin rate)"]
    M -->|"× 1.5"| SP[("Student points balance")]
    INV["Invite bonus:<br/>¼ of friend's booking points"] --> SP
    WEL["Welcome bonus: 1,500"] --> SP
    SP -->|"spend during studies"| RW["Wi-Fi messaging 1,000<br/>Full Wi-Fi 5,000<br/>Lounge 6,000<br/>Seat choice (Light) 1,000"]

    SP --> G(["Graduation"])
    G -->|"70% of what's left"| AM[("Asia Miles")]
    G -->|"30%"| EXPD["Expires"]
    G --> T{"Flew Cathay in the<br/>last 18 months as a student?"}
    T -->|"yes"| TIER["One tier up for 12 months<br/>(no tier yet → Silver)"]
    T -->|"no"| NT["Conversion only"]
```

**Why 1.5× and 70%?**

```mermaid
flowchart TD
    K["k = 1.5 points per normal mile"] --> C1
    R["r = share converted at graduation"] --> C1
    Pp["p ≈ 85% of students actually convert<br/>(drop-outs, inactive accounts)"] --> C1
    C1{"Two conditions"} --> L1["Cathay must not lose:<br/>k × r × p ≤ 1  →  r ≤ 78.4%"]
    C1 --> L2["Students must not lose:<br/>k × r ≥ 1  →  r ≥ 66.7%"]
    L1 --> PICK["Choose r = 70%"]
    L2 --> PICK
    PICK --> RES["Student gets 1.5 × 0.7 = 1.05× normal miles<br/>Cathay pays 1.05 × 0.85 ≈ 0.89×<br/>still breaks even if up to 95% convert"]
```

**Why the 18-month rule for the tier upgrade:** it goes only to students who actually flew Cathay near the end of their studies, so the cost (mainly a few lounge visits) is spent on active customers just before they start travelling for work. It also encourages one more booking before graduation. *(Assumptions to validate with Cathay's real data.)*

---

## 4. "Fly with other students" (hot pick)

When a verified student searches a route, the app suggests nearby dates whose flights already have the most students.

```mermaid
flowchart TD
    A(["Verified student searches<br/>HKG → LHR on 20 Dec"]) --> B["Server looks at flights on the same route<br/>17–23 Dec (± 3 days), still to depart"]
    B --> C["Counts students on each flight who<br/>• are verified by the server<br/>• said Yes to student seating"]
    C --> D{"At least 3 students?"}
    D -->|"no"| HIDE["Flight never mentioned"]
    D -->|"yes"| E["Turn the count into a band:<br/>3+ · 5+ · 10+"]
    E --> F["Best flight per date;<br/>rank by students, then closeness to 20 Dec"]
    F --> G(["Date chips + '5+ students on this flight' badge<br/>no names, no exact numbers"])
```

**The statistical reasoning:**
- **Minimum of 3:** a flight with 1 or 2 students is never shown. Otherwise "1 student on CX 251" plus a friend's post that they're flying would identify them. With at least 3, any one student is hidden among the others (k-anonymity, k = 3).
- **Bands, not exact numbers:** if the app showed exact counts, someone could watch "4 → 5" right after a friend booked and learn something about that person. Bands only change at 3, 5 and 10, so most single bookings change nothing visible.
- **Only verified students who opted in** are counted, so the number can't be inflated by unverified accounts, and nobody is counted without choosing student seating.
- **± 3 days** is wide enough to offer a real choice, and narrow enough that the suggestion is still useful for most travel plans.
- **Uses our own bookings**, so no extra calls to the schedule provider (OAG) and no extra cost.

---

## 5. Student seating: from booking to check-in

Default today is **dynamic seating**: no seats are reserved; students are planned next to each other anywhere in Economy.

```mermaid
flowchart TD
    A(["Student books Economy and<br/>answers Yes to student seating"]) --> B{"Server checks:<br/>verified on the flight date?<br/>18+? Economy?"}
    B -->|"no"| N["Normal passenger:<br/>seat by fare rules"]
    B -->|"yes"| C["Allocation engine plans a seat:<br/>groups of 2–3 side by side,<br/>same university first,<br/>never next to an excluded student"]
    C -.->|"proposed: hold the seat next to<br/>them for a limited time (e.g. 48 h)"| H["Neighbour seat held<br/>for the next student"]
    H -.->|"another student books"| C
    H -.->|"time runs out"| REL["Seat released for sale"]
    C --> D(["Student sees their planned seat<br/>live on every device"])

    D --> E{"Something changes"}
    E -->|"paying passenger buys<br/>a planned student seat"| F["Plan re-runs: students still beside<br/>a student keep their seats;<br/>anyone left alone is regrouped"]
    E -->|"new seating exclusion"| F
    E -->|"seat blocked / cancellation"| F
    F --> G{"Valid seat found?"}
    G -->|"yes"| D
    G -->|"no, restriction can't be met"| OPS["Operations review;<br/>student sees a neutral message"]
    OPS --> D

    D --> CI(["Check-in: seat locked,<br/>never moved automatically again"])
```

**Fare rules on top:**
- **Economy Light:** students still get a seat for free, but can't choose one, unless they buy seat selection.
- **Essential and Flex:** students can choose their own seat, and the system won't take it from them.

**Alternative mode (`SEATING_MODE=zone`):** reserved Student Zone rows instead of dynamic planning. See `docs/SEATING.md`.

---

## 6. What we keep, and for how long

```mermaid
flowchart LR
    subgraph Deleted_quickly["Deleted quickly"]
        D1["Email code<br/>10 minutes"]
        D2["Student ID document<br/>as soon as reviewed<br/>(max 30 days unreviewed)"]
        D3["Seat hold<br/>5 minutes"]
    end
    subgraph Around_the_flight["Around the flight"]
        F1["Chat messages<br/>48 h after arrival"]
        F2["Seating exclusions<br/>48 h after arrival"]
        F3["Seating record<br/>30 days after arrival"]
    end
    subgraph Longer["Longer, restricted"]
        L1["Report evidence<br/>180 days (30 if dismissed)"]
        L2["Audit logs<br/>365 days"]
        L3["Verification outcome + expiry<br/>while the account exists"]
    end
```

All periods are proposals for legal review (Hong Kong PDPO).

# Data model (ERD): Cathay Student

The whole data layer of the app, drawn as a **logical** model: each nested object in today's JSON database is shown as the table it would become in a production database. Field names are the real ones in the code. The table at the end says where each entity lives today and where it should live in production.

**Notation:**
- `PK` primary key, `FK` foreign key, `UK` unique.
- `||--o{` one-to-many, `||--o|` one-to-zero-or-one.
- `fid` is a flight id, e.g. `CX251-2026-11-15` (flight number + departure date).
- `uid` is an account id (`u_…`).

## 1. Overview

```mermaid
erDiagram
    USER ||--o{ SESSION : "signs in with"
    USER ||--o| USER_DATA : "syncs device data"
    USER ||--o{ TRIP : "books"
    USER ||--o| PERKS : "earns"
    USER ||--o| STUDENT_VERIFICATION : "verifies as student"
    USER ||--o{ USER : "invites (refCode) / Companion Pass parent (parentOf)"
    TRIP ||--|{ TRIP_SEGMENT : "has flights"
    TRIP ||--|{ TRIP_PASSENGER : "for travellers"
    TRIP_SEGMENT }o--|| FLIGHT : "is registered on (fid)"
    PERKS ||--o{ REWARD_REDEMPTION : "spends points on"
    PERKS ||--o{ SEAT_PURCHASE : "buys seat selection"
    INSTITUTION ||--o{ STUDENT_VERIFICATION : "recognises email domain"
    STUDENT_VERIFICATION ||--o| VERIFICATION_SUBMISSION : "has current"
    VERIFICATION_SUBMISSION ||--|{ STUDENT_DOCUMENT : "contains"
    STUDENT_DOCUMENT ||--|| VAULT_FILE : "stored encrypted as"
    USER ||--o{ VERIFY_AUDIT : "acts in / is subject of"
    FLIGHT ||--o{ FLIGHT_PASSENGER : "has bookings"
    USER ||--o{ FLIGHT_PASSENGER : "is booked as"
    FLIGHT ||--o{ SEAT_HOLD : "has temporary holds"
    FLIGHT ||--o| SEAT_INVENTORY : "inventory (adapter)"
    FLIGHT ||--o{ SEAT_EXCLUSION : "confidential restrictions"
    FLIGHT ||--o{ SEATING_REVIEW : "needs ops review"
    FLIGHT ||--o{ SEAT_AUDIT : "audited changes"
    FLIGHT ||--o| CHAT_ROOM : "has student chat"
    CHAT_ROOM ||--o{ CHAT_MEMBER : "joined by"
    CHAT_ROOM ||--o{ CHAT_MESSAGE : "contains"
    CHAT_MESSAGE ||--o{ CHAT_REPORT : "reported in"
    CHAT_REPORT ||--o| REPORT_EVIDENCE : "keeps evidence"
    CHAT_REPORT ||--o| CHAT_STRIKE : "confirmed as"
    FLIGHT ||--o{ CHAT_REMOVAL : "removed students"
```

## 2. Accounts, trips and perks

```mermaid
erDiagram
    USER {
        string id PK "u_ + 16 hex"
        string email UK "lower-case login"
        string firstName
        string lastName
        date dob "age 18+ checks"
        string salt "scrypt salt"
        string hash "scrypt(password)"
        string memberId UK "CS 2026 1234"
        string refCode UK "invite code NAME-XXXX"
        string invitedBy FK "USER.refCode of inviter"
        string parentOf FK "USER.id: Companion Pass parent of a student"
        datetime createdAt
    }
    SESSION {
        string token PK "64 hex, Bearer token"
        string uid FK
        int exp "expiry, 30 days"
    }
    USER_DATA {
        string uid PK, FK
        json prefs "seat, meal, notifications"
        string chatName
    }
    TRIP {
        string ref PK "booking reference"
        string uid FK
        string status "Confirmed | Cancelled | Completed"
        string cabin
        string fare "Light | Essential | Flex"
        int total
        datetime bought
        bool checkedIn
        datetime checkedInAt
        bool studentSeat "answered Yes to Student Zone"
        bool showUni "share university with neighbours"
        int studentPoints "earned at check-in"
        string cancelReason "set by server for conduct"
    }
    TRIP_SEGMENT {
        string trip_ref PK, FK
        int idx PK "0 = outbound"
        string number "CX 251"
        string from "IATA"
        string to "IATA"
        datetime dep
        datetime arr
        string aircraft
        string fare
        string seat "confirmed seat"
    }
    TRIP_PASSENGER {
        string trip_ref PK, FK
        int idx PK
        string first
        string last
    }
    PERKS {
        string uid PK, FK
        int welcome "welcome bonus points"
        datetime welcomeAt
        int sp "student points from flights"
        json adapter "email, trip ref, at"
        string gradMonth
        datetime graduated
        int gradConverted
        bool inviteInfoSeen
    }
    REWARD_REDEMPTION {
        string uid FK
        string rewardId "msg | wifi | seat | lounge"
        string trip_ref FK
        int pts
        datetime at
    }
    SEAT_PURCHASE {
        string uid FK
        string trip_ref FK
        int segIdx
        string with "sp | miles"
        int amount
        datetime at
    }
    USER ||--o{ SESSION : has
    USER ||--o| USER_DATA : has
    USER ||--o{ TRIP : books
    USER ||--o| PERKS : has
    TRIP ||--|{ TRIP_SEGMENT : has
    TRIP ||--|{ TRIP_PASSENGER : has
    PERKS ||--o{ REWARD_REDEMPTION : has
    PERKS ||--o{ SEAT_PURCHASE : has
    TRIP ||--o{ REWARD_REDEMPTION : "used on"
    TRIP ||--o{ SEAT_PURCHASE : "used on"
```

## 3. Student verification

```mermaid
erDiagram
    STUDENT_VERIFICATION {
        string uid PK, FK
        string email UK "verified university email (one account per email)"
        datetime emailVerifiedAt
        string institutionDomain FK
        string state "awaiting_document | pending_review | verified | rejected"
        date validUntil "max 12 months; expired is computed"
        string validitySource "document_text | student_declared | reviewer | policy_default | demo_auto_approve"
        datetime verifiedAt
        int policyVersion
        json decision "at, outcome, reasonCode, message, auto"
        json rejectedHashes "SHA-256 of rejected files"
        json docHashes "SHA-256 of approved files"
        json history "events, no document content"
    }
    VERIFICATION_SUBMISSION {
        string id PK "sub_..."
        string uid FK
        datetime submittedAt
        string declaredFullName
        string declaredInstitution
        date declaredExpiry
        bool noExpiry
        date detectedExpiry "read from PDF text"
        string expirySource
        json checks "automated checks: pass | flag | info"
        json flags
    }
    STUDENT_DOCUMENT {
        string id PK "doc_..."
        string submission_id FK
        string role "student_id | enrolment_proof"
        string mime "image/jpeg | image/png | application/pdf"
        int bytes
        string sha256
        int width
        int height
        int pages
    }
    VAULT_FILE {
        string docId PK, FK "data/vault/<id>.bin"
        binary wrappedKey "per-file key, AES-256-GCM, wrapped by master key"
        binary ciphertext "document, AES-256-GCM"
    }
    INSTITUTION {
        string domain PK "e.g. cuhk.edu.hk"
        string name
        string country
        bool recognised
    }
    VERIFY_AUDIT {
        datetime at
        string actor FK "uid | system | auto"
        string action "submitted | document_viewed | approved | rejected | document_deleted ..."
        string subject FK "student uid"
        string ref "submission or document id"
        string ip
    }
    EMAIL_OTP {
        string email PK "pending one-time code"
        string salt
        string hash "HMAC of 6-digit code"
        int expires "10 minutes"
        int attempts "max 5"
        int lastSent
        json sends "rate limit per hour"
    }
    INSTITUTION ||--o{ STUDENT_VERIFICATION : recognises
    STUDENT_VERIFICATION ||--o| VERIFICATION_SUBMISSION : "current"
    VERIFICATION_SUBMISSION ||--|{ STUDENT_DOCUMENT : contains
    STUDENT_DOCUMENT ||--|| VAULT_FILE : "encrypted in"
    STUDENT_VERIFICATION ||--o{ VERIFY_AUDIT : "logged in"
    EMAIL_OTP ||--o| STUDENT_VERIFICATION : "confirms email of"
```

## 4. Flights, seats and the Student Zone

```mermaid
erDiagram
    FLIGHT_SEARCH_CACHE {
        string key PK "FROM-TO-DATE"
        int at
        string source "oag | sim"
        string note
        json flights "schedule from OAG"
    }
    FLIGHT {
        string fid PK "CX251-2026-11-15"
        json seg "number, from, to, dep, arr, aircraft"
        int v "version for optimistic concurrency"
        int order "booking counter"
        int zoneFirstRow "Student Zone"
        int zoneLastRow
        int zoneReleaseHours
        string zoneUpdatedBy FK
        json log "ops change log, no names"
        datetime createdAt
    }
    FLIGHT_PASSENGER {
        string fid PK, FK
        string uid PK, FK
        int n "booking order"
        string ref FK "TRIP.ref"
        string cabin
        string fare "fixed once booked"
        bool wantsStudent
        bool share "show university"
        bool student "computed on server"
        string uni "from verified email"
        string seat
        string seatKind "zone | selected | assigned | manual"
        string alloc "assigned | waitlisted | review"
        string status "booked | checked_in"
        bool chosen "advance seat selection"
        json unlock "seat selection bought: with, at"
        int rev "per-passenger version"
    }
    SEAT_HOLD {
        string fid PK, FK
        string seat PK
        string uid FK
        int exp "5 minutes"
    }
    SEAT_EXCLUSION {
        string fid PK, FK
        string uid PK, FK "student who asked (never shown)"
        string excludedUid PK, FK "mutual effect"
        datetime updatedAt "deleted 48 h after arrival"
    }
    SEATING_REVIEW {
        string id PK "rv_..."
        string fid FK
        string kind "capacity | constraint | locked_conflict | seat_unavailable"
        json uids "passengers involved"
        string status "open | resolved"
        string resolvedBy FK
        string note
    }
    SEAT_INVENTORY {
        string fid PK, FK "simulated adapter; production = airline DCS"
        json sold "seats sold elsewhere"
        json blocked "seat to reason"
        json zone "protected zone seats"
        json assigned "seat to pax pseudonym"
    }
    SEAT_AUDIT {
        datetime at
        string fid FK
        string actor FK "uid | system"
        string action "booked | checked_in | exclusions_updated (count only) | ops_moved_checked_in ..."
        string pax "per-flight pseudonym"
        string seat
        string reason
        int count
    }
    FLIGHT_SEARCH_CACHE ||--o{ FLIGHT : "lists flights that become"
    FLIGHT ||--o{ FLIGHT_PASSENGER : has
    FLIGHT ||--o{ SEAT_HOLD : has
    FLIGHT ||--o{ SEAT_EXCLUSION : has
    FLIGHT ||--o{ SEATING_REVIEW : has
    FLIGHT ||--o| SEAT_INVENTORY : has
    FLIGHT ||--o{ SEAT_AUDIT : has
    FLIGHT_PASSENGER ||--o{ SEAT_EXCLUSION : "asks / is excluded"
```

## 5. Student flight chat and moderation

```mermaid
erDiagram
    CHAT_ROOM {
        string fid PK, FK "one room per flight"
    }
    CHAT_MEMBER {
        string fid PK, FK
        string uid PK, FK
        datetime joinedAt
        bool left
    }
    CHAT_MESSAGE {
        string id PK
        string fid FK
        string uid FK "shown as first name + pseudonym"
        string text "max 500 chars; deleted 48 h after arrival"
        datetime ts
    }
    CHAT_REPORT {
        string id PK
        string fid FK
        string msgId FK
        string reporter FK "never shown to the reported person"
        string reported FK
        string category
        string note
        string status "open | dismissed | confirmed"
        string severity "low | medium | high | critical"
        datetime at
        datetime decidedAt
        string decidedBy FK "moderator"
        string outcome
        string escalated
    }
    REPORT_EVIDENCE {
        string reportId PK, FK
        json messages "copy of message + context"
        int expiresAt "180 days, 30 if dismissed"
        bool legalHold
    }
    CHAT_STRIKE {
        string uid FK
        string reportId FK
        string fid FK
        datetime at
        string severity
    }
    CHAT_REMOVAL {
        string fid PK, FK
        string uid PK, FK
        string reportId FK
    }
    CHAT_ROOM ||--o{ CHAT_MEMBER : has
    CHAT_ROOM ||--o{ CHAT_MESSAGE : has
    CHAT_MESSAGE ||--o{ CHAT_REPORT : "reported in"
    CHAT_REPORT ||--o| REPORT_EVIDENCE : keeps
    CHAT_REPORT ||--o| CHAT_STRIKE : "confirmed as"
    CHAT_REPORT ||--o| CHAT_REMOVAL : "may cause"
```

## 6. Where each entity lives

| Entity | Today (prototype) | Production target |
|---|---|---|
| USER, SESSION | `db.users`, `db.sessions` (`data/live-db.json`, `accounts.js`) | Customer identity system / Cognito; sessions in a TTL table |
| USER_DATA, TRIP, TRIP_SEGMENT, TRIP_PASSENGER, PERKS, REWARD_REDEMPTION, SEAT_PURCHASE | `db.userData[uid]` (`trips`, `prefs`, `perks`, `chatName`), synced from the device via `PUT /api/me/data` | Trips from the airline's **reservation system (PNR)**; points and perks in a server-side **loyalty ledger** |
| STUDENT_VERIFICATION, VERIFICATION_SUBMISSION, STUDENT_DOCUMENT | `db.studentVerify[uid]` (`student-verify.js`) | Verification table (DynamoDB / RDS) |
| VAULT_FILE | `data/vault/<docId>.bin`, AES-256-GCM | Private S3 bucket, SSE-KMS, lifecycle deletion |
| INSTITUTION | Code (`INSTITUTIONS` in `student-verify.js`) | Airline-maintained eligible-institution list |
| VERIFY_AUDIT | `db.verifyAudit` | Append-only audit log (TTL 365 days) |
| EMAIL_OTP | In memory (`server.js`); DynamoDB `CodeTable` in the AWS Lambda edition (`aws/lambda/store.js`, TTL) | DynamoDB with TTL |
| FLIGHT_SEARCH_CACHE | `db.searches` (`live.js`) | Cache (e.g. ElastiCache / DynamoDB TTL) |
| FLIGHT, FLIGHT_PASSENGER, SEAT_HOLD, SEATING_REVIEW | `db.flights[fid]` (`seating/service.js`, `seating/repository.js`) | `SeatingFlights`, `SeatingPassengers`, `SeatingAssignments` (one item per seat), `SeatingHolds`; see `docs/SEATING.md` §10.2 |
| SEAT_EXCLUSION | `db.seatPrefs[fid][uid].excludes` (kept apart from flights on purpose) | Separate KMS-encrypted `SeatingPreferences` table, TTL arrival + 48 h |
| SEAT_INVENTORY | `db.inventory[fid]` (simulated adapter) | The airline's inventory / departure-control system, via `InventoryAdapter` |
| SEAT_AUDIT | `db.seatAudit` | Append-only audit log (TTL 365 days) |
| CHAT_* , REPORT_EVIDENCE | `db.chat.rooms`, `.reports`, `.evidence`, `.strikes`, `.removed` (`chat-server.js`) | Chat and moderation tables; evidence in a restricted store with legal hold |

**Not stored anywhere (memory only):**
- live-update tickets for seating and chat (60 s, single use);
- open live connections;
- rate-limit counters.

**Secrets outside the data model:**
- `db.seatSecret`: HMAC key for per-viewer participant handles.
- The document master key: `DOC_ENCRYPTION_KEY` in `.env`, or `data/vault/.key` in demo mode.

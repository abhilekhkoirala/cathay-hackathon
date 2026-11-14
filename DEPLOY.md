# Deploying Cathay Student to AWS

One command puts the whole app on a live HTTPS URL (`https://xxxx.cloudfront.net`) with working email verification.

```
Browser ──► CloudFront (https://xxxx.cloudfront.net)
              ├─ /*      ──► S3 bucket (private)         index.html, app.js, ...
              └─ /api/*  ──► API Gateway ──► Lambda ──► DynamoDB   (codes, auto-expire via TTL)
                                                   └──► SES        (emails the code)
```

Site and API share one domain, so there is no CORS to configure and `config.js` stays untouched. Region: **ap-southeast-2 (Sydney)**. No custom domain needed.

Cost at hackathon traffic: pennies, mostly free tier. CloudFront and Lambda don't bill for idle time.

---

## 1. Install the tools (one-time)

You need the **AWS CLI**, the **SAM CLI**, and **Node 18+** (Node is only for running the tests/local server; AWS runs the Lambda for you). Docker is *not* needed.

| | macOS (Homebrew) | Windows (PowerShell) | Linux |
|---|---|---|---|
| AWS CLI v2 | `brew install awscli` | `winget install Amazon.AWSCLI` | `curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o awscliv2.zip && unzip awscliv2.zip && sudo ./aws/install` |
| SAM CLI | `brew install aws-sam-cli` | `winget install Amazon.SAM-CLI` | download `aws-sam-cli-linux-x86_64.zip` from the [SAM releases page](https://github.com/aws/aws-sam-cli/releases/latest), then `unzip` it into a folder and run `sudo ./install` |
| Node 18+ | `brew install node` | `winget install OpenJS.NodeJS.LTS` | [nodejs.org](https://nodejs.org) or your package manager |

(Linux on ARM: use `aarch64` / `arm64` in the download names.)

**Windows:** the scripts are bash. Run them from **Git Bash** (installed with [Git for Windows](https://git-scm.com)) or **WSL**. Open a *new* terminal after installing so the new commands are found.

Check:

```bash
aws --version     # aws-cli/2.x
sam --version     # SAM CLI, version 1.x
node -v           # v18 or newer
```

## 2. Give the CLI access to your AWS account

Pick one. **Never paste access keys into a chat, a commit, or a screenshot** (if you do, delete that key in IAM immediately). Don't use the root user's keys.

- **If your account uses IAM Identity Center (SSO):** `aws configure sso`, then `aws sso login` whenever it expires. Use `export AWS_PROFILE=<the profile name you chose>`.
- **Otherwise:** in the IAM console create a user for yourself with `AdministratorAccess` (fine for a hackathon account), create an access key for CLI use, then run `aws configure`. Enter the key, the secret, region `ap-southeast-2`, output `json`.

Check it works (prints your account id):

```bash
aws sts get-caller-identity
```

## 3. Pick the sender address (SES)

SES only sends from addresses/domains you've verified, and a made-up no-reply address isn't yours to verify. Use **any inbox you can open**, e.g. your own Gmail. Recipients will see it as **"Cathay Student Verify"** `<that address>`.

New SES accounts are in the **sandbox**: they can send *only to addresses verified in SES*. That's fine for your own demo, as long as you verify the address(es) you will type into the app, **in the same region (ap-southeast-2)**:

```bash
./aws/ses-verify.sh you@gmail.com             # the sender (the deploy script also does this for you)
./aws/ses-verify.sh you@student.cuhk.edu.hk   # each test recipient
```

SES emails each address a link; click it. Check status any time with `./aws/ses-verify.sh` (no arguments).

> **Gmail sender caveat:** mail "From" a `@gmail.com` address that goes through SES isn't signed by Google, so it may land in the recipient's **spam folder**. If a code doesn't arrive, check spam. A sender on a domain you own (with SES DKIM set up) is more reliable, but isn't required for a demo.

## 4. Deploy

From the project folder:

```bash
SENDER_EMAIL=you@gmail.com ./aws/deploy.sh
```

The first run takes about 5–10 minutes (CloudFront is slow to create); later runs take seconds. At the end it prints:

```
Live site: https://d1234abcd.cloudfront.net
```

What the script does: checks your tools and credentials → makes sure the sender exists in SES → `sam deploy` (creates S3, CloudFront, API Gateway, Lambda, DynamoDB, IAM role, log group) → uploads only the browser files (`index.html mobile.html styles.css app.js data.js config.js`, never `server.js` or `.env`) → clears the CloudFront cache → calls `/api/health`.

**Want it working before SES is sorted out?** Deploy in demo mode; the code appears on screen instead of being emailed:

```bash
MAIL_MODE=demo ./aws/deploy.sh
```

Re-run later with `SENDER_EMAIL=... ./aws/deploy.sh` to switch to real email.

## 5. Test it

```bash
curl https://YOUR-URL/api/health          # {"ok":true,"mail":"ses"}
```

Then in the browser: sign in (already signed in as Abhilekh) → Settings → **Verify student status** → enter a `.edu` address you verified in SES → get the code → green tick.

If you see the toast *"Demo mode: no email server connected"*, the browser couldn't reach the API (the app falls back to an on-screen code when `/api` doesn't answer). Check `/api/health` and the logs below.

## 6. Day to day

| I want to... | Do this |
|---|---|
| Publish a change to the site or API | `SENDER_EMAIL=you@gmail.com ./aws/deploy.sh` again |
| See what the Lambda is doing | `aws logs tail /aws/lambda/$(aws cloudformation describe-stack-resource --stack-name aurelia-air --logical-resource-id VerifyFunction --query StackResourceDetail.PhysicalResourceId --output text) --follow --region ap-southeast-2` |
| Run the logic tests (no AWS needed) | `npm test` |
| Run the site locally in demo mode | `npm install && npm start` → http://localhost:3000 |
| Delete everything (stops all billing) | `./aws/destroy.sh` |

Optional overrides for any script: `AWS_REGION=...`, `STACK_NAME=...` (default `aurelia-air`), `AWS_PROFILE=...`.

## Troubleshooting

- **"Your account must be verified before you can add new CloudFront resources"** — brand-new AWS accounts sometimes need a one-off check. Open an AWS Support case ("Account and billing") asking to enable CloudFront, or wait; it's usually resolved within a day. (Nothing else in the stack is affected.)
- **`Email address is not verified`** shown in the app — you're in the SES sandbox and typed an address that isn't verified in `ap-southeast-2`. Run `./aws/ses-verify.sh that@address`, click the link, retry. (Or request production access in the SES console → *Account dashboard*.)
- **Verification email never arrives** — check spam first (see the Gmail caveat). Then `./aws/ses-verify.sh` to confirm the sender shows as verified, and read the Lambda logs.
- **`AccessDenied` / `not authorized` during deploy** — the IAM user/role needs permission to create CloudFormation, IAM roles, Lambda, API Gateway, S3, CloudFront, DynamoDB and SES resources. `AdministratorAccess` covers it.
- **`$'\r': command not found`** — Windows turned the scripts' line endings into CRLF. Run `git config core.autocrlf false`, re-clone (a `.gitattributes` forces LF for `*.sh`), or run `dos2unix aws/*.sh`.
- **Stack stuck in `ROLLBACK_COMPLETE` after a failed first deploy** — delete it with `./aws/destroy.sh`, fix the cause, deploy again.
- **Site shows old files after a deploy** — the script invalidates the cache; hard-refresh the browser (Ctrl/Cmd+Shift+R).

## Notes on what's deployed

- **No secrets anywhere.** The Lambda reaches SES and DynamoDB through its IAM role; there are no SMTP credentials, keys, or `.env` in AWS.
- **Rate limits** match `server.js` (30 s between sends, 5 codes/hour/address, 5 guesses per code, 10 min expiry), plus 40 requests per IP per 15 min (counted in DynamoDB) and an API Gateway throttle of 25 req/s.
- **Codes are stored hashed** (HMAC-SHA256 with a per-code salt) and DynamoDB TTL deletes them automatically.
- **The `ses:SendEmail` permission covers all SES identities in this account/region**, not just the sender — in the sandbox SES also checks the recipient's identity, so a sender-only policy would be rejected.
- Tick status is still stored in the browser (`localStorage`), as in the original demo — the backend proves the person controls the `.edu` inbox, it doesn't issue accounts. Cognito + DynamoDB would be the next step for real accounts.

## Flight chat (realtime, multi-person)

The chat works in two modes, chosen automatically:

- **Demo mode (default, no setup):** messages are shared between tabs of the *same browser* (try `index.html` and a second tab, or `mobile.html` next to it). Nothing leaves the browser.
- **Live mode:** real people on different devices, via an AWS AppSync Events API (serverless WebSocket pub/sub). It needs **no IAM role**, so it works on role-restricted accounts.

Turn on live mode (Git Bash, from the project folder):

```bash
export AWS_PROFILE=aurelia
bash aws/chat-deploy.sh      # creates the chat service, writes chat-config.js (gitignored)
bash aws/amplify-deploy.sh   # republish the site so it includes chat-config.js
```

Then open the site on two devices, sign in, and open **Open chat** on the home page (or use *Demo: preview the chat now* when the flight is more than 7 days away). Everybody booked on the same flight number and date lands in the same room. Use *Change name* in the chat so two devices signed in as the same demo account can tell each other apart.

Things to know:

- **No message history on the service.** You only see messages sent while you are in the room; this browser keeps the last 100 for itself.
- **The API key is visible in the page** (it is a static site). It only allows chat publish/subscribe and expires after 30 days (`KEY_DAYS=90 bash aws/chat-deploy.sh` to change; re-run to rotate). Anyone with the site can post, and there is no moderation, so don't leave it running after the demo: `aws cloudformation delete-stack --stack-name aurelia-chat`.
- Verified-student ticks are sent by the browser, so they are for show in this demo, not proof.
- If `chat-deploy.sh` fails, it prints the CloudFormation reason. Send those lines to whoever is helping you; don't re-run blindly.

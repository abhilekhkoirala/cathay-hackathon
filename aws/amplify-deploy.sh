#!/usr/bin/env bash
# Publishes the website to AWS Amplify Hosting (https://main.<id>.amplifyapp.com).
#
# Needs only the AWS CLI and your login — no SAM, no IAM role, no Git connection — so it works on accounts
# that can't create IAM roles. The site is static: the verify flow shows its code on screen (demo mode).
# Re-run it any time to publish changes; it reuses the same app and URL.
#
#   export AWS_PROFILE=aurelia
#   bash aws/amplify-deploy.sh
#
# Optional env: AWS_REGION (default ap-southeast-2), APP_NAME (default aurelia-air), BRANCH (default main)
set -euo pipefail
cd "$(dirname "$0")/.."

APP_NAME="${APP_NAME:-aurelia-air}"
BRANCH="${BRANCH:-main}"
REGION="${AWS_REGION:-ap-southeast-2}"
export AWS_REGION="$REGION" AWS_DEFAULT_REGION="$REGION"

# Windows' aws.exe ends output lines with CR+LF and Git Bash only strips the LF, which left a stray "\r" on the
# upload URL (curl: (3) bad/illegal format). Strip the CRs from everything aws prints.
aws() { command aws "$@" | tr -d '\r'; }

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die() { printf '\033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

say "Checking tools and credentials"
command -v aws  >/dev/null || die "AWS CLI not found. See DEPLOY.md, step 1."
command -v curl >/dev/null || die "curl not found."
IDENTITY="$(aws sts get-caller-identity --query Arn --output text 2>/dev/null)" \
  || die "AWS login not working or expired. Run: aws sso login --profile aurelia   (then: export AWS_PROFILE=aurelia)"
echo "Identity: $IDENTITY"
echo "Region:   $REGION"

# ---------------------------------------------------------------- app + branch (created once)
say "Finding the Amplify app '$APP_NAME'"
APP_ID="$(aws amplify list-apps --query "apps[?name=='$APP_NAME'] | [0].appId" --output text 2>/dev/null || true)"
if [ -z "$APP_ID" ] || [ "$APP_ID" = "None" ]; then
  APP_ID="$(aws amplify create-app --name "$APP_NAME" --platform WEB --query app.appId --output text)" \
    || die "Could not create the Amplify app. If this says AccessDenied, your role may not allow Amplify — tell the organizers or use the CloudFront route."
  echo "Created app $APP_ID"
else
  echo "Using existing app $APP_ID"
fi
if ! aws amplify get-branch --app-id "$APP_ID" --branch-name "$BRANCH" >/dev/null 2>&1; then
  aws amplify create-branch --app-id "$APP_ID" --branch-name "$BRANCH" >/dev/null
  echo "Created branch $BRANCH"
fi

# ---------------------------------------------------------------- package the browser files only
# Amplify wants the files at the top level of the zip (not inside a folder). server.js, package.json,
# .env, aws/, tests etc. are deliberately left out.
say "Packaging the website"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
STAGE="$WORK/site"; mkdir -p "$STAGE"
COUNT=0
for f in *.html *.css *.js *.svg *.png *.jpg *.jpeg *.webp *.ico *.woff2 *.json; do
  [ -f "$f" ] || continue
  case "$f" in server.js|package.json|package-lock.json) continue;; esac
  cp "$f" "$STAGE/"; COUNT=$((COUNT + 1))
done
for d in assets images img fonts; do [ -d "$d" ] && { cp -R "$d" "$STAGE/"; COUNT=$((COUNT + 1)); }; done
[ -f "$STAGE/index.html" ] || die "index.html not found — run this from the project folder."
( cd "$STAGE" && ls -1 | sed 's/^/  /' )

ZIP="$WORK/site.zip"   # = ../site.zip as seen from $STAGE (a relative path works with every zip build)
if command -v zip >/dev/null 2>&1; then
  ( cd "$STAGE" && zip -qr ../site.zip . ) 2>/dev/null || rm -f "$ZIP"
fi
if [ ! -s "$ZIP" ] && command -v powershell.exe >/dev/null 2>&1; then
  # Windows: use PowerShell's zip. Files sit at the top level, so Compress-Archive's path style doesn't matter.
  WIN_STAGE="$(cygpath -w "$STAGE")"; WIN_ZIP="$(cygpath -w "$ZIP")"
  powershell.exe -NoProfile -Command "Compress-Archive -Path '$WIN_STAGE\\*' -DestinationPath '$WIN_ZIP' -Force" || true
fi
[ -s "$ZIP" ] || die "Could not create the zip (no working 'zip' or PowerShell found)."

# ---------------------------------------------------------------- upload + publish
say "Uploading to Amplify"
read -r JOB_ID UPLOAD_URL < <(aws amplify create-deployment --app-id "$APP_ID" --branch-name "$BRANCH" \
                                --query '[jobId,zipUploadUrl]' --output text)
[ -n "${JOB_ID:-}" ] && [ -n "${UPLOAD_URL:-}" ] || die "Amplify did not return an upload URL."
curl -fsS -T "$ZIP" "$UPLOAD_URL" >/dev/null \
  || die "Upload of the zip failed (upload target: ${UPLOAD_URL%%\?*})."
aws amplify start-deployment --app-id "$APP_ID" --branch-name "$BRANCH" --job-id "$JOB_ID" >/dev/null

say "Waiting for Amplify to publish (usually under a minute)"
STATUS=""
for _ in $(seq 1 60); do
  STATUS="$(aws amplify get-job --app-id "$APP_ID" --branch-name "$BRANCH" --job-id "$JOB_ID" \
              --query job.summary.status --output text)"
  case "$STATUS" in SUCCEED|FAILED|CANCELLED) break;; esac
  sleep 5
done
[ "$STATUS" = SUCCEED ] || die "Deployment ended with status '$STATUS'. Open the Amplify console -> $APP_NAME -> $BRANCH for details."

DOMAIN="$(aws amplify get-app --app-id "$APP_ID" --query app.defaultDomain --output text)"
URL="https://$BRANCH.$DOMAIN"
printf '\n\033[1;32mLive site: %s\033[0m\n' "$URL"
echo "Re-run  bash aws/amplify-deploy.sh  after any change to publish it."
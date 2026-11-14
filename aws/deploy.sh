#!/usr/bin/env bash
# Deploys Aurelia Air to AWS: infrastructure (SAM) + website files + CloudFront cache refresh.
# Safe to re-run — run it again after any change to the site or the API.
#
#   SENDER_EMAIL=you@gmail.com ./aws/deploy.sh
#   ./aws/deploy.sh you@gmail.com
#   MAIL_MODE=demo ./aws/deploy.sh            # no SES needed; code is shown on screen
#
# Optional env: AWS_REGION (default ap-southeast-2), STACK_NAME (default aurelia-air), AWS_PROFILE
set -euo pipefail
cd "$(dirname "$0")/.."

STACK_NAME="${STACK_NAME:-aurelia-air}"
REGION="${AWS_REGION:-ap-southeast-2}"
MAIL_MODE="${MAIL_MODE:-ses}"
SENDER_EMAIL="${1:-${SENDER_EMAIL:-}}"
export AWS_REGION="$REGION" AWS_DEFAULT_REGION="$REGION"

say()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[33m!! %s\033[0m\n' "$*"; }
die()  { printf '\033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- pre-flight
say "Checking tools and credentials"
command -v aws >/dev/null || die "AWS CLI not found. See DEPLOY.md, step 1."
command -v sam >/dev/null || die "SAM CLI not found. See DEPLOY.md, step 1."
case "$MAIL_MODE" in ses|demo) ;; *) die "MAIL_MODE must be 'ses' or 'demo'";; esac
if [ "$MAIL_MODE" = ses ] && [ -z "$SENDER_EMAIL" ]; then
  die "Set the sender address you own, e.g.  SENDER_EMAIL=you@gmail.com ./aws/deploy.sh  (or use MAIL_MODE=demo)"
fi
IDENTITY="$(aws sts get-caller-identity --query Arn --output text 2>/dev/null)" \
  || die "AWS credentials not working. Run 'aws configure sso' (or 'aws configure') first — see DEPLOY.md, step 2."
echo "Account/identity: $IDENTITY"
echo "Region:           $REGION"
echo "Stack:            $STACK_NAME"
echo "Mail mode:        $MAIL_MODE${SENDER_EMAIL:+  (sender: $SENDER_EMAIL)}"

# ---------------------------------------------------------------- SES sender identity
SES_NOTE=""
if [ "$MAIL_MODE" = ses ]; then
  say "Checking SES sender identity"
  STATUS="$(aws sesv2 get-email-identity --email-identity "$SENDER_EMAIL" \
            --query VerifiedForSendingStatus --output text 2>/dev/null || true)"
  if [ -z "$STATUS" ]; then
    aws sesv2 create-email-identity --email-identity "$SENDER_EMAIL" >/dev/null
    SES_NOTE="SES just sent a verification email to $SENDER_EMAIL — open it and click the link, or no codes can be sent."
    warn "$SES_NOTE"
  elif [ "$STATUS" = "True" ]; then
    echo "$SENDER_EMAIL is verified in SES ($REGION)."
  else
    SES_NOTE="$SENDER_EMAIL exists in SES but is NOT verified yet — click the link in the email SES sent."
    warn "$SES_NOTE"
  fi
fi

# ---------------------------------------------------------------- infrastructure
say "Deploying infrastructure (first run takes ~5-10 min while CloudFront is created)"
sam deploy \
  --template-file aws/template.yaml \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --capabilities CAPABILITY_IAM \
  --resolve-s3 \
  --no-confirm-changeset \
  --no-fail-on-empty-changeset \
  --parameter-overrides "SenderEmail=$SENDER_EMAIL" "MailMode=$MAIL_MODE"

out() { aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
          --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
BUCKET="$(out BucketName)"; DIST_ID="$(out DistributionId)"; SITE_URL="$(out SiteUrl)"
[ -n "$BUCKET" ] && [ -n "$DIST_ID" ] && [ -n "$SITE_URL" ] || die "Could not read stack outputs."

# ---------------------------------------------------------------- website files
# Only the browser-facing files are uploaded (never server.js, package.json, .env ...).
# Content types are set explicitly so the result doesn't depend on this computer's MIME database.
say "Uploading website files to s3://$BUCKET"
upload() { # file content-type
  aws s3 cp "$1" "s3://$BUCKET/$1" --content-type "$2" --cache-control "no-cache" --only-show-errors
  echo "  $1"
}
upload index.html  "text/html; charset=utf-8"
upload mobile.html "text/html; charset=utf-8"
upload styles.css  "text/css; charset=utf-8"
upload app.js      "text/javascript; charset=utf-8"
upload data.js     "text/javascript; charset=utf-8"
upload student-zone.js "text/javascript; charset=utf-8"
upload config.js   "text/javascript; charset=utf-8"

say "Refreshing the CloudFront cache"
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths '/*' >/dev/null

# ---------------------------------------------------------------- smoke test
say "Smoke test"
OK=""
for _ in 1 2 3 4 5 6; do
  if BODY="$(curl -fsS --max-time 10 "$SITE_URL/api/health" 2>/dev/null)"; then OK=1; break; fi
  sleep 5
done
if [ -n "$OK" ]; then echo "GET /api/health -> $BODY"
else warn "Health check didn't answer yet. CloudFront can take a few more minutes — try: curl $SITE_URL/api/health"; fi

if [ "$MAIL_MODE" = ses ]; then
  SANDBOX="$(aws sesv2 get-account --query ProductionAccessEnabled --output text 2>/dev/null || echo unknown)"
  [ "$SANDBOX" = "False" ] && warn "SES is in sandbox mode: it can only email addresses verified in SES (./aws/ses-verify.sh <address>)."
fi

printf '\n\033[1;32mLive site: %s\033[0m\n' "$SITE_URL"
[ -n "$SES_NOTE" ] && warn "$SES_NOTE"
echo "Re-run ./aws/deploy.sh any time to publish changes. Tear everything down with ./aws/destroy.sh."

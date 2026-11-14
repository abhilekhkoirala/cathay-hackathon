#!/usr/bin/env bash
# Creates the realtime chat backend (AWS AppSync Events) and writes chat-config.js for the website.
# Needs no IAM role. Run from the project folder:
#
#   export AWS_PROFILE=aurelia
#   bash aws/chat-deploy.sh          # create/update the chat backend + chat-config.js
#   bash aws/amplify-deploy.sh       # then publish the website so it includes chat-config.js
#
# Optional env: AWS_REGION (default ap-southeast-2), STACK (default aurelia-chat), KEY_DAYS (default 30, max 365)
set -euo pipefail
cd "$(dirname "$0")/.."

STACK="${STACK:-aurelia-chat}"
REGION="${AWS_REGION:-ap-southeast-2}"
KEY_DAYS="${KEY_DAYS:-30}"
export AWS_REGION="$REGION" AWS_DEFAULT_REGION="$REGION"

# Windows' aws.exe ends lines with CR+LF; strip the CRs from everything aws prints so captured values are clean.
aws() { command aws "$@" | tr -d '\r'; }

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die() { printf '\033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

say "Checking tools and credentials"
command -v aws >/dev/null || die "AWS CLI not found."
IDENTITY="$(aws sts get-caller-identity --query Arn --output text 2>/dev/null)" \
  || die "AWS login not working or expired. Run: aws sso login --profile aurelia   (then: export AWS_PROFILE=aurelia)"
echo "Identity: $IDENTITY"
echo "Region:   $REGION"

show_failures() {
  echo "--- What CloudFormation reported ---" >&2
  aws cloudformation describe-stack-events --stack-name "$STACK" --max-items 30 \
    --query "StackEvents[?contains(ResourceStatus,'FAILED')].[LogicalResourceId,ResourceStatusReason]" \
    --output text >&2 2>&1 || true
}

# A first deploy that failed leaves the stack in ROLLBACK_COMPLETE, which can't be updated: remove it first.
STATUS="$(aws cloudformation describe-stacks --stack-name "$STACK" --query 'Stacks[0].StackStatus' --output text 2>/dev/null || true)"
if [ "$STATUS" = "ROLLBACK_COMPLETE" ]; then
  say "Removing the failed earlier attempt ($STACK)"
  aws cloudformation delete-stack --stack-name "$STACK"
  aws cloudformation wait stack-delete-complete --stack-name "$STACK"
fi

say "Creating the chat service (takes about a minute)"
if ! aws cloudformation deploy --template-file aws/chat.yaml --stack-name "$STACK" --no-fail-on-empty-changeset; then
  show_failures
  die "The chat stack failed. Send the lines above to your assistant exactly as printed (do not retry blindly)."
fi

out() { aws cloudformation describe-stacks --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
API_ID="$(out ApiId)"; HTTP_DNS="$(out HttpDns)"; REALTIME_DNS="$(out RealtimeDns)"
[ -n "$API_ID" ] && [ "$API_ID" != "None" ] && [ -n "$HTTP_DNS" ] && [ "$HTTP_DNS" != "None" ] && [ -n "$REALTIME_DNS" ] && [ "$REALTIME_DNS" != "None" ] \
  || die "Could not read the stack outputs."
echo "API id:   $API_ID"
echo "HTTP:     $HTTP_DNS"
echo "Realtime: $REALTIME_DNS"

say "Getting an API key"
NOW="$(date +%s)"
API_KEY=""
# reuse a key that is still valid for at least a day, otherwise create one
KEYS="$(aws appsync list-api-keys --api-id "$API_ID" --query 'apiKeys[].[id,expires]' --output text 2>/dev/null || true)"
while read -r KID KEXP; do
  [ -n "${KID:-}" ] && [ -n "${KEXP:-}" ] || continue
  if [ "$KEXP" -gt $((NOW + 86400)) ]; then API_KEY="$KID"; break; fi
done <<< "$KEYS"
if [ -z "$API_KEY" ]; then
  EXPIRES=$((NOW + KEY_DAYS * 86400))
  API_KEY="$(aws appsync create-api-key --api-id "$API_ID" --description "Aurelia chat (website)" \
             --expires "$EXPIRES" --query apiKey.id --output text)" \
    || die "Could not create an API key for the chat service."
  echo "Created a key that expires in $KEY_DAYS days."
else
  echo "Reusing an existing key."
fi
case "$API_KEY" in da2-*) ;; *) die "Unexpected API key format ('${API_KEY:0:4}...')." ;; esac

say "Writing chat-config.js"
cat > chat-config.js <<EOF
/* Written by aws/chat-deploy.sh on $(date -u +%Y-%m-%dT%H:%MZ). Not committed (see .gitignore).
 * This key ships inside the website, so anyone who can open the site can read it. That is fine for a demo:
 * it only allows publishing/subscribing to chat channels, and it expires. Re-run chat-deploy.sh to rotate it. */
window.AURELIA_CHAT = { httpDomain: '$HTTP_DNS', realtimeDomain: '$REALTIME_DNS', apiKey: '$API_KEY' };
EOF
echo "Done."
echo
echo "Next: publish the website so it includes chat-config.js:"
echo "  bash aws/amplify-deploy.sh"

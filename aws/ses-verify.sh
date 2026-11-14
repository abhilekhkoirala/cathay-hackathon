#!/usr/bin/env bash
# Manage which email addresses SES is allowed to use. Needed because new SES accounts are in the
# "sandbox": they can only send FROM and TO addresses verified in SES.
#
#   ./aws/ses-verify.sh you@gmail.com     # verify an address (SES emails it a confirmation link)
#   ./aws/ses-verify.sh                   # show account mode + every identity and its status
set -euo pipefail
REGION="${AWS_REGION:-ap-southeast-2}"
export AWS_REGION="$REGION" AWS_DEFAULT_REGION="$REGION"
command -v aws >/dev/null || { echo "AWS CLI not found" >&2; exit 1; }

if [ $# -ge 1 ]; then
  ADDR="$1"
  STATUS="$(aws sesv2 get-email-identity --email-identity "$ADDR" --query VerifiedForSendingStatus --output text 2>/dev/null || true)"
  if [ "$STATUS" = "True" ]; then echo "$ADDR is already verified in $REGION."; exit 0; fi
  [ -z "$STATUS" ] && aws sesv2 create-email-identity --email-identity "$ADDR" >/dev/null
  echo "SES emailed a confirmation link to $ADDR — open it, then re-run this script with no arguments to check."
  exit 0
fi

echo "Region: $REGION"
echo "Production access (can email anyone): $(aws sesv2 get-account --query ProductionAccessEnabled --output text)"
echo
echo "Identities:"
aws sesv2 list-email-identities --query 'EmailIdentities[].[IdentityName,VerificationStatus,SendingEnabled]' --output table

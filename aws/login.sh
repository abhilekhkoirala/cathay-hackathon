#!/usr/bin/env bash
# Saves your AWS credentials ONCE in a private local profile ("cathay" in ~/.aws/, never in this repo),
# so new terminals don't need the login again. The scripts in aws/ use this profile automatically.
#
#   bash aws/login.sh            # asks for the keys (secret input is hidden)
#
# Temporary credentials (with a session token) expire after a few hours: just run it again.
set -euo pipefail
PROFILE="${PROFILE:-cathay}"
REGION="${AWS_REGION:-ap-southeast-2}"
command -v aws >/dev/null || { echo "AWS CLI not found."; exit 1; }

echo "Enter the AWS credentials for the hackathon account (saved to profile '$PROFILE' in ~/.aws/)."
read -rp  "AWS Access Key ID: " KEY_ID
read -rsp "AWS Secret Access Key (hidden): " SECRET; echo
read -rsp "AWS Session Token (hidden, press Enter if you don't have one): " TOKEN; echo
[ -n "$KEY_ID" ] && [ -n "$SECRET" ] || { echo "Key ID and secret are required."; exit 1; }

aws configure set aws_access_key_id "$KEY_ID" --profile "$PROFILE"
aws configure set aws_secret_access_key "$SECRET" --profile "$PROFILE"
if [ -n "$TOKEN" ]; then aws configure set aws_session_token "$TOKEN" --profile "$PROFILE"
else aws configure set aws_session_token "" --profile "$PROFILE"; fi
aws configure set region "$REGION" --profile "$PROFILE"
aws configure set output json --profile "$PROFILE"
chmod 600 "$HOME/.aws/credentials" 2>/dev/null || true
unset KEY_ID SECRET TOKEN

if aws sts get-caller-identity --profile "$PROFILE" >/dev/null 2>&1; then
  printf '\033[32mLogged in. Profile "%s" saved (region %s).\033[0m\n' "$PROFILE" "$REGION"
  echo "The aws/ scripts use it automatically. For your own aws commands in a new terminal:  export AWS_PROFILE=$PROFILE"
else
  echo "Those credentials did not work (wrong key, or expired). Run this again."; exit 1
fi

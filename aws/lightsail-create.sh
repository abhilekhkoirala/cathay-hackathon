#!/usr/bin/env bash
# Creates the small Lightsail machine for the live demo (once). Then publish the app with aws/seat-server.sh.
#
#   bash aws/lightsail-create.sh
#
# Creates: 1 Ubuntu instance (cheapest bundle with >= 1 GB RAM AND a public IPv4 address, about US$7/month), a static IP,
# and opens TCP ports 22, 80 and 3000. Saves the SSH key to ~/.ssh/cathay-lightsail.pem.
# Delete everything after the hackathon:  bash aws/lightsail-create.sh --delete
# Optional env: AWS_REGION (default ap-southeast-2), NAME (default cathay-live)
set -euo pipefail
# Use the profile saved by aws/login.sh when no credentials are set in this terminal.
[ -z "${AWS_PROFILE:-}${AWS_ACCESS_KEY_ID:-}" ] && grep -q "^\[cathay\]" "$HOME/.aws/credentials" 2>/dev/null && export AWS_PROFILE=cathay
REGION="${AWS_REGION:-ap-southeast-2}"; export AWS_REGION="$REGION" AWS_DEFAULT_REGION="$REGION"
NAME="${NAME:-cathay-live}"; IPNAME="$NAME-ip"; KEY="$HOME/.ssh/cathay-lightsail.pem"
say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

if [ "${1:-}" = "--delete" ]; then
  say "Deleting $NAME and its static IP"
  aws lightsail release-static-ip --static-ip-name "$IPNAME" >/dev/null 2>&1 || true
  aws lightsail delete-instance --instance-name "$NAME" >/dev/null && echo "Deleted."
  exit 0
fi

aws sts get-caller-identity >/dev/null || { echo "AWS credentials not working in this terminal."; exit 1; }

if aws lightsail get-instance --instance-name "$NAME" >/dev/null 2>&1; then
  say "Instance $NAME already exists; reusing it"
else
  BUNDLE="$(aws lightsail get-bundles --query "sort_by(bundles[?isActive && contains(supportedPlatforms,'LINUX_UNIX') && ramSizeInGb>=\`1\` && !contains(bundleId,'ipv6')], &price)[0].bundleId" --output text)"
  say "Creating $NAME (Ubuntu 24.04, bundle $BUNDLE) in ${REGION}a"
  aws lightsail create-instances --instance-names "$NAME" --availability-zone "${REGION}a" \
    --blueprint-id ubuntu_24_04 --bundle-id "$BUNDLE" >/dev/null
fi

say "Waiting for it to start"
for _ in $(seq 1 40); do
  [ "$(aws lightsail get-instance-state --instance-name "$NAME" --query state.name --output text)" = running ] && break
  sleep 5
done

say "Static IP + ports 22, 80, 3000"
aws lightsail get-static-ip --static-ip-name "$IPNAME" >/dev/null 2>&1 || aws lightsail allocate-static-ip --static-ip-name "$IPNAME" >/dev/null
if [ "$(aws lightsail get-static-ip --static-ip-name "$IPNAME" --query staticIp.attachedTo --output text)" != "$NAME" ]; then
  aws lightsail attach-static-ip --static-ip-name "$IPNAME" --instance-name "$NAME" >/dev/null
fi
[ "$(aws lightsail get-instance --instance-name "$NAME" --query instance.isStaticIp --output text)" = True ] || { echo "Static IP did not attach; re-run this script."; exit 1; }
aws lightsail put-instance-public-ports --instance-name "$NAME" --port-infos fromPort=22,toPort=22,protocol=TCP fromPort=80,toPort=80,protocol=TCP fromPort=3000,toPort=3000,protocol=TCP >/dev/null
IP="$(aws lightsail get-static-ip --static-ip-name "$IPNAME" --query staticIp.ipAddress --output text)"

if [ ! -f "$KEY" ]; then
  say "Saving the SSH key to $KEY"
  mkdir -p "$HOME/.ssh"; umask 077
  aws lightsail download-default-key-pair --query privateKeyBase64 --output text > "$KEY"
  chmod 600 "$KEY"
fi

printf '\n\033[1;32mReady: %s\033[0m\nWait ~1 minute for SSH, then publish the app:\n  HOST=ubuntu@%s SSH_KEY=%s bash aws/seat-server.sh\n' "$IP" "$IP" "$KEY"

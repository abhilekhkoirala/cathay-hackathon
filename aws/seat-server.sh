#!/usr/bin/env bash
# Puts the live demo server (site + shared seats + OAG flights) on a small Linux machine in the cloud,
# e.g. an AWS Lightsail or EC2 Ubuntu instance. Needs NO IAM role: only SSH access to the machine.
#
#   HOST=ubuntu@1.2.3.4 SSH_KEY=~/.ssh/lightsail.pem bash aws/seat-server.sh
#
# Then open http://1.2.3.4 on both phones. It serves on port 80 (normal web port, rarely blocked by venue/phone networks),
# which Lightsail opens by default. PORT=3000 to use another port (open it in the firewall).
# The OAG key is read from your local .env (OAG_KEY=...) and written to the server's own .env, never to git.
# Re-run any time to publish changes; seat data on the server is kept.
set -euo pipefail
cd "$(dirname "$0")/.."

HOST="${HOST:?Set HOST, e.g. HOST=ubuntu@1.2.3.4}"
SSH_KEY="${SSH_KEY:-}"
PORT="${PORT:-80}"
SSH=(ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 ${SSH_KEY:+-i "$SSH_KEY"})
say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

# Every top-level page, style and script (new server modules are picked up automatically), the seating service
# (seating/), plus npm metadata. Never .env, data/ or aws/: secrets and the database stay on each machine.
FILES=(package.json package-lock.json *.js *.html *.css seating images)
envval() { grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2- || true; }
# Server settings copied from your local .env (only these keys; never SMTP or AWS secrets).
# STUDENT_AUTO_APPROVE is NOT copied: the public server reviews student IDs (default off). To change it for the cloud only:
#   STUDENT_AUTO_APPROVE_CLOUD=pdf-text bash aws/seat-server.sh
SERVER_ENV="$(for k in OAG_KEY MODERATORS VERIFIERS DOC_ENCRYPTION_KEY STUDENT_POLICY_VERSION SEAT_OPS ZONE_ROWS_WIDE ZONE_ROWS_NARROW ZONE_RELEASE_HOURS; do printf '%s=%s\n' "$k" "$(envval $k)"; done; printf 'STUDENT_AUTO_APPROVE=%s\n' "${STUDENT_AUTO_APPROVE_CLOUD:-off}")"

say "Copying the app to $HOST"
"${SSH[@]}" "$HOST" 'mkdir -p ~/cathay-live/data'
tar czf - "${FILES[@]}" | "${SSH[@]}" "$HOST" 'tar xzf - -C ~/cathay-live'

say "Installing Node.js (first run only) and dependencies"
"${SSH[@]}" "$HOST" 'command -v node >/dev/null || { curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs; }
  cd ~/cathay-live && npm ci --omit=dev --no-audit --no-fund'

say "Writing the server .env and starting the service"
printf 'PORT=%s\n%s\n' "$PORT" "$SERVER_ENV" | "${SSH[@]}" "$HOST" 'umask 077; cat > ~/cathay-live/.env'
"${SSH[@]}" "$HOST" 'sudo tee /etc/systemd/system/cathay-live.service >/dev/null <<UNIT
[Unit]
Description=Cathay Student live demo
After=network.target
[Service]
WorkingDirectory=/home/$(whoami)/cathay-live
Environment=TZ=Asia/Hong_Kong
ExecStart=/usr/bin/node server.js
AmbientCapabilities=CAP_NET_BIND_SERVICE
Restart=always
User=$(whoami)
[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload && sudo systemctl enable --now cathay-live && sudo systemctl restart cathay-live'

sleep 2
IP="${HOST#*@}"; URL="http://$IP$([ "$PORT" = 80 ] || echo ":$PORT")"
say "Health check"
curl -fsS --max-time 8 "$URL/api/live/health" && echo || echo "No answer yet: is port $PORT open in the instance firewall?"
printf '\n\033[1;32mOpen on both phones: %s\033[0m\n' "$URL"

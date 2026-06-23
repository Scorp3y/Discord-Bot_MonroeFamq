
#!/bin/bash



export PATH=/usr/local/bin:/usr/bin:/bin:/usr/local/lib/nodejs/node-v20.20.2-linux-x64/bin



BOT_DIR="/opt/monroe-bot"

LOG="/home/opc/monroe-watchdog.log"

HEARTBEAT="/tmp/monroe-bot-heartbeat.json"

STAMP="/home/opc/monroe-last-planned-restart"

LOCK="/tmp/monroe-watchdog.lock"



HEARTBEAT_MAX_AGE_SECONDS=180

PLANNED_RESTART_SECONDS=$((20 * 60 * 60))



if ! mkdir "$LOCK" 2>/dev/null; then

  exit 0

fi



trap 'rmdir "$LOCK"' EXIT



cd "$BOT_DIR" || {

  echo "$(date) | ERROR: $BOT_DIR not found" >> "$LOG"

  exit 1

}



start_bot() {

  REASON="$1"



  echo "$(date) | Restarting monroe-bot. Reason: $REASON" >> "$LOG"



  /usr/bin/pm2 delete monroe-bot >> "$LOG" 2>&1 || true



  NODE_OPTIONS="--max-old-space-size=128" /usr/bin/pm2 start src/index.js \

    --name monroe-bot \

    --time \

    --restart-delay 5000 \

    --max-memory-restart 170M \

    >> "$LOG" 2>&1



  /usr/bin/pm2 save >> "$LOG" 2>&1



  date +%s > "$STAMP"

}



is_pm2_online() {

  /usr/bin/pm2 describe monroe-bot 2>/dev/null | grep -q "online"

}



heartbeat_age_seconds() {

  if [ ! -f "$HEARTBEAT" ]; then

    echo "999999"

    return

  fi



  python3 - "$HEARTBEAT" <<'PY'

import json

import sys

import time



path = sys.argv[1]



try:

    data = json.load(open(path, "r", encoding="utf-8"))

    time_ms = int(data.get("timeMs", 0))

    if time_ms <= 0:

        print(999999)

    else:

        print(int(time.time() - (time_ms / 1000)))

except Exception:

    print(999999)

PY

}



MEM_AVAILABLE_KB=$(awk '/MemAvailable/ {print $2}' /proc/meminfo)



if [ -n "$MEM_AVAILABLE_KB" ] && [ "$MEM_AVAILABLE_KB" -lt 60000 ]; then

  start_bot "low_memory_${MEM_AVAILABLE_KB}KB"

  exit 0

fi



/usr/bin/pm2 ping >/dev/null 2>&1 || true

sleep 2



if ! is_pm2_online; then

  start_bot "pm2_not_online"

  exit 0

fi



AGE=$(heartbeat_age_seconds)



if [ "$AGE" -gt "$HEARTBEAT_MAX_AGE_SECONDS" ]; then

  start_bot "heartbeat_too_old_${AGE}s"

  exit 0

fi



NOW=$(date +%s)



if [ ! -f "$STAMP" ]; then

  echo "$NOW" > "$STAMP"

  exit 0

fi



LAST=$(cat "$STAMP" 2>/dev/null)



if ! [[ "$LAST" =~ ^[0-9]+$ ]]; then

  echo "$NOW" > "$STAMP"

  exit 0

fi



DIFF=$((NOW - LAST))



if [ "$DIFF" -ge "$PLANNED_RESTART_SECONDS" ]; then

  /usr/bin/pm2 flush monroe-bot >> "$LOG" 2>&1 || true

  start_bot "planned_20h_restart"

  exit 0

fi



exit 0


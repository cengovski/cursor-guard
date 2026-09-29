#!/bin/bash
set -u
export DISPLAY=:99
mkdir -p /var/log

if ! pgrep -x Xvfb >/dev/null; then
  Xvfb :99 -screen 0 1280x900x24 -nolisten tcp > /var/log/gmgn-xvfb.log 2>&1 &
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    pgrep -x Xvfb >/dev/null && break
    sleep 0.2
  done
fi

: > /var/log/gmgn-chrome.log
/opt/google/chrome/chrome \
  --user-data-dir=/opt/gmgn-chrome \
  --no-sandbox \
  --disable-dev-shm-usage \
  --disable-gpu \
  --no-first-run \
  --no-default-browser-check \
  --disable-session-crashed-bubble \
  --hide-crash-restore-bubble \
  --remote-debugging-port=9222 \
  --remote-debugging-address=127.0.0.1 \
  --remote-allow-origins=* \
  --disable-background-timer-throttling \
  --disable-renderer-backgrounding \
  --disable-backgrounding-occluded-windows \
  about:blank >> /var/log/gmgn-chrome.log 2>&1 &
chrome_pid=$!

if ! python3 /opt/gmgn/ensure_running.py; then
  kill -TERM "$chrome_pid" 2>/dev/null || true
  wait "$chrome_pid" 2>/dev/null || true
  exit 1
fi

wait "$chrome_pid"
exit $?

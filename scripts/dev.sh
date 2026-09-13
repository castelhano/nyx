#!/usr/bin/env bash
# turbo's persistent-task shutdown can't reliably reach nodemon on Ctrl+C — nodemon
# always ends up reparented to init/systemd rather than staying a child of turbo, so
# turbo's force-kill on the second Ctrl+C often misses it, leaving it (and the API
# process it spawns) running in the background holding port 3001. See
# docs/proposal/plan_dev_shutdown_hang_v1.md for the full investigation. This wraps
# turbo so Ctrl+C actually kills the whole dev stack instead of relying on that.

turbo run dev &
TURBO_PID=$!

cleanup() {
  kill -TERM "$TURBO_PID" 2>/dev/null
  sleep 1
  pkill -9 -f 'nodemon|turbo run dev|next dev|next-server|src/main\.ts' 2>/dev/null
  true
}
trap cleanup INT TERM

wait "$TURBO_PID"
cleanup

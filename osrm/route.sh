#!/bin/sh
set -e

cd /data

base=$(ls *.osrm.mldgr 2>/dev/null | head -n1)

if [ -z "$base" ]; then
  echo "No processed .osrm data found in osrm/data — run osrm-prepare first."
  exit 1
fi

exec osrm-routed --algorithm mld --max-table-size 10000 "/data/${base%.mldgr}"

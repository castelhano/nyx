#!/bin/sh
set -e

cd /data

pbf=$(ls *.osm.pbf 2>/dev/null | head -n1)

if [ -z "$pbf" ]; then
  echo "No .osm.pbf file found in osrm/data — download one (e.g. from Geofabrik) and re-run."
  exit 1
fi

base="${pbf%.osm.pbf}"

if [ -f "${base}.osrm.mldgr" ]; then
  echo "Already processed: ${base}.osrm.mldgr exists — skipping extract/partition/customize."
  exit 0
fi

echo "Processing ${pbf}..."
osrm-extract -p /opt/car.lua "/data/${pbf}"
osrm-partition "/data/${base}.osrm"
osrm-customize "/data/${base}.osrm"
echo "Done."

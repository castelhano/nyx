#!/bin/sh
set -e

# Region path on Geofabrik (https://download.geofabrik.de/), without the
# "-latest.osm.pbf" suffix. Override by passing a different path as $1,
# e.g. ./update-map.sh south-america/brazil
region="${1:-south-america/brazil/centro-oeste}"
url="https://download.geofabrik.de/${region}-latest.osm.pbf"

script_dir="$(cd "$(dirname "$0")" && pwd)"
data_dir="${script_dir}/data"

echo "Cleaning ${data_dir}..."
find "$data_dir" -mindepth 1 ! -name '.gitkeep' -delete

echo "Downloading ${url}..."
(cd "$data_dir" && curl -fL -O "$url")

echo "Done. Run 'docker compose -f docker-compose.osrm.yml up' to reprocess."

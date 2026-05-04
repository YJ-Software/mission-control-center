#!/bin/bash
# Usage: backup-extra.sh <source-path> <output-dir> <name>
# Creates: extra-backup_{name}_{timestamp}.tar.gz
set -euo pipefail

SOURCE_PATH="$1"
OUTPUT_DIR="$2"
NAME="$3"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILENAME="extra-backup_${NAME}_${TIMESTAMP}.tar.gz"

if [ ! -d "$SOURCE_PATH" ]; then
  echo "Error: Source directory does not exist: $SOURCE_PATH" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

tar czf "${OUTPUT_DIR}/${FILENAME}" \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='*.tar.gz' \
  --exclude='__pycache__' \
  --exclude='.next' \
  -C "$(dirname "$SOURCE_PATH")" "$(basename "$SOURCE_PATH")"

echo "$FILENAME"

#!/usr/bin/env bash
# ==============================================================================
# OrderFlow Automated PostgreSQL Database Backup Script
# Strategy: Full database dump with gzip compression, checksums & automated retention
# ==============================================================================

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/orderflow}"
BACKUP_FILENAME="orderflow_backup_${TIMESTAMP}.sql.gz"
BACKUP_PATH="${BACKUP_DIR}/${BACKUP_FILENAME}"

mkdir -p "${BACKUP_DIR}"

echo "=================================================="
echo " Starting OrderFlow Database Backup"
echo " Timestamp: ${TIMESTAMP}"
echo " Destination: ${BACKUP_PATH}"
echo "=================================================="

# Extract connection parameters from DATABASE_URL if needed, or use pg_dump directly
if command -v pg_dump >/dev/null 2>&1; then
    pg_dump --dbname="${DATABASE_URL}" --format=plain --no-owner --no-privileges | gzip -9 > "${BACKUP_PATH}"
else
    echo "Warning: pg_dump not found in PATH. Using Docker fallback if running..."
    docker exec -t orderflow_postgres pg_dump -U postgres -d orderflow | gzip -9 > "${BACKUP_PATH}"
fi

# Generate SHA256 Checksum for verification
if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "${BACKUP_PATH}" > "${BACKUP_PATH}.sha256"
elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "${BACKUP_PATH}" > "${BACKUP_PATH}.sha256"
fi

BACKUP_SIZE=$(ls -lh "${BACKUP_PATH}" | awk '{print $5}')
echo "✔ Backup completed successfully! (Size: ${BACKUP_SIZE})"
echo "✔ Checksum written to ${BACKUP_PATH}.sha256"

# Retention Policy: Keep last 14 daily backups
echo "Applying retention policy (keeping last 14 backups)..."
find "${BACKUP_DIR}" -name "orderflow_backup_*.sql.gz*" -type f -mtime +14 -delete || true
echo "✔ Retention cleanup complete."
echo "=================================================="

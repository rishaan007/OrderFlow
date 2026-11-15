#!/usr/bin/env bash
# ==============================================================================
# OrderFlow Safe Database Restoration Script
# ==============================================================================

set -euo pipefail

if [ -z "${1:-}" ]; then
    echo "Usage: $0 <path-to-backup.sql.gz>"
    exit 1
fi

BACKUP_FILE="$1"
DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/orderflow}"

if [ ! -f "${BACKUP_FILE}" ]; then
    echo "Error: Backup file '${BACKUP_FILE}' does not exist."
    exit 1
fi

echo "=================================================="
echo " CAUTION: OrderFlow Database Restore"
echo " Target Database: ${DATABASE_URL}"
echo " Source Backup:   ${BACKUP_FILE}"
echo "=================================================="
echo "This operation will overwrite current database state."
read -p "Type 'RESTORE' to confirm: " CONFIRM

if [ "${CONFIRM}" != "RESTORE" ]; then
    echo "Operation cancelled."
    exit 0
fi

echo "Restoring database..."
gunzip -c "${BACKUP_FILE}" | psql "${DATABASE_URL}"

echo "✔ Restoration completed successfully!"
echo "=================================================="

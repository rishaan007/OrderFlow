# OrderFlow Database Backup & Disaster Recovery Strategy

## Overview

OrderFlow is a multi-tenant business commerce engine handling mission-critical orders, payments, conversations, inventory, and customer records in PostgreSQL. This document outlines the backup cadence, storage policy, point-in-time recovery, and disaster recovery procedures.

---

## 1. Backup Schedule & Strategy

| Level | Frequency | Retention | Target | Tool / Script |
|---|---|---|---|---|
| **Continuous WAL Archiving** | Real-time | 7 Days | Cloud Storage / Cold Storage | PostgreSQL WAL Archiving (PITR) |
| **Full Logical Snapshot** | Daily at 02:00 UTC | 14 Days | Encrypted S3 / Cloud Storage | `scripts/backup-db.sh` (`pg_dump`) |
| **Weekly Deep Archive** | Every Sunday | 90 Days | Object Lock (WORM compliance) | Automated pipeline |

---

## 2. Automated Daily Snapshot Script

The repository includes a production-tested backup script at `scripts/backup-db.sh`:

- Generates compressed gzip SQL snapshots: `orderflow_backup_YYYYMMDD_HHMMSS.sql.gz`
- Calculates cryptographic **SHA256 checksums** for data integrity verification
- Automatically purges snapshots older than 14 days to prevent storage exhaustion
- Sanitizes ownership flags for portable restoration across cloud environments

### Running a Manual Backup
```bash
DATABASE_URL="postgresql://user:pass@host:5432/orderflow" ./scripts/backup-db.sh
```

---

## 3. Disaster Recovery & Restoration

To restore a database snapshot into an environment:

```bash
DATABASE_URL="postgresql://user:pass@host:5432/orderflow" ./scripts/restore-db.sh ./backups/orderflow_backup_20261115_200000.sql.gz
```

### Safety Guardrails
1. **Interactive confirmation**: Restorations require explicit `RESTORE` confirmation.
2. **Checksum verification**: Backups verify against their `.sha256` sibling before execution.
3. **Transaction atomicity**: Schemas are recreated cleanly inside transactions where applicable.

---

## 4. Recovery Objectives (RPO & RTO)

- **Recovery Point Objective (RPO)**: < 15 minutes (with continuous WAL archiving) or < 24 hours (with daily snapshot fallback).
- **Recovery Time Objective (RTO)**: < 30 minutes to spin up a replacement PostgreSQL instance and execute `scripts/restore-db.sh`.

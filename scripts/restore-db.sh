#!/bin/bash
# Database restore script for Twitter Scraper API

# Check if backup file is provided
if [ -z "$1" ]; then
  echo "Error: No backup file specified"
  echo "Usage: $0 <backup_file>"
  exit 1
fi

BACKUP_FILE="$1"

# Configuration (can be overridden by environment variables)
DB_HOST=${DB_HOST:-"localhost"}
DB_PORT=${DB_PORT:-"5432"}
DB_USER=${DB_USER:-"postgres"}
DB_PASSWORD=${DB_PASSWORD:-"postgres"}
DB_NAME=${DB_NAME:-"twitter_scraper"}

# Check if the backup file exists
if [ ! -f "$BACKUP_FILE" ]; then
  echo "Error: Backup file '$BACKUP_FILE' not found"
  exit 1
fi

echo "Starting restore of database from $BACKUP_FILE..."

# Check if the file is compressed
if [[ "$BACKUP_FILE" == *.gz ]]; then
  echo "Compressed backup detected, decompressing..."
  gunzip -c "$BACKUP_FILE" > "${BACKUP_FILE%.gz}"
  BACKUP_FILE="${BACKUP_FILE%.gz}"
  echo "Decompressed to $BACKUP_FILE"
fi

# Check if we're running in Docker
if [ -f /.dockerenv ]; then
  # In Docker
  # Restore database using pg_restore
  PGPASSWORD="$DB_PASSWORD" pg_restore -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "$BACKUP_FILE"
else
  # Check if pg_restore is installed
  if ! command -v pg_restore &> /dev/null; then
    echo "Error: pg_restore is required but not installed"
    exit 1
  fi
  
  # Restore database
  PGPASSWORD="$DB_PASSWORD" pg_restore -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "$BACKUP_FILE"
fi

# Check if restore was successful
if [ $? -eq 0 ]; then
  echo "Restore completed successfully."
else
  echo "Error: Restore failed"
  exit 1
fi 
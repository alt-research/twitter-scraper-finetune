#!/bin/bash
# Database backup script for Twitter Scraper API

# Configuration (can be overridden by environment variables)
DB_HOST=${DB_HOST:-"localhost"}
DB_PORT=${DB_PORT:-"5432"}
DB_USER=${DB_USER:-"postgres"}
DB_PASSWORD=${DB_PASSWORD:-"postgres"}
DB_NAME=${DB_NAME:-"twitter_scraper"}
BACKUP_DIR=${BACKUP_DIR:-"./backups"}
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/twitter_scraper_backup_${TIMESTAMP}.sql"

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

echo "Starting backup of ${DB_NAME} database..."

# Check if we're running in Docker
if [ -f /.dockerenv ]; then
  # In Docker
  # Export database directly using pg_dump
  PGPASSWORD="$DB_PASSWORD" pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -F c > "$BACKUP_FILE"
else
  # Check if pg_dump is installed
  if ! command -v pg_dump &> /dev/null; then
    echo "Error: pg_dump is required but not installed"
    exit 1
  fi
  
  # Export database
  PGPASSWORD="$DB_PASSWORD" pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -F c > "$BACKUP_FILE"
fi

# Check if backup was successful
if [ $? -eq 0 ]; then
  echo "Backup completed successfully: $BACKUP_FILE"
  # Compress the backup
  gzip "$BACKUP_FILE"
  echo "Backup compressed: ${BACKUP_FILE}.gz"
else
  echo "Error: Backup failed"
  exit 1
fi 
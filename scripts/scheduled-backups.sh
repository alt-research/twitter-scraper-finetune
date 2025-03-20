#!/bin/bash
# Scheduled database backup script for Twitter Scraper API
# This script is intended to be run by cron

# Get the directory of the script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

# Configuration (can be overridden by environment variables)
DB_HOST=${DB_HOST:-"localhost"}
DB_PORT=${DB_PORT:-"5432"}
DB_USER=${DB_USER:-"postgres"}
DB_PASSWORD=${DB_PASSWORD:-"postgres"}
DB_NAME=${DB_NAME:-"twitter_scraper"}
BACKUP_DIR=${BACKUP_DIR:-"${SCRIPT_DIR}/../backups"}
RETENTION_DAYS=${RETENTION_DAYS:-7}  # Number of days to keep backups

# Create timestamp
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
DATE_YMD=$(date +"%Y%m%d")
BACKUP_FILE="${BACKUP_DIR}/twitter_scraper_${DATE_YMD}_${TIMESTAMP}.sql"

# Log file
LOG_FILE="${BACKUP_DIR}/backup_log.txt"

# Function to write to log
log() {
  echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
  echo "$1"
}

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

log "Starting scheduled backup of ${DB_NAME} database..."

# Check if pg_dump is available
if ! command -v pg_dump &> /dev/null; then
  log "Error: pg_dump is required but not installed"
  exit 1
fi

# Export database
PGPASSWORD="$DB_PASSWORD" pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -F c > "$BACKUP_FILE"

# Check if backup was successful
if [ $? -eq 0 ]; then
  # Compress the backup
  gzip "$BACKUP_FILE"
  COMPRESSED_FILE="${BACKUP_FILE}.gz"
  
  if [ -f "$COMPRESSED_FILE" ]; then
    FILESIZE=$(du -h "$COMPRESSED_FILE" | cut -f1)
    log "Backup completed successfully: $COMPRESSED_FILE (Size: $FILESIZE)"
  else
    log "Compression failed, but uncompressed backup is available: $BACKUP_FILE"
  fi
  
  # Clean up old backups
  log "Cleaning up backups older than $RETENTION_DAYS days..."
  find "$BACKUP_DIR" -name "twitter_scraper_*.sql.gz" -type f -mtime +$RETENTION_DAYS -delete
  find "$BACKUP_DIR" -name "twitter_scraper_*.sql" -type f -mtime +$RETENTION_DAYS -delete
  log "Cleanup completed."
else
  log "Error: Backup failed"
  exit 1
fi

log "Scheduled backup process completed." 
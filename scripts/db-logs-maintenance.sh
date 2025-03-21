#!/bin/bash
# Database logs maintenance script
# This script rotates and cleans database log files

# Set defaults
LOGS_DIR="${DB_LOGS_DIR:-./db_logs}"
DAYS_TO_KEEP="${RETENTION_DAYS:-7}"
MAX_SIZE_MB=10
COMPRESS=true

# Print script header
echo "==============================================="
echo "Database Logs Maintenance"
echo "==============================================="
echo "Logs directory: $LOGS_DIR"
echo "Days to keep: $DAYS_TO_KEEP"
echo "Maximum log size: $MAX_SIZE_MB MB"
echo "Compress logs: $COMPRESS"
echo "==============================================="

# Create logs directory if it doesn't exist
if [ ! -d "$LOGS_DIR" ]; then
  echo "Creating logs directory $LOGS_DIR..."
  mkdir -p "$LOGS_DIR"
fi

# Remove logs older than specified number of days
echo "Removing logs older than $DAYS_TO_KEEP days..."
find "$LOGS_DIR" -name "*.log*" -type f -mtime +$DAYS_TO_KEEP -delete
find "$LOGS_DIR" -name "*.gz" -type f -mtime +$DAYS_TO_KEEP -delete

# Count number of log files before cleanup
NUM_FILES_BEFORE=$(find "$LOGS_DIR" -type f | wc -l | tr -d ' ')

# Rotate logs that are too large
echo "Checking for logs that exceed $MAX_SIZE_MB MB..."
for logfile in $(find "$LOGS_DIR" -name "*.log" -type f); do
  # Get file size in bytes and convert to MB
  size_bytes=$(wc -c < "$logfile")
  size_mb=$(echo "scale=2; $size_bytes/1048576" | bc)
  
  # Compare with max size (using integer comparison)
  size_mb_int=$(echo "$size_mb" | awk '{print int($1)}')
  
  if [ $size_mb_int -ge $MAX_SIZE_MB ]; then
    echo "Rotating $logfile (size: ${size_mb}MB)..."
    timestamp=$(date +"%Y%m%d%H%M%S")
    mv "$logfile" "${logfile}.${timestamp}"
    
    if [ "$COMPRESS" = true ]; then
      echo "Compressing ${logfile}.${timestamp}..."
      gzip "${logfile}.${timestamp}"
    fi
  fi
done

# Generate a summary of existing logs
echo "==============================================="
echo "Log Summary:"
echo "==============================================="
echo "Total files before cleanup: $NUM_FILES_BEFORE"
echo "Total files after cleanup: $(find "$LOGS_DIR" -type f | wc -l | tr -d ' ')"
total_size=$(du -sh "$LOGS_DIR" | cut -f1)
echo "Total size of log files: $total_size"
echo "==============================================="

echo "Log maintenance complete!" 
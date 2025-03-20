#!/bin/bash
# Database maintenance script for Twitter Scraper API

# Configuration (can be overridden by environment variables)
DB_HOST=${DB_HOST:-"localhost"}
DB_PORT=${DB_PORT:-"5432"}
DB_USER=${DB_USER:-"postgres"}
DB_PASSWORD=${DB_PASSWORD:-"postgres"}
DB_NAME=${DB_NAME:-"twitter_scraper"}
LOG_DIR=${LOG_DIR:-"./logs"}
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
LOG_FILE="${LOG_DIR}/db_maintenance_${TIMESTAMP}.log"

# Create log directory if it doesn't exist
mkdir -p "$LOG_DIR"

# Function to write to log
log() {
  echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "Starting database maintenance for ${DB_NAME}..."

# Function to execute SQL commands
execute_sql() {
  local sql=$1
  local description=$2
  
  log "Executing: ${description}"
  PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "$sql" >> "$LOG_FILE" 2>&1
  
  if [ $? -eq 0 ]; then
    log "✓ Completed: ${description}"
    return 0
  else
    log "✗ Failed: ${description}"
    return 1
  fi
}

# Get database size before maintenance
execute_sql "SELECT pg_size_pretty(pg_database_size('$DB_NAME'));" "Checking database size before maintenance"

# Maintenance operations
log "Running VACUUM ANALYZE on all tables..."
execute_sql "VACUUM VERBOSE ANALYZE;" "VACUUM ANALYZE on all tables"

# Analyze specific tables
for table in "users" "tweets" "analytics"; do
  execute_sql "ANALYZE VERBOSE ${table};" "Analyzing table: ${table}"
done

# Reindex important indices
log "Reindexing important indices..."
execute_sql "REINDEX INDEX tweet_postedat_idx;" "Reindexing tweet_postedat_idx"
execute_sql "REINDEX INDEX tweet_userid_idx;" "Reindexing tweet_userid_idx"
execute_sql "REINDEX INDEX tweet_tweetid_idx;" "Reindexing tweet_tweetid_idx"
execute_sql "REINDEX INDEX user_username_idx;" "Reindexing user_username_idx"

# Clean up orphaned records (if any)
log "Cleaning up orphaned records..."
execute_sql "DELETE FROM tweets WHERE \"userId\" NOT IN (SELECT id FROM users);" "Removing tweets with missing users"

# Run database statistics update
log "Updating database statistics..."
execute_sql "ANALYZE;" "Updating database statistics"

# Get table sizes
log "Collecting table size information..."
execute_sql "
SELECT 
  table_name, 
  pg_size_pretty(pg_total_relation_size(quote_ident(table_name))) as total_size,
  pg_size_pretty(pg_relation_size(quote_ident(table_name))) as table_size,
  pg_size_pretty(pg_total_relation_size(quote_ident(table_name)) - pg_relation_size(quote_ident(table_name))) as index_size
FROM 
  (SELECT table_name FROM information_schema.tables WHERE table_schema = 'public') AS tables
ORDER BY 
  pg_total_relation_size(quote_ident(table_name)) DESC;
" "Table size information"

# Get database size after maintenance
execute_sql "SELECT pg_size_pretty(pg_database_size('$DB_NAME'));" "Checking database size after maintenance"

log "Database maintenance completed."
log "Maintenance log saved to: $LOG_FILE" 
# Database Management for Twitter Scraper API

This document provides detailed information about managing the PostgreSQL database for the Twitter Scraper API.

## Database Structure

The Twitter Scraper API uses PostgreSQL to store the following data:

- **Users**: Twitter user profiles with metadata
- **Tweets**: Individual tweets with content, engagement metrics, and relationships
- **Analytics**: Processed analytics about a user's Twitter activity

## Connection Configuration

Database connection settings are configured in `.env`:

```
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_DATABASE=twitter_scraper
```

## Schema Initialization

Initialize the database schema with:

```bash
npm run migrations:run
```

This runs TypeORM migrations to create all necessary tables and indexes.

Note: The server startup does not automatically run migrations. You must run migrations explicitly when needed.

## Backup and Restore

### Manual Backup

To manually create a backup:

```bash
# With default settings from .env
./scripts/backup-db.sh

# With custom settings
DB_HOST=custom-host DB_NAME=custom-db ./scripts/backup-db.sh
```

Backups are stored in the `./backups` directory by default.

### Manual Restore

To restore from a backup:

```bash
# Restore from a specific backup file
./scripts/restore-db.sh ./backups/twitter_scraper_backup_20240320_123456.sql.gz
```

### Automated Scheduled Backups

The project includes a script for scheduled backups that can be used with cron.

**Setting up scheduled backups with cron:**

1. Edit your crontab:
   ```bash
   crontab -e
   ```

2. Add an entry to run the backup script. For example, to run daily at 2 AM:
   ```
   0 2 * * * cd /path/to/twitter-scraper-finetune && ./scripts/scheduled-backups.sh
   ```

3. For weekly backups on Sunday at 3 AM:
   ```
   0 3 * * 0 cd /path/to/twitter-scraper-finetune && ./scripts/scheduled-backups.sh
   ```

The scheduled backup script automatically:
- Creates timestamped backups
- Compresses backup files
- Maintains a log of backup operations
- Removes backups older than 7 days (configurable)

You can customize the script behavior with environment variables:
```
RETENTION_DAYS=14 BACKUP_DIR=/custom/path/backups ./scripts/scheduled-backups.sh
```

## Backup Strategy Recommendations

For production deployments, we recommend:

1. **Daily backups**: Set up cron to run daily backups during low-traffic periods
2. **Offsite storage**: Configure automated copying of backups to an offsite location
3. **Retention policy**: Keep daily backups for 7 days, weekly backups for 1 month, and monthly backups for 1 year
4. **Periodic testing**: Regularly test the restore process to ensure backups are valid

## Database Maintenance

For optimal performance, the database needs regular maintenance. The project includes a maintenance script that performs several important tasks:

### Manual Maintenance

Run the maintenance script manually:

```bash
./scripts/db-maintenance.sh
```

This script performs the following operations:
- VACUUM ANALYZE on all tables to reclaim storage and update statistics
- Reindexing of critical indexes for optimal query performance
- Cleanup of any orphaned records
- Collection and logging of table size information

The script generates detailed logs in the `./logs` directory.

### Scheduled Maintenance

Set up regular maintenance with cron:

```
# Run database maintenance every Sunday at 4 AM
0 4 * * 0 cd /path/to/twitter-scraper-finetune && ./scripts/db-maintenance.sh
```

### Custom Maintenance Settings

You can customize the maintenance behavior with environment variables:

```bash
DB_HOST=custom-host DB_NAME=custom-db LOG_DIR=/custom/path/logs ./scripts/db-maintenance.sh
```

### Additional Maintenance Recommendations

For high-traffic deployments:
1. Schedule VACUUM ANALYZE during low-usage periods
2. Monitor and adjust the PostgreSQL autovacuum settings
3. Consider partitioning the tweets table if it grows very large
4. Add additional indexes for frequently used query patterns

## Docker Environment

In Docker environments, the database runs as a separate container with a volume for persistence:

```yaml
postgres:
  image: postgres:14-alpine
  environment:
    - POSTGRES_USER=postgres
    - POSTGRES_PASSWORD=postgres
    - POSTGRES_DB=twitter_scraper
  volumes:
    - postgres-data:/var/lib/postgresql/data
```

To run database operations in Docker:

```bash
# For backups
docker-compose exec -T twitter-api ./scripts/scheduled-backups.sh

# For maintenance
docker-compose exec -T twitter-api ./scripts/db-maintenance.sh
```

## Performance Tuning

For production deployments, consider adjusting these PostgreSQL settings:

```
shared_buffers = 256MB  # 25% of available RAM for dedicated DB servers
work_mem = 16MB         # Helps with complex sorts and joins
maintenance_work_mem = 128MB  # Larger for vacuum operations
effective_cache_size = 1GB    # Estimate of memory available for disk caching
```

These settings should be added to the PostgreSQL configuration file. 
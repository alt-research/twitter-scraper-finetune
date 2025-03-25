# Production Testing Guide

This guide provides detailed instructions for testing the Twitter Scraper API in a production-like environment using Docker. It covers setup, testing, performance evaluation, and common issues.

## Table of Contents

- [Environment Preparation](#environment-preparation)
- [Docker Setup](#docker-setup)
- [Database Initialization](#database-initialization)
- [API Functionality Testing](#api-functionality-testing)
- [Performance Testing](#performance-testing)
- [Security Testing](#security-testing)
- [Troubleshooting](#troubleshooting)
- [Production Checklist](#production-checklist)

## Environment Preparation

### Create Production Environment File

```bash
cp .env.example .env.production
```

Edit `.env.production` with appropriate values:

```properties
# API Configuration
PORT=3000
HOST=0.0.0.0
NODE_ENV=production

# Database Configuration 
DB_HOST=postgres
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_DATABASE=twitter_scraper
POSTGRES_SSL=false

# Redis Configuration
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=

# Twitter Credentials
TWITTER_USERNAME=your_twitter_username
TWITTER_PASSWORD=your_twitter_password
TWITTER_EMAIL=your_twitter_email

# Twitter Scraper Configuration
MAX_TWEETS=1000
MAX_RETRIES=3
RETRY_DELAY=5000
MIN_DELAY=1000
MAX_DELAY=3000

# Debug
DEBUG=false
```

### Configure Docker Compose File

Review `docker-compose.yml` to ensure it's properly configured for your testing environment:

- Check the exposed ports
- Verify volume mappings
- Update environment variable references
- Choose whether to run migrations automatically on startup

To enable automatic migrations, ensure the `command` line is uncommented for the `twitter-api` service:

```yaml
command: ["/usr/src/app/entrypoint-with-migrations.sh"]
```

## Docker Setup

### Building the Docker Image

```bash
# Build with production environment file
docker-compose --env-file .env.production build

# Check the built images
docker images | grep twitter-scraper
```

### Starting the Services

```bash
# Start all services in detached mode
docker-compose --env-file .env.production up -d

# Check running containers
docker-compose ps

# Check container logs
docker-compose logs -f
```

### Verify Services Health

```bash
# Check API container logs
docker-compose logs -f twitter-api

# Check PostgreSQL container logs
docker-compose logs -f postgres

# Check Redis container logs
docker-compose logs -f redis

# API health check endpoint
curl http://localhost:3000/api/twitter/health
```

## Database Initialization

### Running Migrations Manually

If you didn't enable automatic migrations:

```bash
# Run migrations
docker-compose exec twitter-api npm run migrations:run

# Verify database tables
docker-compose exec postgres psql -U postgres -d twitter_scraper -c "\dt;"

# Check table schemas
docker-compose exec postgres psql -U postgres -d twitter_scraper -c "\d+ tweets;"
docker-compose exec postgres psql -U postgres -d twitter_scraper -c "\d+ users;"
docker-compose exec postgres psql -U postgres -d twitter_scraper -c "\d+ analytics;"
```

### Seeding Test Data (Optional)

If you need test data:

```bash
# Run a small scraping job
curl -X POST "http://localhost:3000/api/twitter/scrape" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "elonmusk",
    "options": {
      "maxTweets": 50
    }
  }'

# Check database content
docker-compose exec postgres psql -U postgres -d twitter_scraper -c "SELECT COUNT(*) FROM tweets;"
```

## API Functionality Testing

### Testing the Swagger Documentation

Access the Swagger UI in your browser:
```
http://localhost:3000/documentation
```

Verify that:
- All endpoints are documented
- Schema definitions are correct
- Example requests are provided

### Testing Core Endpoints

#### Health Check

```bash
curl http://localhost:3000/api/twitter/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2023-04-01T12:34:56.789Z",
  "services": {
    "database": "connected",
    "redis": "connected"
  }
}
```

#### Start Scraping Job

```bash
curl -X POST "http://localhost:3000/api/twitter/scrape" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "elonmusk",
    "options": {
      "maxTweets": 100,
      "tweetTypes": ["original", "replies"],
      "contentTypes": ["text", "images", "videos", "links"]
    }
  }'
```

Expected response:
```json
{
  "status": "queued",
  "jobId": "twitter-elonmusk-1234567890123",
  "message": "Started Twitter scraping job for @elonmusk"
}
```

#### Check Job Status

Use the job ID from the previous response:

```bash
curl http://localhost:3000/api/twitter/jobs/twitter-elonmusk-1234567890123
```

Expected response:
```json
{
  "id": "twitter-elonmusk-1234567890123",
  "state": "active",
  "data": {
    "username": "elonmusk",
    "operation": "scrape-twitter-user"
  },
  "createdAt": "2023-04-01T12:34:56.789Z",
  "progress": 45
}
```

#### List All Jobs

```bash
curl http://localhost:3000/api/twitter/jobs
```

#### Cancel a Job

```bash
curl -X DELETE "http://localhost:3000/api/twitter/jobs/twitter-elonmusk-1234567890123"
```

Expected response:
```json
{
  "status": "success",
  "message": "Job twitter-elonmusk-1234567890123 has been cancelled"
}
```

#### Process Scraped Tweets

```bash
curl -X POST "http://localhost:3000/api/twitter/process" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "elonmusk",
    "action": "generate-analytics"
  }'
```

#### Get User Analytics

```bash
curl http://localhost:3000/api/twitter/analytics/elonmusk
```

#### Get User Tweets

```bash
curl "http://localhost:3000/api/twitter/tweets/elonmusk?limit=10&offset=0&type=original&sortBy=postedAt&sortOrder=DESC"
```

## Performance Testing

### Basic Load Testing with wrk

```bash
# Install wrk if not already installed
# For macOS: brew install wrk
# For Ubuntu: apt-get install -y wrk

# Test the health endpoint
wrk -t2 -c10 -d30s http://localhost:3000/api/twitter/health

# Test jobs endpoint
wrk -t2 -c10 -d30s http://localhost:3000/api/twitter/jobs
```

### Monitoring Resource Usage

```bash
# Monitor container stats
docker stats

# Check memory usage
docker-compose exec twitter-api bash -c "free -m"

# Check disk usage
docker-compose exec twitter-api bash -c "df -h"
```

### Database Performance

```bash
# Check database size
docker-compose exec postgres psql -U postgres -d twitter_scraper -c "SELECT pg_size_pretty(pg_database_size('twitter_scraper'));"

# Check table sizes
docker-compose exec postgres psql -U postgres -d twitter_scraper -c "SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) FROM pg_catalog.pg_statio_user_tables ORDER BY pg_total_relation_size(relid) DESC;"
```

## Security Testing

### Verify SSL Configuration

If using SSL:

```bash
# Check if the connection is secure (requires curl with SSL support)
curl -v https://localhost:3000/api/twitter/health
```

### Check Redis Security

```bash
# Test Redis connection security
docker-compose exec redis redis-cli -h redis ping
```

### Check PostgreSQL Security

```bash
# Test PostgreSQL connection security
docker-compose exec postgres psql -U postgres -c "SELECT version();"
```

## Troubleshooting

### Database Connection Issues

If the API can't connect to the database:

```bash
# Check PostgreSQL is running
docker-compose ps postgres

# Check PostgreSQL logs
docker-compose logs postgres

# Verify database exists
docker-compose exec postgres psql -U postgres -c "SELECT datname FROM pg_database;"

# Check environment variables
docker-compose exec twitter-api env | grep DB_
```

### Redis Connection Issues

If the API can't connect to Redis:

```bash
# Check Redis is running
docker-compose ps redis

# Check Redis logs
docker-compose logs redis

# Test Redis connectivity
docker-compose exec redis redis-cli ping

# Check environment variables
docker-compose exec twitter-api env | grep REDIS_
```

### API Server Issues

```bash
# Check logs for errors
docker-compose logs twitter-api

# Check if server is listening on the expected port
docker-compose exec twitter-api bash -c "netstat -tulpn | grep node"

# Check if dependencies are installed
docker-compose exec twitter-api npm ls
```

### Data Persistence Issues

```bash
# Check volume mounts
docker-compose exec twitter-api bash -c "mount | grep /usr/src/app"

# Check if data directories exist and have correct permissions
docker-compose exec twitter-api bash -c "ls -la /usr/src/app/data /usr/src/app/backups"
```

## Production Checklist

Before deploying to actual production, ensure:

1. **Security**
   - [ ] Use strong, unique passwords for database and Redis
   - [ ] Configure proper firewalls and network security
   - [ ] Set up SSL/TLS for HTTPS
   - [ ] Implement API authentication if needed

2. **Configuration**
   - [ ] Update all environment variables for production
   - [ ] Enable proper logging levels
   - [ ] Configure appropriate scraping limits

3. **Persistence**
   - [ ] Configure volume persistence for data
   - [ ] Set up regular database backups
   - [ ] Configure backup rotation policy

4. **Monitoring**
   - [ ] Set up health checks
   - [ ] Configure resource alerts
   - [ ] Implement error notification system

5. **Scaling (if needed)**
   - [ ] Consider database connection pooling
   - [ ] Adjust worker concurrency settings
   - [ ] Configure proper resource limits

## Additional Resources

- [Docker Documentation](https://docs.docker.com/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Redis Documentation](https://redis.io/documentation)
- [BullMQ Documentation](https://docs.bullmq.io/)
- [TypeORM Documentation](https://typeorm.io/) 
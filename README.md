# Degen Scraper

Pipeline for generating AI character files and training datasets by scraping public figures' online presence across Twitter and blogs.

> ⚠️ **IMPORTANT**: Create a new Twitter account for this tool. DO NOT use your main account as it may trigger Twitter's automation detection and result in account restrictions.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy the `.env.example` into a `.env` file:
   ```properties
   # (Required) Twitter Authentication
   TWITTER_USERNAME=     # your twitter username
   TWITTER_PASSWORD=     # your twitter password

   # (Optional) Blog Configuration
   BLOG_URLS_FILE=      # path to file containing blog URLs

   # (Optional) Scraping Configuration
   MAX_TWEETS=          # max tweets to scrape
   MAX_RETRIES=         # max retries for scraping
   RETRY_DELAY=         # delay between retries
   MIN_DELAY=           # minimum delay between requests
   MAX_DELAY=           # maximum delay between requests
   ```

## Usage

### Twitter Collection with Database Storage
```bash
npm run twitter:db [username]
```
Example: `npm run twitter:db elonmusk`

This will scrape tweets and store them directly in the PostgreSQL database configured in your `.env` file.

#### Providing Twitter Credentials

Twitter credentials can be provided in three ways:

1. **Environment Variables (Default)**
   ```
   TWITTER_USERNAME=your_username
   TWITTER_PASSWORD=your_password
   TWITTER_EMAIL=your_email
   ```

2. **Command Line Arguments**
   ```bash
   npm run twitter:db elonmusk --credentials.username=alternate_account --credentials.password=your_password --credentials.email=your_email
   ```

3. **API Requests** (when using the REST API)
   ```json
   {
     "username": "elonmusk",
     "options": {
       "credentials": {
         "username": "alternate_account",
         "password": "your_password",
         "email": "your_email"
       }
     }
   }
   ```

This flexibility allows you to use different Twitter accounts for different scraping operations without changing the `.env` file. The environment variables are used as defaults when credentials are not explicitly provided.

### Logging System

The application includes a comprehensive logging system that writes logs to both the console and files. This makes it easier to debug issues and monitor the application's behavior.

#### Log Files

Logs are written to the `logs` directory (configurable via `LOG_DIR` environment variable) with the following structure:

- **{date}-info.log**: Contains all info-level messages
- **{date}-error.log**: Contains error messages
- **{date}-debug.log**: Contains debug and trace messages
- **{date}-combined.log**: Contains all messages from all levels
- **{date}-pipeline-*.log**: Pipeline-specific logs (from the Twitter scraper)

#### Log Configuration

You can configure logging behavior using these environment variables:

- `LOG_LEVEL`: Sets the minimum level of logs to display (trace, debug, info, warn, error, fatal)
- `LOG_DIR`: Directory to store log files (default: `logs`)
- `LOG_TO_FILE`: Enable/disable file logging (default: `true`)
- `DEBUG`: Enable debug output in the console (default: `false`)

#### TypeORM Database Logging

The TypeORM logging is configured to be less verbose by default, showing only:
- Errors and warnings
- Schema operations
- Migration operations
- Slow queries (taking more than 1 second)

This prevents your logs from being flooded with SQL statements while still providing the important information you need for debugging.

### Legacy Twitter Collection (deprecated)
```bash
npm run twitter -- username
```
Example: `npm run twitter -- pmarca`

> **Note**: This method stores tweets only in the file system. Consider using the database storage method instead.

### Blog Collection
```bash
npm run blog
```

### Generate Character
```bash
npm run character -- username
```
Example: `npm run character -- pmarca`

### Finetune
```bash
npm run finetune
```

### Finetune (with test)
```bash
npm run finetune:test
```

### Generate Virtuals Character Card
https://whitepaper.virtuals.io/developer-documents/agent-contribution/contribute-to-cognitive-core#character-card-and-goal-samples

Run this after Twitter Collection step 
```bash
npm run generate-virtuals -- username date 
```

Example: `npm run generate-virtuals -- pmarca 2024-11-29`
Example without date: `npm run generate-virtuals -- pmarca`

The generated character file will be in the `pipeline/[username]/[date]/character/character.json` directory.
The generated tweet dataset file will be in `pipeline/[username]/[date]/raw/tweets.json`.

# Twitter Scraper Microservice API

A RESTful microservice API built with Fastify that exposes the core Twitter scraping functionality from the original terminal application. The application stores all scraped data in PostgreSQL using TypeORM.

## Features

- **Twitter API**: Endpoints for scraping and processing Twitter data
- **PostgreSQL Database**: Persistent storage of tweets and analytics
- **TypeORM**: ORM for database access and migrations
- **Job Queue**: Background processing with BullMQ and Redis
- **Asynchronous Processing**: Non-blocking API for handling long-running tasks
- **Job Management**: Monitor, track, and cancel jobs
- **Database Management**: Automatic backup and maintenance scripts

## Requirements

- Node.js (>= 16.x)
- PostgreSQL (>= 12.x)
- Redis (>= 6.x)
- Twitter account credentials

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/alt-research/twitter-scraper-finetune.git
   cd twitter-scraper-finetune
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file:
   ```bash
   cp .env.example .env
   ```
   
4. Edit the `.env` file with your configuration values.

## Local Development

For local development, you can easily set up PostgreSQL and Redis using Docker with our convenience scripts:

```bash
# One-command setup (starts Docker services)
npm run dev:setup
# You'll be prompted if you want to run migrations

# Run migrations explicitly when needed
npm run migrations:run

# Start the development server
npm run dev
```

Or manually:

```bash
# Just start the Docker services
npm run dev:services

# Initialize the database (when needed, not automatically)
npm run migrations:run

# Start the development server
npm run dev
```

To stop the Docker services when you're done:

```bash
npm run dev:services:stop
```

For detailed instructions on local development, see the [Local Development Guide](docs/LOCAL_DEVELOPMENT.md).

## Database Setup

### Local Development

1. Create a PostgreSQL database:
   ```bash
   createdb twitter_scraper
   ```

2. Run database migrations:
   ```bash
   npm run migrations:run
   ```

### Using Docker

The included Docker Compose configuration sets up PostgreSQL automatically:

```bash
docker-compose up -d postgres
```

Then run migrations separately:

```bash
docker-compose exec twitter-api npm run migrations:run
```

## Database Management

The project includes comprehensive scripts for database management:

### Backup and Restore

```bash
# Create a backup
./scripts/backup-db.sh

# Restore from a backup
./scripts/restore-db.sh ./backups/twitter_scraper_backup_20240320_123456.sql.gz

# Set up scheduled backups
./scripts/scheduled-backups.sh
```

### Maintenance

```bash
# Run database maintenance
./scripts/db-maintenance.sh
```

For detailed information about database management, refer to the [Database Documentation](docs/DATABASE.md).

## Starting the Server

Development mode with auto-reload:
```bash
# Start server only
npm run dev

# Start server with migrations run first
npm run dev:with-migrations
```

Production mode:
```bash
# Start server only
npm start

# Start server with migrations run first
npm run start:with-migrations
```

Docker Compose (all services):
```bash
# Default: Start without running migrations
docker-compose up -d

# To start with migrations, modify the docker-compose.yml command:
# command: ["/usr/src/app/entrypoint-with-migrations.sh"]
```

## Environment Configuration

### Database SSL Configuration

The application supports configuring PostgreSQL SSL connections through environment variables:

- `NODE_ENV`: Determines the default SSL behavior
  - `development`: SSL is disabled by default
  - `production`: SSL is enabled by default with `{ rejectUnauthorized: false }`

- `POSTGRES_SSL`: Can be used to override the default SSL behavior
  - Set to `false` for environments where PostgreSQL doesn't support SSL (like Docker)
  - Leave unset to use the environment-based defaults

Example in `.env` for a development environment without SSL:
```
NODE_ENV=development
POSTGRES_SSL=
```

Example in `docker-compose.yml` for a production Docker environment:
```yaml
environment:
  - NODE_ENV=production
  - POSTGRES_SSL=false  # Disable SSL for Docker PostgreSQL
```

## API Endpoints

### API Documentation

The API includes interactive documentation powered by Swagger. You can access the documentation UI at:

```
http://localhost:3000/documentation
```

The documentation provides:
- Interactive endpoints that you can try directly from the browser
- Schema information for all requests and responses
- Examples for each endpoint
- API information and descriptions

### Health Check
```
GET /api/twitter/health
```

### Twitter Scraping

Start a new scraping job:
```
POST /api/twitter/scrape
```
Request body:
```json
{
  "username": "elonmusk",
  "options": {
    "maxTweets": 10000,
    "tweetTypes": ["original", "replies"],
    "contentTypes": ["text", "images", "videos", "links"],
    "credentials": {
      "username": "your_twitter_username",
      "password": "your_twitter_password",
      "email": "your_twitter_email"
    }
  }
}
```

Process scraped tweets:
```
POST /api/twitter/process
```
Request body:
```json
{
  "username": "elonmusk",
  "action": "generate-analytics"
}
```

Get tweets with pagination and filtering:
```
GET /api/twitter/tweets/elonmusk?limit=20&offset=0&type=original&sortBy=postedAt&sortOrder=DESC
```

Get analytics for a user:
```
GET /api/twitter/analytics/elonmusk
```

### Job Management

List all jobs:
```
GET /api/twitter/jobs
```

Get job details:
```
GET /api/twitter/jobs/:id
```

Cancel a job:
```
DELETE /api/twitter/jobs/:id
```

## Database Schema

The application uses TypeORM entities to define the database schema:

### Users Table
Stores Twitter user information:
- Basic profile information (username, display name, bio, etc.)
- Follower/following counts
- Verification status
- Account creation date

### Tweets Table
Stores individual tweets with:
- Tweet content and metadata
- Type of tweet (original, reply, retweet, quote)
- Engagement metrics (likes, retweets, etc.)
- Reply, retweet, and quote relationships
- Media attachments and entities
- Timestamps
- Original tweet JSON

### Analytics Table
Stores computed analytics for each user:
- Tweet count by type
- Engagement metrics
- Content analysis
- Posting patterns
- Most used hashtags
- Most mentioned users
- Temporal analysis

## Using as a Microservice

This API is designed to be used as part of a microservice architecture. You can deploy it independently and have other services communicate with it via HTTP.

Example Docker Compose setup (included in the repo):

```yaml
version: '3.8'

services:
  twitter-api:
    build: .
    ports:
      - "3000:3000"
    environment:
      - DB_HOST=postgres
      - REDIS_HOST=redis
      - TWITTER_USERNAME=your_username
      - TWITTER_PASSWORD=your_password
    depends_on:
      - redis
      - postgres

  redis:
    image: redis:alpine
    volumes:
      - redis-data:/data

  postgres:
    image: postgres:14-alpine
    environment:
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=postgres
      - POSTGRES_DB=twitter_scraper
    volumes:
      - postgres-data:/var/lib/postgresql/data

volumes:
  redis-data:
  postgres-data:
```

## Production Deployment with Docker

For production deployments, this project includes a Docker setup that's ready to use.

### Production Docker Setup

1. Build the Docker image:
   ```bash
   docker-compose build
   ```

2. Start all services (API, Redis, PostgreSQL):
   ```bash
   docker-compose up -d
   ```

3. Run with migrations (alternative):
   
   Edit `docker-compose.yml` to uncomment the command line for the twitter-api service:
   ```

# Twitter Scraper

## Environment Variables

The Twitter scraper can be configured using the following environment variables:

### Twitter Credentials
- `TWITTER_USERNAME`: Your Twitter username
- `TWITTER_PASSWORD`: Your Twitter password
- `TWITTER_EMAIL`: Your Twitter email address

### Twitter Scraper Settings
- `MAX_TWEETS`: Maximum number of tweets to collect per user (default: 50000)
- `MAX_RETRIES`: Maximum number of retries for failed requests (default: 5)
- `RETRY_DELAY`: Base delay between retries in milliseconds (default: 5000)
- `MIN_DELAY`: Minimum delay between requests in milliseconds (default: 1000)
- `MAX_DELAY`: Maximum delay between requests in milliseconds (default: 3000)
- `RATE_LIMIT_THRESHOLD`: Number of rate limits before switching to fallback collection (default: 3)

### Timeout Settings
- `COLLECTION_GLOBAL_TIMEOUT`: Global timeout for the entire collection process in milliseconds (default: 120000 - 2 minutes)
- `COLLECTION_STALL_TIMEOUT`: Time without progress before marking collection as stalled in milliseconds (default: 15000)
- `COLLECTION_PROGRESS_CHECK`: How often to check collection progress in milliseconds (default: 2000)
- `JOB_STALL_TIMEOUT`: Time without progress in a job before marking as stalled in milliseconds (default: 45000)
- `JOB_PROGRESS_CHECK`: How often to check job progress in milliseconds (default: 5000)
- `FORCED_BREAK_TIMEOUT`: Maximum time to wait for breaking out of a stalled collection loop in milliseconds (default: 120000 - 2 minutes)

### Rate Limit Settings
- `RATE_LIMIT_BASE_DELAY`: Base delay for rate limit backoff in milliseconds (default: 60000)
- `RATE_LIMIT_MAX_DELAY`: Maximum delay for rate limit backoff in milliseconds (default: 900000)
- `RATE_LIMIT_DURATION`: How long to mark a user as rate limited in milliseconds (default: 900000)
- `RATE_LIMIT_KEY_EXPIRY`: Redis key expiry for rate limit flags in seconds (default: 900)

### Redis Key Settings
- `NON_RETRIABLE_KEY_EXPIRY`: Redis key expiry for non-retriable flags in seconds (default: 86400)
- `PROGRESS_KEY_EXPIRY`: Redis key expiry for progress tracking in seconds (default: 3600)

Copy the `.env.example` file to `.env` and customize the settings as needed for your environment.

## Robust Error Handling

The Twitter scraper includes advanced error handling for various scenarios:

### Authentication Failures
- Failed Twitter authentication is detected early and jobs are marked as non-retriable
- Detailed error messages show why authentication failed
- Authentication failures are properly communicated to users through the API

### Rate Limit Detection
- The system detects when Twitter rate limits are encountered
- Rate-limited accounts are tracked in Redis to prevent repeated failures
- Jobs for rate-limited accounts are marked as non-retriable for a configurable duration
- Detailed logs indicate when rate limiting occurs

### Stall Detection
- The collector detects when tweet collection is stalled (no new tweets collected)
- After a configurable timeout, stalled collections are gracefully terminated
- If partial results were collected, they are saved rather than discarded
- Redis tracks collection progress to detect stalls even during long operations

### Force Termination
- Collections that stall excessively can be force-terminated
- The system includes a safety mechanism to prevent permanently stuck collections
- Force-terminated jobs are properly marked as failed in the job queue
- Resources are properly cleaned up after force terminations

### Job Queue Management
- Failed jobs are properly tracked and can be managed through the API
- Jobs with unrecoverable errors are marked as non-retriable to prevent wasting resources
- Structured error responses provide detailed information about failure causes
- The system tracks active pipelines to ensure proper termination

These error handling mechanisms ensure your Twitter scraper is robust and recovers gracefully from failures without crashing the server or requiring manual intervention. 
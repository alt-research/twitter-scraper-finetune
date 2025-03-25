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
   ```yaml
   # Use the entrypoint script with migrations
   command: ["/usr/src/app/entrypoint-with-migrations.sh"]
   ```

### Quick Testing in Production-Like Environment

To quickly test in a production-like environment, use our convenient setup script:

```bash
./scripts/production-test-setup.sh
```

For more details on testing in production, see the [Testing Production Setup with Docker](#testing-production-setup-with-docker) section below.

## Testing Production Setup with Docker

This section provides detailed instructions for testing your Twitter Scraper API in a production-like environment using Docker.

### Using the Automated Setup Script

For the quickest setup, you can use our automated script:

```bash
# Make the script executable first if needed
chmod +x scripts/production-test-setup.sh

# Run the setup script
./scripts/production-test-setup.sh
```

This script will:
1. Create a `.env.production` file if it doesn't exist
2. Build the Docker images with production settings
3. Start all required services
4. Verify service health
5. Offer to run database migrations
6. Test the API health endpoint
7. Provide next steps for testing

### Manual Setup

If you prefer to set up the test environment manually, follow these steps:

### Prerequisites

- Docker and Docker Compose installed
- Git repository cloned
- Twitter account credentials available

### Step 1: Prepare Environment Variables

1. Create a production environment file:
   ```bash
   cp .env.example .env.production
   ```

2. Configure the production environment variables:
   ```
   # API Configuration
   PORT=3000
   HOST=0.0.0.0
   NODE_ENV=production
   
   # Database Configuration - Docker services use these names
   DB_HOST=postgres
   DB_PORT=5432
   DB_USERNAME=postgres
   DB_PASSWORD=postgres  # Use a strong password in real production
   DB_DATABASE=twitter_scraper
   POSTGRES_SSL=false    # Disable SSL for Docker PostgreSQL
   
   # Redis Configuration - Docker service name
   REDIS_HOST=redis
   REDIS_PORT=6379
   REDIS_PASSWORD=       # Set a password if needed
   
   # Twitter Credentials
   TWITTER_USERNAME=your_twitter_username
   TWITTER_PASSWORD=your_twitter_password
   TWITTER_EMAIL=your_twitter_email
   
   # Twitter Scraper Configuration
   MAX_TWEETS=1000       # Lower for testing
   MAX_RETRIES=3
   RETRY_DELAY=5000
   MIN_DELAY=1000
   MAX_DELAY=3000
   
   # Debug
   DEBUG=false
   ```

### Step 2: Build and Start Services

1. Build the Docker images:
   ```bash
   docker-compose --env-file .env.production build
   ```

2. Start the services:
   ```bash
   docker-compose --env-file .env.production up -d
   ```

3. Check the services status:
   ```bash
   docker-compose ps
   ```

### Step 3: Run Database Migrations

1. Run migrations manually:
   ```bash
   docker-compose exec twitter-api npm run migrations:run
   ```

   Alternatively, you can enable automatic migrations by modifying `docker-compose.yml` before starting:
   ```yaml
   command: ["/usr/src/app/entrypoint-with-migrations.sh"]
   ```

2. Verify the database setup:
   ```bash
   docker-compose exec postgres psql -U postgres -d twitter_scraper -c "\dt;"
   ```

### Step 4: Test API Functionality

1. Check API health:
   ```bash
   curl http://localhost:3000/api/twitter/health
   ```

2. Access Swagger documentation:
   ```
   http://localhost:3000/documentation
   ```

3. Start a test scraping job:
   ```bash
   curl -X POST "http://localhost:3000/api/twitter/scrape" \
     -H "Content-Type: application/json" \
     -d '{
       "username": "elonmusk",
       "options": {
         "maxTweets": 100,
         "tweetTypes": ["original"],
         "contentTypes": ["text"]
       }
     }'
   ```

4. Check job status:
   ```bash
   curl http://localhost:3000/api/twitter/jobs
   ```

5. Retrieve job details by ID (use the ID from the previous response):
   ```bash
   curl http://localhost:3000/api/twitter/jobs/twitter-elonmusk-1234567890123
   ```

### Step 5: Monitor Logs and Performance

1. Check API logs:
   ```bash
   docker-compose logs -f twitter-api
   ```

2. Monitor PostgreSQL logs:
   ```bash
   docker-compose logs -f postgres
   ```

3. Monitor Redis logs:
   ```bash
   docker-compose logs -f redis
   ```

4. Check container resource usage:
   ```bash
   docker stats
   ```

### Step 6: Test Database Backup and Restore

1. Create a database backup:
   ```bash
   docker-compose exec twitter-api ./scripts/backup-db.sh
   ```

2. List available backups:
   ```bash
   docker-compose exec twitter-api ls -la /usr/src/app/backups
   ```

3. Test restore (if needed - careful, this will overwrite your database):
   ```bash
   docker-compose exec twitter-api ./scripts/restore-db.sh /usr/src/app/backups/twitter_scraper_backup_DATE.sql.gz
   ```

### Step 7: Test for Production Readiness

1. Test API response under load (using [wrk](https://github.com/wg/wrk)):
   ```bash
   wrk -t2 -c10 -d30s http://localhost:3000/api/twitter/health
   ```

2. Verify persistence after restart:
   ```bash
   docker-compose down
   docker-compose --env-file .env.production up -d
   curl http://localhost:3000/api/twitter/jobs  # Should show previous jobs
   ```

3. Test graceful shutdown:
   ```bash
   docker-compose down -t 30  # Give containers 30 seconds to shutdown
   ```

### Common Issues & Troubleshooting

1. **Database Connection Issues**
   - Verify PostgreSQL is running: `docker-compose ps postgres`
   - Check connection variables: `DB_HOST`, `DB_PORT`, etc.
   - Check logs: `docker-compose logs postgres`

2. **Redis Connection Issues**
   - Verify Redis is running: `docker-compose ps redis`
   - Check connection variables: `REDIS_HOST`, `REDIS_PORT`
   - Check logs: `docker-compose logs redis`

3. **API Not Starting**
   - Check logs for errors: `docker-compose logs twitter-api`
   - Verify dependencies are available
   - Check if migrations ran successfully

4. **"No such file or directory" errors**
   - Ensure volume mappings are correct in `docker-compose.yml`
   - Verify required directories exist in the container

5. **Tweet Scraping Failures**
   - Check Twitter credentials
   - Verify network connectivity
   - Check for rate limiting in logs
   - Try with a smaller `maxTweets` value

### Cleanup

When you're done testing, clean up all resources:

```bash
# Stop and remove containers
docker-compose down

# Remove volumes (optional, will delete all data)
docker-compose down -v

# Remove unused images
docker image prune -a
```

For even more detailed instructions on testing the production environment, including performance testing, security considerations, and a production-ready checklist, please refer to the [Production Testing Guide](docs/PRODUCTION_TESTING.md).
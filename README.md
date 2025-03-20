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

### Twitter Collection
```bash
npm run twitter -- username
```
Example: `npm run twitter -- pmarca`

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
# One-command setup (starts Docker services and runs migrations)
npm run dev:setup

# Start the development server after setup
npm run dev
```

Or manually:

```bash
# Just start the Docker services
npm run dev:services

# Initialize the database
npm run init-db

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
   npm run init-db
   ```

### Using Docker

The included Docker Compose configuration sets up PostgreSQL automatically:

```bash
docker-compose up -d postgres
```

Then run migrations:

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
npm run dev
```

Production mode:
```bash
npm start
```

Docker Compose (all services):
```bash
docker-compose up -d
```

## API Endpoints

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
    "contentTypes": ["text", "images", "videos", "links"]
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

## Production Deployment

For production deployments:

1. Set secure passwords in your `.env` file or environment variables
2. Configure proper PostgreSQL credentials
3. Consider using a managed PostgreSQL service 
4. Set up proper backups for your database
5. Use environment-specific configuration
6. Set up scheduled database maintenance with cron

## Documentation

- [Local Development](docs/LOCAL_DEVELOPMENT.md) - Instructions for setting up a local development environment
- [Database Management](docs/DATABASE.md) - Detailed information about database setup, backups, and maintenance

## License

MIT
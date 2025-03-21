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
   # (Optional) Twitter Authentication
   TWITTER_USERNAME=     # your twitter username (optional)
   TWITTER_PASSWORD=     # your twitter password (optional)
   TWITTER_EMAIL=        # your twitter email (optional)

   # (Required) Database Connection
   DB_URL=         # PostgreSQL connection URL

   # (Optional) Blog Configuration
   BLOG_URLS_FILE=      # path to file containing blog URLs

   # (Optional) Scraping Configuration
   MAX_TWEETS=          # max tweets to scrape
   MAX_RETRIES=         # max retries for scraping
   RETRY_DELAY=         # delay between retries
   MIN_DELAY=           # minimum delay between requests
   MAX_DELAY=           # maximum delay between requests
   ```

   Note: Twitter credentials can now be provided either via environment variables or directly through API parameters.

## Usage

### Twitter Collection with Database Storage
```bash
npm run twitter:db [username]
```
Example: `npm run twitter:db elonmusk`

You can also provide Twitter credentials directly:
```bash
npm run twitter:db elonmusk --twitter-username user1 --twitter-password pass123 --twitter-email user@example.com
```

This will scrape tweets and store them directly in the PostgreSQL database configured in your `.env` file.

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
- **Flexible Authentication**: Support for providing Twitter credentials through API parameters

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

# Run database logs maintenance (rotate and clean old logs)
./scripts/db-logs-maintenance.sh
# Or use npm script
npm run db:logs-maintenance
```

### Database Error Logging

The system includes a robust logging system for database errors:

- Database errors are logged to the `db_logs` directory (which is ignored by Git)
- Logs include detailed context about the error, including timestamps and SQL
- Different log levels are supported: ERROR, WARN, INFO, DEBUG
- Automatic log rotation prevents log files from growing too large
- Maintenance script for managing log files: `npm run db:logs-maintenance`

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
# command: ["/usr/src/app/docker-entrypoint-with-migrations.sh"]
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
  },
  "credentials": {
    "twitterUsername": "your_twitter_username",
    "twitterPassword": "your_twitter_password",
    "twitterEmail": "your_twitter_email"
  }
}
```

Notes:
- The `credentials` object is optional. If not provided, the system will use the credentials from environment variables
- This allows using different Twitter accounts for different scraping jobs without changing environment variables

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

## Database Integration

This project now uses PostgreSQL as its primary data store. All Twitter data scraped with the `twitter:db` command is stored directly in the database, making it immediately available to the API.

### Running with Database Integration

To use the database integration:

1. Make sure your PostgreSQL database is set up and running (see PostgreSQL Setup section)
2. Ensure your `.env` file includes the `DB_URL` variable pointing to your database
3. Run the Twitter scraper with database integration:

```bash
# Run with interactive prompts
npm run twitter:db

# Or specify a username directly
npm run twitter:db elonmusk
```

The script will:
- Scrape tweets from the specified account
- Store user data, tweets, and analytics in the database
- Generate analytics for the user's tweets

### Database Schema Integration

The scraper integrates with the following database tables:

- **users**: Stores information about Twitter users
- **tweets**: Stores all collected tweets with their metadata
- **analytics**: Stores computed analytics for each user

### API Access

Once data is stored in the database, you can access it through the API:

```bash
# Start the API server
npm run dev

# Access data through endpoints like:
# - GET /api/twitter/users/:username
# - GET /api/twitter/tweets/:username
# - GET /api/twitter/analytics/:username
```

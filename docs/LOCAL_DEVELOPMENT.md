# Local Development Setup

This guide explains how to set up the Twitter Scraper API for local development using Docker for PostgreSQL and Redis services.

## Prerequisites

Before you begin, ensure you have the following installed:

- [Node.js](https://nodejs.org/) (>= 16.x)
- [Docker](https://www.docker.com/get-started) and Docker Compose
- Git

## Setup Steps

### 1. Clone the Repository

```bash
git clone https://github.com/alt-research/twitter-scraper-finetune.git
cd twitter-scraper-finetune
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Create a `.env` file by copying the example:

```bash
cp .env.example .env
```

Then edit the `.env` file to include your specific configuration. For local Docker development, your database and Redis settings should look like this:

```
# API Configuration
PORT=3000
HOST=0.0.0.0
NODE_ENV=development

# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_DATABASE=twitter_scraper

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Twitter Credentials
TWITTER_USERNAME=your_twitter_username
TWITTER_PASSWORD=your_twitter_password
```

### 4. Start Docker Containers

We'll use Docker Compose to run just the PostgreSQL and Redis services while running the API itself directly on your host machine for easier development.

Create a `docker-compose.dev.yml` file with the following content:

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:14-alpine
    environment:
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=postgres
      - POSTGRES_DB=twitter_scraper
    ports:
      - "5432:5432"
    volumes:
      - postgres-dev-data:/var/lib/postgresql/data
    restart: unless-stopped

  redis:
    image: redis:alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-dev-data:/data
    restart: unless-stopped
    command: redis-server --appendonly yes

volumes:
  postgres-dev-data:
  redis-dev-data:
```

Start the services:

```bash
docker-compose -f docker-compose.dev.yml up -d
```

This will start PostgreSQL and Redis in the background, accessible from your host machine.

### 5. Initialize the Database

Run the database migrations to create all tables and indices:

```bash
npm run init-db
```

### 6. Start the API in Development Mode

```bash
npm run dev
```

The server will start with auto-reload enabled, listening on the port specified in your `.env` file (default is 3000).

## Verifying Your Setup

### 1. Check if services are running

```bash
docker-compose -f docker-compose.dev.yml ps
```

You should see both postgres and redis services listed as "Up".

### 2. Test the API

Make a request to the health endpoint:

```bash
curl http://localhost:3000/api/twitter/health
```

The response should be:

```json
{
  "status": "ok",
  "service": "twitter-api"
}
```

## Working with PostgreSQL

### Connect to the PostgreSQL Database

```bash
docker exec -it twitter-scraper-finetune_postgres_1 psql -U postgres -d twitter_scraper
```

### Common PostgreSQL Commands

Once connected:

- List tables: `\dt`
- View table structure: `\d+ table_name`
- Run a query: `SELECT * FROM users LIMIT 5;`
- Exit: `\q`

## Working with Redis

### Connect to Redis CLI

```bash
docker exec -it twitter-scraper-finetune_redis_1 redis-cli
```

### Common Redis Commands

Once connected:

- View all keys: `KEYS *`
- Get value: `GET key_name`
- View queue information: `LLEN bull:twitter-scraper:wait`
- Exit: `exit`

## Development Workflow

1. Make changes to the code
2. The server will automatically reload thanks to nodemon
3. Test your changes through the API endpoints

## Database Management During Development

### Run Database Maintenance

```bash
npm run db:maintenance
```

### Create a Backup

```bash
npm run db:backup
```

### Restore from a Backup

```bash
npm run db:restore ./backups/your_backup_file.sql.gz
```

## Stopping the Development Environment

To stop the Docker services:

```bash
docker-compose -f docker-compose.dev.yml down
```

To stop and remove volumes (will delete all data):

```bash
docker-compose -f docker-compose.dev.yml down -v
```

## Troubleshooting

### Cannot Connect to PostgreSQL

- Check if the container is running: `docker ps`
- Verify PostgreSQL logs: `docker logs twitter-scraper-finetune_postgres_1`
- Try connecting with different credentials: `docker exec -it twitter-scraper-finetune_postgres_1 psql -U postgres`

### Cannot Connect to Redis

- Check if the container is running: `docker ps`
- Verify Redis logs: `docker logs twitter-scraper-finetune_redis_1`
- Try pinging Redis: `docker exec -it twitter-scraper-finetune_redis_1 redis-cli ping`

### Database Migration Errors

If you encounter errors running migrations:

1. Check the connection settings in `.env`
2. Verify the database exists: `docker exec -it twitter-scraper-finetune_postgres_1 psql -U postgres -c "SELECT datname FROM pg_database;"`
3. Try recreating the database:
   ```bash
   docker exec -it twitter-scraper-finetune_postgres_1 psql -U postgres -c "DROP DATABASE twitter_scraper;"
   docker exec -it twitter-scraper-finetune_postgres_1 psql -U postgres -c "CREATE DATABASE twitter_scraper;"
   ```
   Then run migrations again. 
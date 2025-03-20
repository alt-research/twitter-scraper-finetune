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

A RESTful microservice API built with Fastify that exposes the core Twitter scraping functionality from the original terminal application.

## Features

- **Twitter API**: Endpoints for scraping and processing Twitter data
- **Job Queue**: Background processing with BullMQ and Redis
- **Asynchronous Processing**: Non-blocking API for handling long-running tasks
- **Job Management**: Monitor, track, and cancel jobs

## Requirements

- Node.js (>= 16.x)
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

## Starting the Server

Development mode with auto-reload:
```bash
npm run dev
```

Production mode:
```bash
npm start
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

## Using as a Microservice

This API is designed to be used as part of a microservice architecture. You can deploy it independently and have other services communicate with it via HTTP.

Example Docker Compose setup:

```yaml
version: '3.8'

services:
  twitter-api:
    build: .
    ports:
      - "3000:3000"
    environment:
      - REDIS_HOST=redis
      - TWITTER_USERNAME=your_username
      - TWITTER_PASSWORD=your_password
    depends_on:
      - redis

  redis:
    image: redis:alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data

volumes:
  redis-data:
```

## License

MIT
#!/bin/bash

# Set NODE_ENV explicitly
export NODE_ENV=production

# Wait for PostgreSQL
while ! pg_isready -h ${DB_HOST:-postgres} -p ${DB_PORT:-5432} -U ${DB_USERNAME:-postgres}; do
  echo "Waiting for PostgreSQL to be ready..."
  sleep 2
done

# Wait for Redis
MAX_RETRIES=30
RETRIES=0

echo "Waiting for Redis at ${REDIS_HOST:-redis}:${REDIS_PORT:-6379}..."
until [ $RETRIES -ge $MAX_RETRIES ] || redis-cli -h ${REDIS_HOST:-redis} -p ${REDIS_PORT:-6379} ping 2>/dev/null | grep -q "PONG"; do
  echo "Redis not available yet, retrying..."
  RETRIES=$((RETRIES+1))
  sleep 2
done

if [ $RETRIES -ge $MAX_RETRIES ]; then
  echo "Failed to connect to Redis after $MAX_RETRIES attempts"
  exit 1
fi

echo "All dependencies are ready, running migrations..."

# Run migrations
echo "NODE_ENV is set to: $NODE_ENV"
NODE_ENV=production npm run migrations:run

# Check if migrations were successful
if [ $? -ne 0 ]; then
  echo "Migrations failed!"
  exit 1
fi

echo "Migrations completed successfully, starting application..."

# Start the application
exec npm start 
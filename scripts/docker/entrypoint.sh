#!/bin/bash

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

echo "All dependencies are ready, starting application..."

# Start the application
exec npm start 
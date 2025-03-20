#!/bin/bash
# Setup script for local development using Docker

# Check for Docker
if ! command -v docker &> /dev/null; then
    echo "Error: Docker is not installed or not in PATH"
    echo "Please install Docker before continuing: https://docs.docker.com/get-docker/"
    exit 1
fi

# Check for Docker Compose
if ! command -v docker-compose &> /dev/null; then
    echo "Error: Docker Compose is not installed or not in PATH"
    echo "Please install Docker Compose before continuing: https://docs.docker.com/compose/install/"
    exit 1
fi

echo "Setting up local development environment..."

# Check if .env file exists, create from example if not
if [ ! -f .env ]; then
    echo "Creating .env file from example..."
    cp .env.example .env
    echo "Please edit .env file with your configuration values!"
fi

# Start Docker services
echo "Starting PostgreSQL and Redis with Docker..."
docker-compose -f docker-compose.dev.yml up -d

# Wait for services to be ready
echo "Waiting for services to be ready..."
sleep 5

# Check if PostgreSQL is ready
MAX_RETRIES=10
RETRY_COUNT=0

while ! docker-compose -f docker-compose.dev.yml exec -T postgres pg_isready -U postgres > /dev/null 2>&1; do
    RETRY_COUNT=$((RETRY_COUNT+1))
    if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
        echo "Error: PostgreSQL service did not become ready in time"
        echo "Try running 'docker-compose -f docker-compose.dev.yml logs postgres' to see what went wrong"
        exit 1
    fi
    echo "Waiting for PostgreSQL to be ready... ($RETRY_COUNT/$MAX_RETRIES)"
    sleep 3
done

echo "PostgreSQL is ready!"

# Check if Redis is ready
RETRY_COUNT=0

while ! docker-compose -f docker-compose.dev.yml exec -T redis redis-cli ping > /dev/null 2>&1; do
    RETRY_COUNT=$((RETRY_COUNT+1))
    if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
        echo "Error: Redis service did not become ready in time"
        echo "Try running 'docker-compose -f docker-compose.dev.yml logs redis' to see what went wrong"
        exit 1
    fi
    echo "Waiting for Redis to be ready... ($RETRY_COUNT/$MAX_RETRIES)"
    sleep 2
done

echo "Redis is ready!"

# Initialize the database
echo "Initializing the database..."
npm run init-db

echo "✅ Development environment is set up and ready!"
echo ""
echo "You can now start the development server with:"
echo "  npm run dev"
echo ""
echo "To stop the Docker services when done:"
echo "  docker-compose -f docker-compose.dev.yml down"
echo ""
echo "For more information, see docs/LOCAL_DEVELOPMENT.md" 
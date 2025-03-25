#!/bin/bash
# Production Test Setup Script
# This script sets up a production-like environment for testing

set -e  # Exit on error

# Create a colorized output function
function echo_color() {
  local color="$1"
  local message="$2"
  if [ "$color" == "green" ]; then
    echo -e "\033[0;32m${message}\033[0m"
  elif [ "$color" == "blue" ]; then
    echo -e "\033[0;34m${message}\033[0m"
  elif [ "$color" == "yellow" ]; then
    echo -e "\033[0;33m${message}\033[0m"
  elif [ "$color" == "red" ]; then
    echo -e "\033[0;31m${message}\033[0m"
  fi
}

# Check Docker and Docker Compose installation
if ! command -v docker &> /dev/null; then
  echo_color "red" "❌ Error: Docker is not installed or not in PATH"
  echo_color "yellow" "Please install Docker before continuing: https://docs.docker.com/get-docker/"
  exit 1
fi

if ! command -v docker-compose &> /dev/null; then
  echo_color "red" "❌ Error: Docker Compose is not installed or not in PATH"
  echo_color "yellow" "Please install Docker Compose before continuing: https://docs.docker.com/compose/install/"
  exit 1
fi

echo_color "blue" "========================="
echo_color "blue" "🐦 Production Test Setup"
echo_color "blue" "========================="
echo
echo_color "green" "This script will set up a production-like environment for testing the Twitter Scraper API."
echo_color "yellow" "Note: This is for testing purposes only and not intended for actual production use."
echo

# Create production environment file
if [ ! -f .env.production ]; then
  echo_color "blue" "📝 Creating production environment file..."
  cp .env.example .env.production
  echo_color "green" "✅ Created .env.production"
  echo_color "yellow" "⚠️ Please edit .env.production with your configuration values!"
  echo
  echo_color "yellow" "Do you want to edit .env.production now? (y/n): "
  read -r edit_env
  if [ "$edit_env" = "y" ] || [ "$edit_env" = "Y" ]; then
    ${EDITOR:-vi} .env.production
  fi
else
  echo_color "green" "✅ .env.production already exists"
fi

# Check if Docker containers are already running
if docker-compose ps | grep -q "twitter-scraper"; then
  echo_color "yellow" "⚠️ Some Docker containers are already running."
  echo_color "yellow" "Do you want to stop them before continuing? (y/n): "
  read -r stop_containers
  if [ "$stop_containers" = "y" ] || [ "$stop_containers" = "Y" ]; then
    echo_color "blue" "🛑 Stopping existing containers..."
    docker-compose down
    echo_color "green" "✅ Existing containers stopped"
  fi
fi

# Build Docker images
echo_color "blue" "🔨 Building Docker images..."
docker-compose --env-file .env.production build
echo_color "green" "✅ Docker images built successfully"

# Start services
echo_color "blue" "🚀 Starting services..."
docker-compose --env-file .env.production up -d
echo_color "green" "✅ Services started"

# Check if all services are running
echo_color "blue" "🔍 Checking service status..."
sleep 5  # Give services time to start

if ! docker-compose ps | grep -q "twitter-api.*Up"; then
  echo_color "red" "❌ Twitter API service failed to start"
  echo_color "yellow" "Check logs with: docker-compose logs twitter-api"
  exit 1
fi

if ! docker-compose ps | grep -q "postgres.*Up"; then
  echo_color "red" "❌ PostgreSQL service failed to start"
  echo_color "yellow" "Check logs with: docker-compose logs postgres"
  exit 1
fi

if ! docker-compose ps | grep -q "redis.*Up"; then
  echo_color "red" "❌ Redis service failed to start"
  echo_color "yellow" "Check logs with: docker-compose logs redis"
  exit 1
fi

echo_color "green" "✅ All services are running"

# Run migrations
echo_color "blue" "🔄 Running database migrations..."
echo_color "yellow" "Do you want to run database migrations now? (y/n): "
read -r run_migrations
if [ "$run_migrations" = "y" ] || [ "$run_migrations" = "Y" ]; then
  docker-compose exec -T twitter-api npm run migrations:run
  echo_color "green" "✅ Database migrations complete"
else
  echo_color "yellow" "⚠️ Skipping migrations. You can run them later with:"
  echo_color "yellow" "  docker-compose exec twitter-api npm run migrations:run"
fi

# Health check
echo_color "blue" "🏥 Running health check..."
if curl -s http://localhost:3000/api/twitter/health | grep -q "ok"; then
  echo_color "green" "✅ API health check passed"
else
  echo_color "red" "❌ API health check failed"
  echo_color "yellow" "Check logs with: docker-compose logs twitter-api"
fi

# Final instructions
echo
echo_color "blue" "==========================="
echo_color "blue" "🎉 Setup Complete!"
echo_color "blue" "==========================="
echo
echo_color "green" "Next steps:"
echo_color "green" "1. Access Swagger documentation at http://localhost:3000/documentation"
echo_color "green" "2. Run a test scraping job from the documentation or with curl:"
echo_color "green" "   curl -X POST \"http://localhost:3000/api/twitter/scrape\" \\"
echo_color "green" "     -H \"Content-Type: application/json\" \\"
echo_color "green" "     -d '{\"username\":\"elonmusk\",\"options\":{\"maxTweets\":100}}'"
echo
echo_color "yellow" "For detailed testing instructions, see docs/PRODUCTION_TESTING.md"
echo
echo_color "blue" "When you're finished testing, clean up with:"
echo_color "blue" "  docker-compose down"
echo 
FROM node:18-alpine

# Create app directory
WORKDIR /usr/src/app

# Install dependencies for wait-for script and puppeteer
RUN apk update && apk add --no-cache \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    nodejs \
    yarn \
    curl \
    bash \
    postgresql-client \
    redis

# Tell Puppeteer to skip installing Chrome. We'll use the installed package.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Create directories for data persistence
RUN mkdir -p /usr/src/app/data \
    /usr/src/app/cookies \
    /usr/src/app/backups \
    /usr/src/app/logs \
    /usr/src/app/db_logs

# Set permissions for directories
RUN chmod -R 777 /usr/src/app/data \
    /usr/src/app/cookies \
    /usr/src/app/backups \
    /usr/src/app/logs \
    /usr/src/app/db_logs

# Copy package files first (for better layer caching)
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy the rest of the application
COPY . .

# Make entrypoint scripts executable (already done in the repository, but just to be sure)
RUN chmod +x /usr/src/app/scripts/docker/entrypoint.sh /usr/src/app/scripts/docker/entrypoint-with-migrations.sh

# Copy entrypoint scripts to standard location
RUN cp /usr/src/app/scripts/docker/entrypoint.sh /usr/src/app/entrypoint.sh && \
    cp /usr/src/app/scripts/docker/entrypoint-with-migrations.sh /usr/src/app/entrypoint-with-migrations.sh

# Expose the API port
EXPOSE 3000

# Set healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/api/twitter/health || exit 1

# Start the application (default: without migrations)
CMD ["/usr/src/app/entrypoint.sh"]

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
    bash

# Tell Puppeteer to skip installing Chrome. We'll use the installed package.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Install wait-for script to wait for dependencies
RUN curl -o /usr/local/bin/wait-for-it https://raw.githubusercontent.com/vishnubob/wait-for-it/master/wait-for-it.sh && \
    chmod +x /usr/local/bin/wait-for-it

# Install app dependencies
COPY package*.json ./
RUN npm ci --only=production

# Bundle app source
COPY . .

# Create directories for data persistence
RUN mkdir -p /usr/src/app/data /usr/src/app/cookies
RUN chmod -R 777 /usr/src/app/data /usr/src/app/cookies

# Create entrypoint script (without migrations)
RUN echo '#!/bin/bash\n\
# Wait for dependencies\n\
wait-for-it ${DB_HOST:-postgres}:${DB_PORT:-5432} -t 60\n\
wait-for-it ${REDIS_HOST:-redis}:${REDIS_PORT:-6379} -t 60\n\
\n\
# Start the application\n\
exec npm start' > /usr/src/app/docker-entrypoint.sh && \
chmod +x /usr/src/app/docker-entrypoint.sh

# Create alternative entrypoint script (with migrations)
RUN echo '#!/bin/bash\n\
# Wait for dependencies\n\
wait-for-it ${DB_HOST:-postgres}:${DB_PORT:-5432} -t 60\n\
wait-for-it ${REDIS_HOST:-redis}:${REDIS_PORT:-6379} -t 60\n\
\n\
# Run migrations and start the application\n\
exec npm run start:with-migrations' > /usr/src/app/docker-entrypoint-with-migrations.sh && \
chmod +x /usr/src/app/docker-entrypoint-with-migrations.sh

# Expose the API port
EXPOSE 3000

# Start the application (default: without migrations)
CMD ["/usr/src/app/docker-entrypoint.sh"]

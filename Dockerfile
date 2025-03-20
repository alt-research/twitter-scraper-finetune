FROM node:18-alpine

# Create app directory
WORKDIR /usr/src/app

# Install puppeteer dependencies
RUN apk update && apk add --no-cache \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    nodejs \
    yarn

# Tell Puppeteer to skip installing Chrome. We'll use the installed package.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Install app dependencies
COPY package*.json ./
RUN npm ci --only=production

# Bundle app source
COPY . .

# Create directories for data persistence
RUN mkdir -p /usr/src/app/pipeline /usr/src/app/cookies
RUN chmod -R 777 /usr/src/app/pipeline /usr/src/app/cookies

# Expose the API port
EXPOSE 3000

# Start the application
CMD ["npm", "start"]

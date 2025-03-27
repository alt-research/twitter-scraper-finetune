import inquirer from "inquirer";
import chalk from "chalk";
import { format } from "date-fns";
import path from "path";
import fs from "fs/promises";

// Imported Files
import Logger from "./Logger.js";
import TweetFilter from "./TweetFilter.js";
import TwitterDatabaseConnector from "./TwitterDatabaseConnector.js";

// agent-twitter-client
import { Scraper, SearchMode } from "agent-twitter-client";

// Puppeteer
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import AdblockerPlugin from "puppeteer-extra-plugin-adblocker";
import { Cluster } from "puppeteer-cluster";

// Configure puppeteer stealth once
puppeteer.use(StealthPlugin());
puppeteer.use(AdblockerPlugin({ blockTrackers: true }));

class TwitterPipeline {
  constructor(username, options = {}) {
    this.username = username;
    this.tweetFilter = new TweetFilter();
    
    // Store Twitter credentials in a single object
    this.credentials = {
      username: options.credentials?.username || process.env.TWITTER_USERNAME,
      password: options.credentials?.password || process.env.TWITTER_PASSWORD,
      email: options.credentials?.email || process.env.TWITTER_EMAIL
    };
    
    // Create database connector instance
    this.dbConnector = new TwitterDatabaseConnector();

    // Cookie path in top-level cookies directory - use the authenticated username for cookies
    this.cookiesPath = path.join(
      process.cwd(),
      'cookies',
      `${this.credentials.username}_cookies.json`
    );

    // Enhanced configuration with environment variables and fallback handling
    this.config = {
      twitter: {
        maxTweets: parseInt(options.maxTweets || process.env.MAX_TWEETS) || 50000,
        maxRetries: parseInt(options.maxRetries || process.env.MAX_RETRIES) || 5,
        retryDelay: parseInt(options.retryDelay || process.env.RETRY_DELAY) || 5000,
        minDelayBetweenRequests: parseInt(options.minDelay || process.env.MIN_DELAY) || 1000,
        maxDelayBetweenRequests: parseInt(options.maxDelay || process.env.MAX_DELAY) || 3000,
        rateLimitThreshold: parseInt(process.env.RATE_LIMIT_THRESHOLD) || 3,
        baseRateLimitDelay: parseInt(process.env.RATE_LIMIT_BASE_DELAY) || 60000,
        maxRateLimitDelay: parseInt(process.env.RATE_LIMIT_MAX_DELAY) || 15 * 60 * 1000,
        rateLimitDuration: parseInt(process.env.RATE_LIMIT_DURATION) || 15 * 60 * 1000,
      },
      timeouts: {
        globalTimeout: parseInt(process.env.COLLECTION_GLOBAL_TIMEOUT) || 60 * 1000,
        stallTimeout: parseInt(process.env.COLLECTION_STALL_TIMEOUT) || 15000,
        progressCheckInterval: parseInt(process.env.COLLECTION_PROGRESS_CHECK) || 2000,
      },
      fallback: {
        enabled: options.fallbackEnabled !== undefined ? options.fallbackEnabled : true,
        sessionDuration: 30 * 60 * 1000, // 30 minutes
        viewport: {
          width: 1366,
          height: 768,
          deviceScaleFactor: 1,
          hasTouch: false,
          isLandscape: true,
        },
      },
      database: {
        generateAnalytics: options.generateAnalytics !== undefined ? options.generateAnalytics : true,
      }
    };

    this.scraper = new Scraper();
    this.cluster = null;

    // Enhanced statistics tracking
    this.stats = {
      requestCount: 0,
      rateLimitHits: 0,
      retriesCount: 0,
      uniqueTweets: 0,
      fallbackCount: 0,
      startTime: Date.now(),
      oldestTweetDate: null,
      newestTweetDate: null,
      fallbackUsed: false,
    };

    // New behavior state tracking
    this.behaviorState = null;
  }

  async initializeFallback() {
    if (!this.cluster) {
      this.cluster = await Cluster.launch({
        puppeteer,
        maxConcurrency: 1, // Single instance for consistency
        timeout: 30000,
        puppeteerOptions: {
          headless: "new",
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-blink-features=AutomationControlled",
          ],
        },
      });

      this.cluster.on("taskerror", async (err) => {
        Logger.warn(`Fallback error: ${err.message}`);
        this.stats.retriesCount++;
      });
    }
  }

  async setupFallbackPage(page) {
    await page.setViewport(this.config.fallback.viewport);

    // Basic evasion only - maintain consistency
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
  }

  async validateEnvironment() {
    Logger.startSpinner("Validating environment");
    
    // Check if we have valid Twitter credentials
    if (!this.credentials.username || !this.credentials.password || !this.credentials.email) {
      Logger.stopSpinner(false);
      Logger.error("Missing required Twitter credentials:");
      if (!this.credentials.username) Logger.error(`- Twitter Username`);
      if (!this.credentials.password) Logger.error(`- Twitter Password`);
      if (!this.credentials.email) Logger.error(`- Twitter Email`);
      
      console.log("\n📝 Provide Twitter credentials either via .env file or as options:");
      console.log(`TWITTER_USERNAME=your_username`);
      console.log(`TWITTER_PASSWORD=your_password`);
      console.log(`TWITTER_EMAIL=your_email`);
      
      // Return false instead of calling process.exit(1)
      return false;
    }
    
    Logger.stopSpinner();
    return true;
  }

  async loadCookies() {
    try {
      if (await fs.access(this.cookiesPath).catch(() => false)) {
        const cookiesData = await fs.readFile(this.cookiesPath, 'utf-8');
        const cookies = JSON.parse(cookiesData);
        await this.scraper.setCookies(cookies);
        return true;
      }
    } catch (error) {
      Logger.warn(`Failed to load cookies: ${error.message}`);
    }
    return false;
  }

  async saveCookies() {
    try {
      const cookies = await this.scraper.getCookies();
      // Create cookies directory if it doesn't exist
      await fs.mkdir(path.dirname(this.cookiesPath), { recursive: true });
      await fs.writeFile(this.cookiesPath, JSON.stringify(cookies));
      Logger.success('Saved authentication cookies');
    } catch (error) {
      Logger.warn(`Failed to save cookies: ${error.message}`);
    }
  }

  async initializeScraper() {
    Logger.startSpinner("Initializing Twitter scraper");
    let retryCount = 0;

    // Try loading cookies first
    if (await this.loadCookies()) {
      try {
        if (await this.scraper.isLoggedIn()) {
          Logger.success("✅ Successfully authenticated with saved cookies");
          Logger.stopSpinner();
          return true;
        }
      } catch (error) {
        Logger.warn("Saved cookies are invalid, attempting fresh login");
      }
    }

    // Verify all required credentials are present
    const username = this.credentials.username;
    const password = this.credentials.password;
    const email = this.credentials.email;

    if (!username || !password || !email) {
      Logger.error("Missing required credentials. Need username, password, AND email");
      Logger.stopSpinner(false);
      return false;
    }

    // Attempt login with email verification
    while (retryCount < this.config.twitter.maxRetries) {
      try {
        // Add random delay before login attempt
        await this.randomDelay(5000, 10000);

        // Always use email in login attempt
        await this.scraper.login(username, password, email);

        // Verify login success
        const isLoggedIn = await this.scraper.isLoggedIn();
        if (isLoggedIn) {
          await this.saveCookies();
          Logger.success("✅ Successfully authenticated with Twitter");
          Logger.stopSpinner();
          return true;
        } else {
          throw new Error("Login verification failed");
        }

      } catch (error) {
        retryCount++;
        Logger.warn(
          `⚠️  Authentication attempt ${retryCount} failed: ${error.message}`
        );

        if (retryCount >= this.config.twitter.maxRetries) {
          Logger.stopSpinner(false);
          return false;
        }

        // Exponential backoff with jitter
        const baseDelay = this.config.twitter.retryDelay * Math.pow(2, retryCount - 1);
        const maxJitter = baseDelay * 0.2; // 20% jitter
        const jitter = Math.floor(Math.random() * maxJitter);
        await this.randomDelay(baseDelay + jitter, baseDelay + jitter + 5000);
      }
    }
    return false;
  }

  async randomDelay(min, max) {
    // Ensure reasonable defaults
    min = min || this.config.twitter.minDelayBetweenRequests;
    max = max || this.config.twitter.maxDelayBetweenRequests;

    // Human behavior is not uniform or purely Gaussian - it's more complex
    // Key behaviors to simulate:
    // 1. Micro-pauses (quick scanning)
    // 2. Reading pauses (content consumption)
    // 3. Thinking pauses (deciding what to do next)
    // 4. Occasional long breaks (distraction or task switching)

    let delay;
    
    // Initialize behavioral state if not exists
    if (!this.behaviorState) {
      this.behaviorState = {
        readingSpeed: Math.random() * 0.5 + 0.7, // Reading speed modifier (0.7-1.2)
        attentionSpan: Math.random() * 20 + 10,  // Attention span in actions
        actionCount: 0,                          // Actions taken so far
        lastActionType: null,                    // Type of last action
        timeSinceBreak: 0,                       // Actions since last long break
        breakThreshold: Math.floor(Math.random() * 30) + 30, // Actions before likely break
        sessionIntensity: Math.random()          // How "focused" this session is (0-1)
      };
    }
    
    // Update behavior state
    this.behaviorState.actionCount++;
    this.behaviorState.timeSinceBreak++;
    
    // Determine the type of delay to use
    const actionTypes = ['scan', 'read', 'think', 'break'];
    let actionWeights;
    
    // Weights depend on previous action (for realistic sequences)
    if (this.behaviorState.lastActionType === 'scan') {
      actionWeights = [0.3, 0.5, 0.15, 0.05]; // After scanning, likely to read
    } else if (this.behaviorState.lastActionType === 'read') {
      actionWeights = [0.4, 0.2, 0.3, 0.1];  // After reading, might scan again or think
    } else if (this.behaviorState.lastActionType === 'think') {
      actionWeights = [0.6, 0.2, 0.1, 0.1];  // After thinking, likely to scan
    } else if (this.behaviorState.lastActionType === 'break') {
      actionWeights = [0.7, 0.2, 0.1, 0];    // After a break, almost always scan
    } else {
      // Initial action
      actionWeights = [0.6, 0.2, 0.15, 0.05];
    }
    
    // Adjust break probability based on time since last break
    if (this.behaviorState.timeSinceBreak > this.behaviorState.breakThreshold) {
      // Increase likelihood of taking a break
      actionWeights[3] += 0.2;
      // Normalize weights
      const sum = actionWeights.reduce((a, b) => a + b, 0);
      actionWeights = actionWeights.map(w => w / sum);
    }
    
    // Select action type based on weights
    const rand = Math.random();
    let cumulativeWeight = 0;
    let selectedActionIndex = 0;
    
    for (let i = 0; i < actionWeights.length; i++) {
      cumulativeWeight += actionWeights[i];
      if (rand <= cumulativeWeight) {
        selectedActionIndex = i;
        break;
      }
    }
    
    const actionType = actionTypes[selectedActionIndex];
    this.behaviorState.lastActionType = actionType;
    
    // Calculate delay based on action type
    if (actionType === 'scan') {
      // Quick scanning (lower end of range)
      delay = min + Math.random() * (min * 0.8);
    } else if (actionType === 'read') {
      // Reading (mid-range)
      const baseReadingTime = min + (max - min) * 0.4;
      delay = baseReadingTime * this.behaviorState.readingSpeed;
    } else if (actionType === 'think') {
      // Thinking (higher end of range)
      delay = min + (max - min) * (0.6 + Math.random() * 0.3);
    } else if (actionType === 'break') {
      // Taking a break (occasional long pauses)
      delay = max * (1 + Math.random() * 1.5); // Up to 2.5x the max
      this.behaviorState.timeSinceBreak = 0; // Reset break counter
    }
    
    // Apply a natural variation (small jitter)
    delay *= 0.85 + Math.random() * 0.3; // ±15% variation
    
    // If we're close to being rate limited, slow down
    if (this.stats.rateLimitHits > 0) {
      // Gradually slow down as we hit more rate limits
      const slowdownFactor = 1 + (this.stats.rateLimitHits * 0.2);
      delay *= slowdownFactor;
      
      if (this.stats.rateLimitHits > 1) {
        Logger.debug(`Slowing down by ${Math.round((slowdownFactor-1)*100)}% due to previous rate limits`);
      }
    }
    
    // Log with appropriate verbosity based on delay length
    if (delay > max) {
      Logger.info(`Taking a ${(delay / 1000).toFixed(1)}s break...`);
    } else {
      Logger.debug(`Waiting ${(delay / 1000).toFixed(1)}s (${actionType})`);
    }
    
    // Update stats
    this.stats.requestCount++;
    
    // Periodic logging of our request rate
    if (this.stats.requestCount % 10 === 0) {
      const elapsedMinutes = (Date.now() - this.stats.startTime) / 60000;
      const requestsPerMinute = this.stats.requestCount / elapsedMinutes;
      Logger.info(`Current rate: ${requestsPerMinute.toFixed(1)} requests/minute`);
    }
    
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  async handleRateLimit(retryCount = 1) {
    this.stats.rateLimitHits++;
    const baseDelay = this.config.twitter.baseRateLimitDelay;
    const maxDelay = this.config.twitter.maxRateLimitDelay;

    // Exponential backoff with small jitter
    const exponentialDelay = baseDelay * Math.pow(2, retryCount - 1);
    const jitter = Math.random() * 0.1 * exponentialDelay; // 10% jitter
    const delay = Math.min(exponentialDelay + jitter, maxDelay);

    Logger.warn(
      `⚠️  Rate limit hit - waiting ${
        delay / 1000
      } seconds (attempt ${retryCount})`
    );

    await this.randomDelay(delay, delay * 1.1);
  }

  processTweetData(tweet) {
    try {
      if (!tweet || !tweet.id) return null;

      let timestamp = tweet.timestamp;
      if (!timestamp) {
        timestamp = tweet.timeParsed?.getTime();
      }

      if (!timestamp) return null;

      if (timestamp < 1e12) timestamp *= 1000;

      if (isNaN(timestamp) || timestamp <= 0) {
        Logger.warn(`⚠️  Invalid timestamp for tweet ${tweet.id}`);
        return null;
      }

      const tweetDate = new Date(timestamp);
      if (
        !this.stats.oldestTweetDate ||
        tweetDate < this.stats.oldestTweetDate
      ) {
        this.stats.oldestTweetDate = tweetDate;
      }
      if (
        !this.stats.newestTweetDate ||
        tweetDate > this.stats.newestTweetDate
      ) {
        this.stats.newestTweetDate = tweetDate;
      }

      return {
        id: tweet.id,
        text: tweet.text,
        username: tweet.username || this.username,
        timestamp,
        createdAt: new Date(timestamp).toISOString(),
        isReply: Boolean(tweet.isReply),
        isRetweet: Boolean(tweet.isRetweet),
        likes: tweet.likes || 0,
        retweetCount: tweet.retweets || 0,
        replies: tweet.replies || 0,
        photos: tweet.photos || [],
        videos: tweet.videos || [],
        urls: tweet.urls || [],
        permanentUrl: tweet.permanentUrl,
        quotedStatusId: tweet.quotedStatusId,
        inReplyToStatusId: tweet.inReplyToStatusId,
        hashtags: tweet.hashtags || [],
      };
    } catch (error) {
      Logger.warn(`⚠️  Error processing tweet ${tweet?.id}: ${error.message}`);
      return null;
    }
  }

  async collectWithFallback(searchQuery) {
    if (!this.cluster) {
      await this.initializeFallback();
    }

    const tweets = new Set();
    let sessionStartTime = Date.now();

    const fallbackTask = async ({ page }) => {
      await this.setupFallbackPage(page);

      try {
        // Login with minimal interaction
        await page.goto("https://twitter.com/login", {
          waitUntil: "networkidle0",
          timeout: 30000,
        });

        await page.type(
          'input[autocomplete="username"]',
          this.credentials.username
        );
        await this.randomDelay(500, 1000);
        await page.click('div[role="button"]:not([aria-label])');
        await this.randomDelay(500, 1000);
        await page.type('input[type="password"]', this.credentials.password);
        await this.randomDelay(500, 1000);
        await page.click('div[role="button"][data-testid="LoginButton"]');
        await page.waitForNavigation({ waitUntil: "networkidle0" });

        // Go directly to search
        await page.goto(
          `https://twitter.com/search?q=${encodeURIComponent(
            searchQuery
          )}&f=live`
        );
        await this.randomDelay(1000, 2000);

        let lastTweetCount = 0;
        let unchangedCount = 0;

        while (
          unchangedCount < 3 &&
          Date.now() - sessionStartTime < this.config.fallback.sessionDuration
        ) {
          await page.evaluate(() => {
            window.scrollBy(0, 500);
          });

          await this.randomDelay(1000, 2000);

          const newTweets = await page.evaluate(() => {
            const tweetElements = Array.from(
              document.querySelectorAll('article[data-testid="tweet"]')
            );
            return tweetElements
              .map((tweet) => {
                try {
                  return {
                    id: tweet.getAttribute("data-tweet-id"),
                    text: tweet.querySelector("div[lang]")?.textContent || "",
                    timestamp: tweet
                      .querySelector("time")
                      ?.getAttribute("datetime"),
                    metrics: Array.from(
                      tweet.querySelectorAll('span[data-testid$="count"]')
                    ).map((m) => m.textContent),
                  };
                } catch (e) {
                  return null;
                }
              })
              .filter((t) => t && t.id);
          });

          for (const tweet of newTweets) {
            if (!tweets.has(tweet.id)) {
              tweets.add(tweet);
              this.stats.fallbackCount++;
            }
          }

          if (tweets.size === lastTweetCount) {
            unchangedCount++;
          } else {
            unchangedCount = 0;
            lastTweetCount = tweets.size;
          }
        }
      } catch (error) {
        Logger.warn(`Fallback collection error: ${error.message}`);
        throw error;
      }
    };

    await this.cluster.task(fallbackTask);
    await this.cluster.queue({});

    return Array.from(tweets);
  }

  async collectTweets(scraper) {
    try {
      const profile = await scraper.getProfile(this.username);
      const totalExpectedTweets = profile.tweetsCount;

      Logger.info(
        `📊 Found ${chalk.bold(
          totalExpectedTweets.toLocaleString()
        )} total tweets for @${this.username}`
      );

      const allTweets = new Map();
      let previousCount = 0;
      let stagnantBatches = 0;
      const MAX_STAGNANT_BATCHES = 2;
      
      // Setup stall detection
      let lastProgressTime = Date.now();
      let lastTweetCount = 0;
      let stallDetectionInterval = null;
      let isStalled = false;
      
      // Create a stall detection interval that checks for progress
      const MAX_STALL_TIME = this.config.timeouts.stallTimeout;
      const PROGRESS_CHECK_INTERVAL = this.config.timeouts.progressCheckInterval;
      
      stallDetectionInterval = setInterval(() => {
        const currentCount = allTweets.size;
        const timeSinceProgress = Date.now() - lastProgressTime;
        
        if (currentCount > lastTweetCount) {
          // Progress was made, reset the timer
          lastProgressTime = Date.now();
          lastTweetCount = currentCount;
          Logger.debug(`Collection progress: ${currentCount} tweets`);
        } else if (timeSinceProgress > MAX_STALL_TIME && !isStalled) {
          // No progress for too long - likely rate limited
          // Don't throw directly as it could crash the server - just mark as stalled
          isStalled = true;
          
          // Log the stall detection
          Logger.warn(`⚠️ Collection stalled for ${Math.round(timeSinceProgress/1000)}s - likely rate limited`);
          
          // Update rate limit hit counter
          this.stats.rateLimitHits++;
          
          // Break out of collection loop early by forcing the interval to check very frequently
          clearInterval(stallDetectionInterval);
          stallDetectionInterval = setInterval(() => {
            // This smaller interval just keeps checking if we've broken out of the loop
            if (isStalled) {
              Logger.debug("Still waiting to break out of collection loop...");
            } else {
              // If somehow not stalled anymore, clear this interval
              clearInterval(stallDetectionInterval);
              stallDetectionInterval = null;
            }
          }, 500); // Check every 500ms
        }
      }, PROGRESS_CHECK_INTERVAL);

      // Try main collection
      try {
        const searchResults = scraper.searchTweets(
          `from:${this.username}`,
          this.config.twitter.maxTweets,
          SearchMode.Latest
        );

        for await (const tweet of searchResults) {
          // Check if we've been stalled - break out of the loop safely
          if (isStalled) {
            Logger.warn("Breaking out of collection loop due to detected stall");
            break;
          }
          
          if (tweet && !allTweets.has(tweet.id)) {
            const processedTweet = this.processTweetData(tweet);
            if (processedTweet) {
              allTweets.set(tweet.id, processedTweet);
              this.stats.uniqueTweets = allTweets.size; // Update the uniqueTweets counter

              if (allTweets.size % 100 === 0) {
                const completion = (
                  (allTweets.size / totalExpectedTweets) *
                  100
                ).toFixed(1);
                Logger.info(
                  `📊 Progress: ${allTweets.size.toLocaleString()} unique tweets (${completion}%)`
                );

                if (allTweets.size === previousCount) {
                  stagnantBatches++;
                  if (stagnantBatches >= MAX_STAGNANT_BATCHES) {
                    Logger.info(
                      "📝 Collection rate has stagnated, checking fallback..."
                    );
                    break;
                  }
                } else {
                  stagnantBatches = 0;
                }
                previousCount = allTweets.size;
              }
            }
          }
        }
        
        // Clear the interval after collection completes
        if (stallDetectionInterval) {
          clearInterval(stallDetectionInterval);
          stallDetectionInterval = null;
        }
      } catch (error) {
        // Make sure to clear the interval to prevent memory leaks
        if (stallDetectionInterval) {
          clearInterval(stallDetectionInterval);
          stallDetectionInterval = null;
        }
        
        // Mark as stalled if we hit an error during collection
        isStalled = true;
        this.stats.rateLimitHits++;
        
        // Check for rate limit related errors
        if (error.message.includes("rate limit") || error.message.includes("too many requests")) {
          Logger.warn(`Rate limit error from scraper: ${error.message}`);
          await this.handleRateLimit(this.stats.rateLimitHits + 1);

          // Consider fallback if rate limits are frequent
          if (this.stats.rateLimitHits >= this.config.twitter.rateLimitThreshold && this.config.fallback.enabled) {
            Logger.info("Switching to fallback collection...");
            try {
              const fallbackTweets = await this.collectWithFallback(`from:${this.username}`);

              fallbackTweets.forEach((tweet) => {
                if (!allTweets.has(tweet.id)) {
                  const processedTweet = this.processTweetData(tweet);
                  if (processedTweet) {
                    allTweets.set(tweet.id, processedTweet);
                    this.stats.fallbackUsed = true;
                  }
                }
              });
            } catch (fallbackError) {
              Logger.error(`Fallback collection failed: ${fallbackError.message}`);
            }
          }
        } else {
          // Log non-rate-limit errors
          Logger.warn(`⚠️ Search error: ${error.message}`);
        }
      }
      
      // Check if we were stalled and need to try fallback
      if (isStalled && allTweets.size === 0 && this.config.fallback.enabled) {
        // Use fallback collection since we were stalled with no tweets
        Logger.info("Trying fallback collection due to stall...");
        try {
          const fallbackTweets = await this.collectWithFallback(`from:${this.username}`);
          
          fallbackTweets.forEach((tweet) => {
            if (!allTweets.has(tweet.id)) {
              const processedTweet = this.processTweetData(tweet);
              if (processedTweet) {
                allTweets.set(tweet.id, processedTweet);
                this.stats.fallbackUsed = true;
              }
            }
          });
        } catch (fallbackError) {
          Logger.error(`Fallback collection failed: ${fallbackError.message}`);
        }
      }

      // Use fallback for additional tweets if needed
      if (
        !isStalled && 
        allTweets.size < totalExpectedTweets * 0.8 &&
        this.config.fallback.enabled
      ) {
        Logger.info("\n🔍 Collecting additional tweets via fallback...");

        try {
          const fallbackTweets = await this.collectWithFallback(
            `from:${this.username}`
          );
          let newTweetsCount = 0;

          fallbackTweets.forEach((tweet) => {
            if (!allTweets.has(tweet.id)) {
              const processedTweet = this.processTweetData(tweet);
              if (processedTweet) {
                allTweets.set(tweet.id, processedTweet);
                newTweetsCount++;
                this.stats.fallbackUsed = true;
              }
            }
          });

          if (newTweetsCount > 0) {
            Logger.info(
              `Found ${newTweetsCount} additional tweets via fallback`
            );
          }
        } catch (error) {
          Logger.warn(`⚠️  Fallback collection error: ${error.message}`);
        }
      }

      // Even if we were stalled, return what we managed to collect
      if (isStalled) {
        Logger.warn(`Collection was stalled. Returning ${allTweets.size} tweets that were collected.`);
      } else {
        Logger.success(
          `\n🎉 Collection complete! ${allTweets.size.toLocaleString()} unique tweets collected${
            this.stats.fallbackUsed
              ? ` (including ${this.stats.fallbackCount} from fallback)`
              : ""
          }`
        );
      }

      return Array.from(allTweets.values());
    } catch (error) {
      Logger.error(`Failed to collect tweets: ${error.message}`);
      // Return empty array rather than throwing to prevent server crash
      return [];
    }
  }

  async showSampleTweets(tweets) {
    const { showSample } = await inquirer.prompt([
      {
        type: "confirm",
        name: "showSample",
        message: "Would you like to see a sample of collected tweets?",
        default: true,
      },
    ]);

    if (showSample) {
      Logger.info("\n🌟 Sample Tweets (Most Engaging):");

      const sortedTweets = tweets
        .filter((tweet) => !tweet.isRetweet)
        .sort((a, b) => b.likes + b.retweetCount - (a.likes + a.retweetCount))
        .slice(0, 5);

      sortedTweets.forEach((tweet, i) => {
        console.log(
          chalk.cyan(
            `\n${i + 1}. [${format(new Date(tweet.timestamp), "yyyy-MM-dd")}]`
          )
        );
        console.log(chalk.white(tweet.text));
        console.log(
          chalk.gray(
            `❤️ ${tweet.likes.toLocaleString()} | 🔄 ${tweet.retweetCount.toLocaleString()} | 💬 ${tweet.replies.toLocaleString()}`
          )
        );
        console.log(chalk.gray(`🔗 ${tweet.permanentUrl}`));
      });
    }
  }

  async getProfile() {
    const profile = await this.scraper.getProfile(this.username);
    return profile;
  }

  /**
   * Stores scraped tweets directly in the database
   * @param {Array} tweets - Array of tweets to store
   * @param {Object} userData - User profile data
   * @returns {Object} - Result of the database storage operation
   */
  async storeInDatabase(tweets, userData) {
    try {
      Logger.startSpinner(`Storing ${tweets.length} tweets in database`);
      
      const result = await this.dbConnector.storeTweets(this.username, tweets, userData);
      
      Logger.stopSpinner();
      Logger.success(`✅ Successfully stored ${result.savedCount} tweets in database, skipped ${result.skippedCount || 0} existing tweets`);
      
      // Generate analytics if configured
      if (this.config.database.generateAnalytics && result.user && result.user.id) {
        Logger.startSpinner('Generating analytics');
        await this.dbConnector.generateAnalytics(this.username, result.user.id);
        Logger.stopSpinner();
        Logger.success('✅ Generated analytics for user');
      }
      
      return result;
    } catch (error) {
      Logger.stopSpinner(false);
      Logger.error(`Failed to store tweets in database: ${error.message}`);
      throw error;
    }
  }

  /**
   * Calculate basic analytics about the collected tweets
   * @param {Array} tweets - Array of tweets to analyze
   * @returns {Object} - Analytics data
   */
  calculateBasicAnalytics(tweets) {
    // Extract tweet types
    const tweetTypes = tweets.reduce((acc, tweet) => {
      if (tweet.isReply || tweet.in_reply_to_status_id_str) acc.replies++;
      else if (tweet.isRetweet || tweet.retweeted_status) acc.retweets++;
      else acc.directTweets++;
      return acc;
    }, { directTweets: 0, replies: 0, retweets: 0 });
    
    // Find date range
    const dates = tweets
      .map(t => new Date(t.timestamp || t.created_at || t.createdAt))
      .filter(d => !isNaN(d.getTime()))
      .sort((a, b) => a - b);
    
    const timeRange = {
      start: dates.length ? format(dates[0], 'yyyy-MM-dd') : 'N/A',
      end: dates.length ? format(dates[dates.length - 1], 'yyyy-MM-dd') : 'N/A'
    };
    
    // Content type breakdown
    const contentTypes = {
      textOnly: tweets.filter(t => 
        (!t.photos || t.photos.length === 0) && 
        (!t.videos || t.videos.length === 0) && 
        (!t.entities?.media || t.entities.media.length === 0)
      ).length,
      withImages: tweets.filter(t => 
        (t.photos && t.photos.length > 0) || 
        (t.entities?.media && t.entities.media.some(m => m.type === 'photo'))
      ).length,
      withVideos: tweets.filter(t => 
        (t.videos && t.videos.length > 0) || 
        (t.entities?.media && t.entities.media.some(m => ['video', 'animated_gif'].includes(m.type)))
      ).length,
      withLinks: tweets.filter(t => 
        (t.urls && t.urls.length > 0) || 
        (t.entities?.urls && t.entities.urls.length > 0)
      ).length
    };
    
    // Engagement statistics
    const engagement = {
      totalLikes: tweets.reduce((sum, t) => sum + (t.likes || t.favorite_count || 0), 0),
      totalRetweetCount: tweets.reduce((sum, t) => sum + (t.retweetCount || t.retweet_count || 0), 0),
      totalReplies: tweets.reduce((sum, t) => sum + (t.replies || t.reply_count || 0), 0),
      averageLikes: tweets.length > 0 
        ? Math.round(tweets.reduce((sum, t) => sum + (t.likes || t.favorite_count || 0), 0) / tweets.length)
        : 0
    };
    
    return {
      ...tweetTypes,
      timeRange,
      contentTypes,
      engagement
    };
  }

  async run() {
    const startTime = Date.now();

    console.log("\n" + chalk.bold.blue("🐦 Twitter Data Collection Pipeline"));
    console.log(
      chalk.bold(`Target Account: ${chalk.cyan("@" + this.username)}\n`)
    );

    try {
      // Check environment and credentials
      const isEnvironmentValid = await this.validateEnvironment();
      if (!isEnvironmentValid) {
        const errorMsg = "Missing required Twitter credentials.";
        Logger.error(errorMsg);
        
        // Return an empty result that indicates missing credentials
        await this.partialCleanup();
        return { 
          tweets: [], 
          user: null,
          error: {
            type: 'configuration',
            message: errorMsg,
            details: {
              username: this.username,
              credentialsProvided: false
            }
          }
        };
      }

      // Initialize main scraper - fail fast if authentication fails
      const scraperInitialized = await this.initializeScraper();
      if (!scraperInitialized) {
        const errorMsg = "Twitter authentication failed after maximum retries.";
        Logger.error(errorMsg);
        
        // Authentication failed, so we don't need to continue
        // We'll return an empty result that indicates auth failure
        await this.partialCleanup();
        return { 
          tweets: [], 
          user: null,
          error: {
            type: 'authentication',
            message: errorMsg
          }
        };
      }

      // Set a global timeout for the entire collection process
      const GLOBAL_TIMEOUT = this.config.timeouts.globalTimeout;
      let globalTimeoutId = null;
      let isTimedOut = false;
      
      // Create a wrapper that handles global timeout
      const runWithTimeout = async () => {
        // Set up timeout
        return new Promise((resolve) => {
          // Start the global timeout
          globalTimeoutId = setTimeout(() => {
            isTimedOut = true;
            Logger.warn(`⚠️ Global collection timeout reached after ${GLOBAL_TIMEOUT/1000}s`);
            // Resolve with empty array instead of rejecting
            resolve([]);
          }, GLOBAL_TIMEOUT);
          
          // Run the actual collection
          Logger.startSpinner(`Collecting tweets from @${this.username}`);
          this.collectTweets(this.scraper).then(tweets => {
            Logger.stopSpinner();
            // Clear timeout
            if (globalTimeoutId) {
              clearTimeout(globalTimeoutId);
              globalTimeoutId = null;
            }
            resolve(tweets);
          }).catch(error => {
            Logger.stopSpinner(false);
            Logger.error(`Collection error: ${error.message}`);
            // Clear timeout
            if (globalTimeoutId) {
              clearTimeout(globalTimeoutId);
              globalTimeoutId = null;
            }
            // Resolve with empty array to prevent crashes
            resolve([]);
          });
        });
      };
      
      // Run collection with timeout
      const allTweets = await runWithTimeout();
      
      // Check if we got any tweets
      if (allTweets.length === 0) {
        if (isTimedOut) {
          Logger.warn("⚠️ Collection timed out with no tweets collected");
        } else {
          Logger.warn("⚠️ No tweets collected - possible rate limiting");
        }
        
        // Return with an error indicating rate limiting or timeout
        await this.partialCleanup();
        return { 
          tweets: [], 
          user: null,
          error: {
            type: 'rate-limited',
            message: isTimedOut ? 
              "Tweet collection timed out after " + (GLOBAL_TIMEOUT/1000) + " seconds" : 
              "No tweets collected due to possible rate limiting"
          }
        };
      }

      // Get user profile data
      let userData = null;
      try {
        userData = await this.getProfile();
        Logger.info(`Retrieved profile data for @${this.username}`);
      } catch (error) {
        Logger.warn(`Failed to retrieve profile data: ${error.message}`);
      }

      // Calculate basic analytics for display
      const analytics = this.calculateBasicAnalytics(allTweets);
      
      // Store in database
      let dbResult = null;
      try {
        dbResult = await this.storeInDatabase(allTweets, userData);
      } catch (dbError) {
        Logger.error(`Database storage failed: ${dbError.message}`);
        // Don't throw - we'll still return the tweets we collected
      }

      // Calculate final statistics
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      const tweetsPerMinute = (allTweets.length / (duration / 60)).toFixed(1);
      const successRate = (
        (allTweets.length /
          (this.stats.requestCount + this.stats.fallbackCount)) *
        100
      ).toFixed(1);

      // Display final results
      Logger.stats("📈 Collection Results", {
        "Total Tweets": allTweets.length.toLocaleString(),
        "Original Tweets": analytics.directTweets.toLocaleString(),
        "Replies": analytics.replies.toLocaleString(),
        "Retweets": analytics.retweets.toLocaleString(),
        "Date Range": `${analytics.timeRange.start} to ${analytics.timeRange.end}`,
        "Runtime": `${duration} seconds`,
        "Collection Rate": `${tweetsPerMinute} tweets/minute`,
        "Success Rate": `${successRate}%`,
        "Rate Limit Hits": this.stats.rateLimitHits.toLocaleString(),
        "Fallback Collections": this.stats.fallbackCount.toLocaleString(),
        "Database Storage": dbResult ? 
          `✅ Success (${dbResult.savedCount} saved, ${dbResult.skippedCount || 0} skipped)` : 
          "❌ Failed"
      });

      // Content type breakdown
      Logger.info("\n📊 Content Type Breakdown:");
      console.log(
        chalk.cyan(
          `• Text Only: ${analytics.contentTypes.textOnly.toLocaleString()}`
        )
      );
      console.log(
        chalk.cyan(
          `• With Images: ${analytics.contentTypes.withImages.toLocaleString()}`
        )
      );
      console.log(
        chalk.cyan(
          `• With Videos: ${analytics.contentTypes.withVideos.toLocaleString()}`
        )
      );
      console.log(
        chalk.cyan(
          `• With Links: ${analytics.contentTypes.withLinks.toLocaleString()}`
        )
      );

      // Engagement statistics
      Logger.info("\n💫 Engagement Statistics:");
      console.log(
        chalk.cyan(
          `• Total Likes: ${analytics.engagement.totalLikes.toLocaleString()}`
        )
      );
      console.log(
        chalk.cyan(
          `• Total Retweets: ${analytics.engagement.totalRetweetCount.toLocaleString()}`
        )
      );
      console.log(
        chalk.cyan(
          `• Total Replies: ${analytics.engagement.totalReplies.toLocaleString()}`
        )
      );
      console.log(
        chalk.cyan(`• Average Likes: ${analytics.engagement.averageLikes}`)
      );

      // Collection method breakdown
      if (this.stats.fallbackUsed) {
        Logger.info("\n🔄 Collection Method Breakdown:");
        console.log(
          chalk.cyan(
            `• Primary Collection: ${(
              allTweets.length - this.stats.fallbackCount
            ).toLocaleString()}`
          )
        );
        console.log(
          chalk.cyan(
            `• Fallback Collection: ${this.stats.fallbackCount.toLocaleString()}`
          )
        );
      }

      // Do a partial cleanup that leaves the database connection intact
      await this.partialCleanup();

      // Return the tweets and user data for potential further processing
      return { tweets: allTweets, user: userData };
    } catch (error) {
      Logger.error(`Pipeline failed: ${error.message}`);
      await this.logError(error, {
        stage: "pipeline_execution",
        runtime: (Date.now() - startTime) / 1000,
        stats: this.stats,
      });
      
      // Do a partial cleanup that leaves the database connection intact
      await this.partialCleanup();
      throw error;
    }
  }

  async logError(error, context = {}) {
    const errorLog = {
      timestamp: new Date().toISOString(),
      error: {
        message: error.message,
        stack: error.stack,
      },
      context: {
        ...context,
        username: this.username,
        sessionDuration: Date.now() - this.stats.startTime,
        rateLimitHits: this.stats.rateLimitHits,
        fallbackUsed: this.stats.fallbackUsed,
        fallbackCount: this.stats.fallbackCount,
      },
      stats: this.stats,
      config: {
        delays: {
          min: this.config.twitter.minDelayBetweenRequests,
          max: this.config.twitter.maxDelayBetweenRequests,
        },
        retries: this.config.twitter.maxRetries,
        fallback: {
          enabled: this.config.fallback.enabled,
          sessionDuration: this.config.fallback.sessionDuration,
        },
      },
    };

    // Log error to console only since we're not using the file system
    console.error('Pipeline Error Log:', JSON.stringify(errorLog, null, 2));
  }

  // New method for partial cleanup that doesn't close the database connection
  async partialCleanup() {
    try {
      // Cleanup main scraper
      if (this.scraper) {
        await this.scraper.logout();
        Logger.success("🔒 Logged out of primary system");
      }

      // Cleanup fallback system
      if (this.cluster) {
        await this.cluster.close();
        Logger.success("🔒 Cleaned up fallback system");
      }
      
      Logger.success("✨ Partial cleanup complete (database connection preserved)");
    } catch (error) {
      Logger.warn(`⚠️  Cleanup error: ${error.message}`);
    }
  }

  async cleanup() {
    try {
      // Cleanup main scraper
      if (this.scraper) {
        await this.scraper.logout();
        Logger.success("🔒 Logged out of primary system");
      }

      // Cleanup fallback system
      if (this.cluster) {
        await this.cluster.close();
        Logger.success("🔒 Cleaned up fallback system");
      }
      
      // Cleanup database connection
      if (this.dbConnector) {
        await this.dbConnector.close();
        Logger.success("🔒 Closed database connection");
      }

      Logger.success("✨ Cleanup complete");
    } catch (error) {
      Logger.warn(`⚠️  Cleanup error: ${error.message}`);
    }
  }
}

export default TwitterPipeline;
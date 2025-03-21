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
  constructor(username, credentials = null) {
    this.username = username;
    this.tweetFilter = new TweetFilter();
    
    // Store credentials (if provided)
    this.credentials = credentials || {
      twitterUsername: process.env.TWITTER_USERNAME,
      twitterPassword: process.env.TWITTER_PASSWORD,
      twitterEmail: process.env.TWITTER_EMAIL
    };
    
    // Create database connector instance
    this.dbConnector = new TwitterDatabaseConnector();

    // Cookie path in top-level cookies directory
    this.cookiesPath = path.join(
      process.cwd(),
      'cookies',
      `${this.credentials.twitterUsername}_cookies.json`
    );

    // Enhanced configuration with fallback handling
    this.config = {
      twitter: {
        maxTweets: parseInt(process.env.MAX_TWEETS) || 50000,
        maxRetries: parseInt(process.env.MAX_RETRIES) || 5,
        retryDelay: parseInt(process.env.RETRY_DELAY) || 5000,
        minDelayBetweenRequests: parseInt(process.env.MIN_DELAY) || 1000,
        maxDelayBetweenRequests: parseInt(process.env.MAX_DELAY) || 3000,
        rateLimitThreshold: 3, // Number of rate limits before considering fallback
      },
      fallback: {
        enabled: true,
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
        generateAnalytics: true, // By default, generate analytics
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
    Logger.startSpinner("Validating credentials");
    
    // Check if credentials are available either in the object or environment variables
    const missingCredentials = [];
    
    if (!this.credentials.twitterUsername) {
      missingCredentials.push("TWITTER_USERNAME");
    }
    
    if (!this.credentials.twitterPassword) {
      missingCredentials.push("TWITTER_PASSWORD");
    }

    if (missingCredentials.length > 0) {
      Logger.stopSpinner(false);
      Logger.error("Missing required Twitter credentials:");
      missingCredentials.forEach((cred) => Logger.error(`- ${cred}`));
      console.log("\n📝 Please provide valid Twitter credentials.");
      console.log("You can either:");
      console.log("1. Create a .env file with your Twitter credentials:");
      console.log(`   TWITTER_USERNAME=your_username`);
      console.log(`   TWITTER_PASSWORD=your_password`);
      console.log("2. Or pass credentials via the API request body");
      throw new Error("Missing Twitter credentials");
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

    while (retryCount < this.config.twitter.maxRetries) {
      try {
        const cookiesLoaded = await this.loadCookies();

        if (!cookiesLoaded) {
          // Use credentials from the object instead of directly from env vars
          await this.scraper.login(
            this.credentials.twitterUsername,
            this.credentials.twitterPassword,
            this.credentials.twitterEmail
          );
          await this.saveCookies();
        }

        // Verify authentication worked
        const isLoggedIn = await this.scraper.isLoggedIn();
        if (!isLoggedIn) {
          Logger.warn("Cookie-based authentication failed, logging in again");
          
          // Use credentials from the object instead of directly from env vars
          await this.scraper.login(
            this.credentials.twitterUsername,
            this.credentials.twitterPassword,
            this.credentials.twitterEmail
          );
          await this.saveCookies();
        }

        Logger.stopSpinner();
        Logger.success("Twitter authentication successful");
        return true;
      } catch (error) {
        retryCount++;
        Logger.stopSpinner(false);
        Logger.warn(
          `Failed to initialize scraper (attempt ${retryCount}/${this.config.twitter.maxRetries}): ${error.message}`
        );

        if (retryCount < this.config.twitter.maxRetries) {
          Logger.info(`Retrying in ${this.config.twitter.retryDelay / 1000} seconds...`);
          await new Promise((r) => setTimeout(r, this.config.twitter.retryDelay));
        } else {
          Logger.error(
            `Failed to initialize scraper after ${this.config.twitter.maxRetries} attempts`
          );
          throw error;
        }
      }
    }
  }

  async randomDelay(min, max) {
    // Gaussian distribution for more natural delays
    const gaussianRand = () => {
      let rand = 0;
      for (let i = 0; i < 6; i++) rand += Math.random();
      return rand / 6;
    };

    const delay = Math.floor(min + gaussianRand() * (max - min));
    Logger.info(`Waiting ${(delay / 1000).toFixed(1)} seconds...`);
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  async handleRateLimit(retryCount = 1) {
    this.stats.rateLimitHits++;
    const baseDelay = 60000; // 1 minute
    const maxDelay = 15 * 60 * 1000; // 15 minutes

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
          process.env.TWITTER_USERNAME
        );
        await this.randomDelay(500, 1000);
        await page.click('div[role="button"]:not([aria-label])');
        await this.randomDelay(500, 1000);
        await page.type('input[type="password"]', process.env.TWITTER_PASSWORD);
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

      // Try main collection first
      try {
        const searchResults = scraper.searchTweets(
          `from:${this.username}`,
          this.config.twitter.maxTweets,
          SearchMode.Latest
        );

        for await (const tweet of searchResults) {
          if (tweet && !allTweets.has(tweet.id)) {
            const processedTweet = this.processTweetData(tweet);
            if (processedTweet) {
              allTweets.set(tweet.id, processedTweet);

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
      } catch (error) {
        if (error.message.includes("rate limit")) {
          await this.handleRateLimit(this.stats.rateLimitHits + 1);

          // Consider fallback if rate limits are frequent
          if (
            this.stats.rateLimitHits >= this.config.twitter.rateLimitThreshold
          ) {
            Logger.info("Switching to fallback collection...");
            const fallbackTweets = await this.collectWithFallback(
              `from:${this.username}`
            );

            fallbackTweets.forEach((tweet) => {
              if (!allTweets.has(tweet.id)) {
                const processedTweet = this.processTweetData(tweet);
                if (processedTweet) {
                  allTweets.set(tweet.id, processedTweet);
                  this.stats.fallbackUsed = true;
                }
              }
            });
          }
        }
        Logger.warn(`⚠️  Search error: ${error.message}`);
      }

      // Use fallback for replies if needed
      if (
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

      Logger.success(
        `\n🎉 Collection complete! ${allTweets.size.toLocaleString()} unique tweets collected${
          this.stats.fallbackUsed
            ? ` (including ${this.stats.fallbackCount} from fallback)`
            : ""
        }`
      );

      return {
        tweets: Array.from(allTweets.values()),
        user: profile
      };
    } catch (error) {
      Logger.error(`Failed to collect tweets: ${error.message}`);
      throw error;
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
      Logger.success(`✅ Successfully stored ${result.savedCount} tweets in database`);
      
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
    this.stats.startTime = startTime;

    console.log("\n" + chalk.bold.blue("🐦 Twitter Data Collection Pipeline"));
    console.log(
      chalk.bold(`Target Account: ${chalk.cyan("@" + this.username)}\n`)
    );

    try {
      // Check for required credentials
      await this.validateEnvironment();
      
      // Initialize the Twitter scraper
      const scraperInitialized = await this.initializeScraper();
      
      if (!scraperInitialized && !this.config.fallback.enabled) {
        throw new Error(
          "Failed to initialize scraper and fallback is disabled"
        );
      }
      
      // Collect tweets using available methods
      let allTweets = [];
      let userData = null;
      
      // Try main scraper first
      if (scraperInitialized) {
        try {
          const result = await this.collectTweets(this.scraper);
          allTweets = result.tweets;
          userData = result.user;
        } catch (error) {
          Logger.warn(`Main scraper failed: ${error.message}`);
          
          if (this.config.fallback.enabled) {
            Logger.info("Switching to fallback collection method");
            this.stats.fallbackUsed = true;
          } else {
            throw error;
          }
        }
      }
      
      // Use fallback method if needed and enabled
      if (allTweets.length === 0 && this.config.fallback.enabled) {
        Logger.info("Using fallback collection method");
        this.stats.fallbackUsed = true;
        
        try {
          const result = await this.collectWithFallback(`from:${this.username}`);
          allTweets = result.tweets;
          userData = result.user || userData;
        } catch (fallbackError) {
          Logger.error(`Fallback collection failed: ${fallbackError.message}`);
          throw fallbackError;
        }
      }
      
      // Store in database if we found any tweets
      if (allTweets.length > 0 && this.dbConnector) {
        try {
          await this.storeInDatabase(allTweets, userData);
        } catch (dbError) {
          Logger.error(`Failed to store in database: ${dbError.message}`);
          // Continue execution, just log the error
          await this.logError(dbError, { stage: "database_storage" });
        }
      }
      
      // Show sample of collected tweets
      if (allTweets.length > 0) {
        await this.showSampleTweets(allTweets);
      } else {
        Logger.warn("No tweets were collected");
      }
      
      // Calculate final statistics
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      const tweetsPerMinute = (allTweets.length / (duration / 60)).toFixed(1);
      const successRate = (
        (allTweets.length / this.stats.requestCount) * 100 || 0
      ).toFixed(1);
      
      // Display statistics
      console.log("\n" + chalk.bold("📊 Collection Statistics:"));
      console.log(chalk.cyan(`✓ Total Tweets: ${allTweets.length.toLocaleString()}`));
      console.log(chalk.cyan(`✓ Duration: ${duration}s`));
      console.log(chalk.cyan(`✓ Rate: ${tweetsPerMinute} tweets/minute`));
      console.log(chalk.cyan(`✓ Success Rate: ${successRate}%`));
      console.log(chalk.cyan(`✓ Fallback Used: ${this.stats.fallbackUsed ? "Yes" : "No"}`));
      console.log("\n");
      
      // Clean up resources
      await this.cleanup();
      
      return { tweets: allTweets, user: userData };
    } catch (error) {
      Logger.error(`Pipeline execution failed: ${error.message}`);
      
      // Log detailed error info
      await this.logError(error, {
        username: this.username,
        stage: "pipeline_execution",
        runtime: (Date.now() - startTime) / 1000,
        stats: this.stats,
      });
      
      // Clean up resources
      await this.cleanup();
      
      // Re-throw the error for handling by the caller
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
import fp from 'fastify-plugin';
import { Queue, Worker, QueueEvents } from 'bullmq';
import path from 'path';
import { fileURLToPath } from 'url';
import { In } from 'typeorm';

// For ES modules support
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Custom job failure manager to handle different types of failures
 * 
 * @param {String} message - Error message
 * @param {Object} options - Options
 * @returns {Object} - Error object with metadata
 */
function createJobFailure(message, options = {}) {
  return {
    isJobFailure: true,
    message,
    type: options.type || 'general',
    shouldRetry: options.shouldRetry !== undefined ? options.shouldRetry : true,
    timestamp: new Date().toISOString(),
    details: options.details || null
  };
}

/**
 * Setup a timeout to detect when tweet collection is stuck
 * 
 * @param {Object} job - The BullMQ job
 * @param {FastifyInstance} fastify - Fastify instance
 * @param {Number} timeoutMs - Timeout in milliseconds
 * @returns {Object} - Timer and cleanup function
 */
function setupCollectionTimeout(job, fastify, timeoutMs = 30000) {
  // Create a key for this job's progress tracking
  const progressKey = `progress:${job.id}`;
  let lastTweetCount = 0;
  let stuckTime = 0;
  const startTime = Date.now();
  
  // Store initial progress
  fastify.redis.set(progressKey, JSON.stringify({
    tweetCount: 0,
    lastUpdate: Date.now(),
    status: 'collecting'
  }), 'EX', 3600); // 1 hour expiry
  
  // Setup the interval to check progress
  const timer = setInterval(async () => {
    try {
      // Get current progress
      const progressData = await fastify.redis.get(progressKey);
      if (!progressData) return; // Job might be done already
      
      const progress = JSON.parse(progressData);
      const currentTime = Date.now();
      
      // If status is no longer collecting, clear the interval
      if (progress.status !== 'collecting') {
        clearInterval(timer);
        return;
      }
      
      // Check if tweet count has increased
      if (progress.tweetCount === lastTweetCount) {
        // If no progress, increment stuck time
        stuckTime += currentTime - Math.max(progress.lastUpdate, startTime);
        
        // If stuck for too long, mark job as rate limited
        if (stuckTime >= timeoutMs) {
          fastify.log.warn(`Job ${job.id} appears to be stuck for ${timeoutMs/1000}s. Likely rate limited.`);
          
          // Update progress status to rate-limited
          await fastify.redis.set(progressKey, JSON.stringify({
            ...progress,
            lastUpdate: currentTime,
            status: 'rate-limited'
          }), 'EX', 3600);
          
          // Clear the interval
          clearInterval(timer);
        }
      } else {
        // Reset stuck time if progress was made
        stuckTime = 0;
        lastTweetCount = progress.tweetCount;
        
        // Update last check time
        await fastify.redis.set(progressKey, JSON.stringify({
          ...progress,
          lastUpdate: currentTime
        }), 'EX', 3600);
      }
    } catch (error) {
      fastify.log.error(`Error checking job progress: ${error.message}`);
    }
  }, 5000); // Check every 5 seconds
  
  // Return both the timer and an update function
  return {
    timer,
    updateProgress: async (tweetCount) => {
      try {
        const progressData = await fastify.redis.get(progressKey);
        if (!progressData) return;
        
        const progress = JSON.parse(progressData);
        await fastify.redis.set(progressKey, JSON.stringify({
          ...progress,
          tweetCount,
          lastUpdate: Date.now()
        }), 'EX', 3600);
      } catch (error) {
        fastify.log.error(`Error updating job progress: ${error.message}`);
      }
    },
    clearTimeout: () => {
      clearInterval(timer);
      fastify.redis.del(progressKey).catch(() => {});
    }
  };
}

/**
 * BullMQ queue plugin for Fastify
 * 
 * @param {FastifyInstance} fastify - Fastify instance
 * @param {Object} options - Plugin options
 */
async function queuePlugin(fastify, options) {
  // Define queues
  const queues = {
    twitterScraper: new Queue('twitter-scraper', {
      connection: fastify.redis,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000
        },
        removeOnComplete: 100,
        removeOnFail: 200
      }
    }),
    tweetProcessor: new Queue('tweet-processor', {
      connection: fastify.redis,
      defaultJobOptions: {
        attempts: 2,
        backoff: {
          type: 'fixed',
          delay: 5000
        }
      }
    })
  };

  // Create worker for Twitter scraper queue
  const twitterScraperWorker = new Worker(
    'twitter-scraper',
    async (job) => {
      fastify.log.info(`Processing job ${job.id} to scrape tweets for @${job.data.username}`);
      
      // Import TwitterPipeline dynamically
      const { default: TwitterPipeline } = await import('../../src/twitter/TwitterPipeline.js');
      
      // Check immediately if this job should be processed at all
      const nonRetriableKey = `non-retriable:${job.id}`;
      const isNonRetriable = await fastify.redis.get(nonRetriableKey);
      
      if (isNonRetriable) {
        // Job was previously marked as non-retriable
        // Instead of throwing an error, let's finalize this job without running it
        fastify.log.warn(`Job ${job.id} was previously marked as non-retriable and will not run`);
        
        // Intentionally skip this job by returning a completed status that shows it was skipped
        return {
          status: 'skipped',
          reason: 'Previously marked as non-retriable',
          username: job.data.username
        };
      }
      
      // Setup collection timeout detection (30 seconds of no progress = rate limited)
      const timeout = setupCollectionTimeout(job, fastify, 30000);
      
      try {
        // Check if the job has previously been marked as rate-limited
        const progressKey = `progress:${job.id}`;
        const progressData = await fastify.redis.get(progressKey);
        if (progressData) {
          const progress = JSON.parse(progressData);
          if (progress.status === 'rate-limited') {
            timeout.clearTimeout();
            fastify.log.warn(`Job ${job.id} was previously rate-limited, failing to prevent further retries`);
            throw new Error(JSON.stringify(createJobFailure("Twitter API rate limit detected. Collection was stuck.", {
              type: 'rate-limited',
              shouldRetry: false,
              details: {
                username: job.data.username,
                stuckAt: progress.lastUpdate
              }
            })));
          }
        }
        
        // Extract Twitter credentials from options if provided
        const credentials = {
          username: job.data.options?.credentials?.username,
          password: job.data.options?.credentials?.password,
          email: job.data.options?.credentials?.email
        };
        
        // Create pipeline instance with credentials and options merged
        const pipeline = new TwitterPipeline(job.data.username, {
          credentials,
          ...job.data.options
        });
        
        // Set any custom options from the job data
        if (job.data.options) {
          Object.keys(job.data.options).forEach(key => {
            if (key in pipeline.config.twitter) {
              pipeline.config.twitter[key] = job.data.options[key];
            }
          });
        }
        
        // First check if we can authenticate with Twitter
        fastify.log.info(`Verifying Twitter authentication for job ${job.id}`);
        await pipeline.validateEnvironment();
        const authSuccess = await pipeline.initializeScraper();
        
        if (!authSuccess) {
          timeout.clearTimeout();
          // Authentication failed after maximum retries - fail the job immediately
          const errorMsg = `Authentication failed for Twitter credentials. Job marked as failed.`;
          fastify.log.error(errorMsg);
          
          // Mark this job as non-retriable in Redis with 24-hour expiry
          await fastify.redis.set(nonRetriableKey, '1', 'EX', 86400); 
          
          // Mark this as an authentication failure that should not be retried
          throw new Error(JSON.stringify(createJobFailure(errorMsg, {
            type: 'authentication',
            shouldRetry: false,
            details: {
              username: job.data.username,
              credentialsProvided: !!job.data.options?.credentials
            }
          })));
        }
        
        fastify.log.info(`Authentication successful, proceeding with job ${job.id}`);
        
        // Add a progress tracking hook to the pipeline
        const originalCollectTweets = pipeline.collectTweets.bind(pipeline);
        pipeline.collectTweets = async function(scraper) {
          // Keep track of tweet collection progress
          let lastCount = 0;
          
          // Create an interval to check progress
          const progressInterval = setInterval(() => {
            if (this.stats.uniqueTweets > lastCount) {
              // Update progress in our timeout tracker
              timeout.updateProgress(this.stats.uniqueTweets);
              lastCount = this.stats.uniqueTweets;
            }
          }, 2000);
          
          try {
            // Call the original collectTweets method
            const result = await originalCollectTweets(scraper);
            
            // Clean up the interval
            clearInterval(progressInterval);
            
            return result;
          } catch (error) {
            // Clean up the interval
            clearInterval(progressInterval);
            
            // Check if this was a rate limit error
            if (error.message.includes('rate limit') || 
                error.message.includes('exceeded') || 
                error.message.includes('too many requests')) {
              // Mark as rate limited
              await fastify.redis.set(progressKey, JSON.stringify({
                tweetCount: lastCount,
                lastUpdate: Date.now(),
                status: 'rate-limited',
                error: error.message
              }), 'EX', 3600);
            }
            
            throw error;
          }
        };
        
        // Run the pipeline to get tweets
        const { tweets, user: scrapedUserData, error } = await pipeline.run();
        
        // Clear the timeout now that we've completed
        timeout.clearTimeout();
        
        // Check if collection was interrupted by rate limiting
        const currentProgress = await fastify.redis.get(progressKey);
        if (currentProgress) {
          const progress = JSON.parse(currentProgress);
          if (progress.status === 'rate-limited') {
            throw new Error(JSON.stringify(createJobFailure("Twitter API rate limit detected. Collection stopped.", {
              type: 'rate-limited',
              shouldRetry: false,
              details: {
                username: job.data.username,
                stuckAt: progress.lastUpdate,
                tweetsCollected: tweets?.length || 0
              }
            })));
          }
        }
        
        // Check if pipeline reported an error but didn't throw (like auth failure)
        if (error && error.type === 'authentication') {
          throw new Error(JSON.stringify(createJobFailure(error.message, {
            type: 'authentication',
            shouldRetry: false,
            details: {
              username: job.data.username,
              credentialsProvided: !!job.data.options?.credentials
            }
          })));
        }
        
        // If we have no tweets, might be an issue
        if (!tweets || tweets.length === 0) {
          // Check if it's a public profile but we got no tweets
          if (scrapedUserData && scrapedUserData.statusesCount > 0) {
            fastify.log.warn(`No tweets collected for @${job.data.username} despite user having ${scrapedUserData.statusesCount} tweets`);
            
            // This might be a sign of rate limiting or other issues
            if (pipeline.stats.rateLimitHits > 0) {
              throw new Error(JSON.stringify(createJobFailure("Possible Twitter API rate limit. No tweets collected.", {
                type: 'rate-limited',
                shouldRetry: false,
                details: {
                  username: job.data.username,
                  rateLimitHits: pipeline.stats.rateLimitHits,
                  knownTweetCount: scrapedUserData.statusesCount
                }
              })));
            }
          }
        }
        
        // Store in database if flag is set
        let dbResult = null;
        if (job.data.storeInDatabase) {
          dbResult = await storeTweetsInDatabase(fastify, job.data.username, tweets, scrapedUserData);
        }
        
        // Return the results
        return {
          status: 'success',
          username: job.data.username,
          tweetCount: tweets?.length || 0,
          database: dbResult ? {
            savedCount: dbResult.savedCount,
            skippedCount: dbResult.skippedCount || 0
          } : null
        };
      } catch (error) {
        // Make sure to clean up the timeout
        timeout.clearTimeout();
        
        fastify.log.error(`Failed to scrape tweets for @${job.data.username}: ${error.message}`);
        throw error;
      }
    },
    { connection: fastify.redis }
  );

  // Create worker for tweet processor queue
  const tweetProcessorWorker = new Worker(
    'tweet-processor',
    async (job) => {
      fastify.log.info(`Processing tweets for further analysis: ${job.id}`);
      
      try {
        // Handle different processing actions
        switch (job.data.action) {
          case 'generate-analytics':
            return await generateAnalytics(fastify, job.data.username, job.data.userId);
          case 'generate-finetuning':
            return await generateFinetuningData(fastify, job.data.username, job.data.userId);
          default:
            throw new Error(`Unknown tweet processing action: ${job.data.action}`);
        }
      } catch (error) {
        fastify.log.error(`Failed to process tweets: ${error.message}`);
        throw error;
      }
    },
    { connection: fastify.redis }
  );

  // Handle worker events
  twitterScraperWorker.on('completed', (job) => {
    fastify.log.info(`Twitter scraper job ${job.id} completed successfully`);
  });

  twitterScraperWorker.on('failed', async (job, err) => {
    fastify.log.error(`Twitter scraper job ${job?.id} failed: ${err.message}`);
    
    try {
      // If job is null or undefined, nothing we can do
      if (!job) return;
      
      let shouldDiscard = false;
      let failureType = 'general';
      
      // Check if the job is marked with _noRetry flag
      if (job?.data?._noRetry) {
        shouldDiscard = true;
        fastify.log.warn(`Job ${job.id} has _noRetry flag set, will not be retried`);
      }
      
      // Check if this is a structured failure using our custom format
      try {
        const errorData = JSON.parse(err.message);
        if (errorData && errorData.isJobFailure) {
          failureType = errorData.type;
          
          // If this is an authentication failure, rate limit, or other non-retriable error
          if (!errorData.shouldRetry || 
              errorData.type === 'authentication' || 
              errorData.type === 'rate-limited') {
            shouldDiscard = true;
            fastify.log.warn(`Job ${job?.id} will not be retried: ${errorData.type} failure`);
          }
        }
      } catch (e) {
        // Not a JSON error, check for rate limit text
        if (err.message.includes('rate limit') || 
            err.message.includes('rate-limited') ||
            err.message.includes('too many requests')) {
          shouldDiscard = true;
          failureType = 'rate-limited';
          fastify.log.warn(`Job ${job?.id} will not be retried: rate limit detected in error message`);
        }
      }
      
      // If we should discard the job
      if (shouldDiscard) {
        // Set a flag in Redis to prevent further retries (regardless of job state)
        const nonRetriableKey = `non-retriable:${job.id}`;
        await fastify.redis.set(nonRetriableKey, '1', 'EX', 86400);
        
        // If this was a rate limit, save the information
        if (failureType === 'rate-limited') {
          // Save rate limit information - this could be used to implement a backoff strategy
          // for the specific user or globally
          const rateLimitKey = `rate-limit:${job.data.username}`;
          await fastify.redis.set(rateLimitKey, Date.now().toString(), 'EX', 3600);
          
          // Increment global rate limit counter for monitoring
          await fastify.redis.incr('rate-limit-count').catch(() => {});
        }
        
        try {
          // Check current job state before attempting to modify it
          const jobState = await job.getState();
          
          if (jobState === 'active' || jobState === 'waiting' || jobState === 'delayed') {
            // Only try to moveToFailed if the job is in a state where it makes sense
            fastify.log.info(`Moving job ${job.id} to failed state with max attempts`);
            
            await job.moveToFailed(
              { message: err.message },
              job.opts.attempts || 3, // Use max attempts to prevent further retries
              true // Pass true to remove the job from active
            );
          } else {
            fastify.log.info(`Job ${job.id} is already in ${jobState} state, not moving to failed`);
            
            // If the job is stuck somehow, try updating it
            if (jobState === 'stuck') {
              try {
                // Try to update job data to mark it as non-retriable
                await job.updateData({
                  ...job.data,
                  _noRetry: true
                });
              } catch (updateErr) {
                fastify.log.warn(`Couldn't update stuck job data: ${updateErr.message}`);
              }
            }
          }
        } catch (moveErr) {
          // Handle the error without crashing
          fastify.log.warn(`Error moving job ${job.id} to failed state: ${moveErr.message}`);
          
          // If moveToFailed fails, try to clean up the job another way
          try {
            // Try to discard the job if possible
            await job.discard();
            fastify.log.info(`Successfully discarded job ${job.id}`);
          } catch (discardErr) {
            fastify.log.warn(`Couldn't discard job ${job.id}: ${discardErr.message}`);
            
            // As a last resort, try to remove the job entirely
            try {
              await job.remove();
              fastify.log.info(`Removed job ${job.id} as a last resort`);
            } catch (removeErr) {
              fastify.log.warn(`Couldn't remove job ${job.id}: ${removeErr.message}`);
            }
          }
        }
      }
    } catch (e) {
      fastify.log.error(`Error handling job failure: ${e.message}`);
    }
  });

  tweetProcessorWorker.on('completed', (job) => {
    fastify.log.info(`Tweet processor job ${job.id} completed successfully`);
  });

  tweetProcessorWorker.on('failed', (job, err) => {
    fastify.log.error(`Tweet processor job ${job?.id} failed: ${err.message}`);
  });

  // Register queues with Fastify
  fastify.decorate('queues', queues);

  // Add a hook to close all queues when Fastify closes
  fastify.addHook('onClose', async (instance) => {
    fastify.log.info('Closing queue connections');
    await Promise.all([
      twitterScraperWorker.close(),
      tweetProcessorWorker.close(),
      ...Object.values(queues).map(queue => queue.close())
    ]);
  });
}

/**
 * Store scraped tweets in the database
 * 
 * @param {FastifyInstance} fastify - Fastify instance
 * @param {string} username - Twitter username
 * @param {Array} tweets - Array of scraped tweets
 * @param {Object} userData - Scraped user data
 */
async function storeTweetsInDatabase(fastify, username, tweets = [], userData = {}) {
  try {
    // Get repositories
    const userRepo = fastify.repositories.user;
    const tweetRepo = fastify.repositories.tweet;
    
    // Find or create the user
    let user = await userRepo.findOne({ where: { username } });
    
    if (!user) {
      fastify.log.warn(`User ${username} not found in database. Creating new record.`);
      user = userRepo.create({ username });
    }
    
    // Update user data from scraped info
    if (userData) {
      user.displayName = userData.name || userData.displayName;
      user.profileImageUrl = userData.profileImageUrl;
      user.bio = userData.description || userData.bio;
      user.location = userData.location;
      user.url = userData.url;
      user.followersCount = userData.followersCount;
      user.followingCount = userData.followingCount;
      user.tweetCount = userData.statusesCount || userData.tweetCount;
      user.verified = userData.verified || false;
      user.protected = userData.protected || false;
      user.joinedAt = userData.createdAt || userData.joinedAt;
      user.lastScrapedAt = new Date();
    }
    
    // Save user record
    await userRepo.save(user);
    fastify.log.info(`Saved user ${username} with ID ${user.id}`);
    
    // Extract all tweet IDs for more efficient lookup
    const allTweetIds = tweets.map(tweet => tweet.id_str || tweet.id);
    
    // Find existing tweets to avoid duplicates
    const existingTweets = await tweetRepo.find({
      where: { tweetId: In(allTweetIds) },
      select: ['tweetId']
    }).then(results => new Set(results.map(t => t.tweetId)));
    
    fastify.log.info(`Found ${existingTweets.size} existing tweets that will be skipped`);
    
    // Process tweets in batches to avoid memory issues
    const batchSize = 100;
    let totalSaved = 0;
    let totalSkipped = 0;
    
    for (let i = 0; i < tweets.length; i += batchSize) {
      const batch = tweets.slice(i, i + batchSize);
      const batchEntities = [];
      
      // Process each tweet in batch
      for (const tweet of batch) {
        const tweetId = tweet.id_str || tweet.id;
        
        // Skip if tweet already exists in database
        if (existingTweets.has(tweetId)) {
          totalSkipped++;
          continue;
        }
        
        // Parse tweet data
        const tweetData = parseTweetForDatabase(tweet, user.id);
        
        // Create tweet entity
        batchEntities.push(tweetRepo.create(tweetData));
      }
      
      if (batchEntities.length > 0) {
        // Save batch
        try {
          await tweetRepo.save(batchEntities);
          totalSaved += batchEntities.length;
          
          fastify.log.info(`Saved batch of ${batchEntities.length} tweets, progress: ${totalSaved}/${tweets.length - totalSkipped}`);
        } catch (error) {
          // Check if it's a unique constraint violation
          if (error.code === '23505' || error.message.includes('duplicate key') || error.message.includes('unique constraint')) {
            fastify.log.warn(`Encountered duplicate tweets in batch. Switching to one-by-one processing.`);
            
            // Fall back to one-by-one processing for this batch
            for (const entity of batchEntities) {
              try {
                await tweetRepo.save(entity);
                totalSaved++;
              } catch (saveError) {
                if (saveError.code === '23505' || saveError.message.includes('duplicate key') || saveError.message.includes('unique constraint')) {
                  fastify.log.debug(`Skipped duplicate tweet: ${entity.tweetId}`);
                  totalSkipped++;
                } else {
                  // Re-throw any other error
                  throw saveError;
                }
              }
            }
            
            fastify.log.info(`Completed one-by-one processing. Progress: ${totalSaved}/${tweets.length - totalSkipped}`);
          } else {
            // Re-throw any other error
            throw error;
          }
        }
      } else {
        fastify.log.info(`No new tweets to save in this batch, all were duplicates`);
      }
    }
    
    fastify.log.info(`Successfully saved ${totalSaved} tweets for user ${username}, skipped ${totalSkipped} existing tweets`);
    
    return {
      status: 'success',
      username,
      savedCount: totalSaved,
      skippedCount: totalSkipped
    };
  } catch (error) {
    fastify.log.error(`Failed to store tweets in database: ${error.message}`);
    throw error;
  }
}

/**
 * Parse a tweet object for database storage
 * 
 * @param {Object} tweet - Tweet object from the scraper
 * @param {string} userId - Database user ID
 * @returns {Object} - Parsed tweet object ready for database
 */
function parseTweetForDatabase(tweet, userId) {
  // Extract relevant fields
  return {
    userId: userId,
    tweetId: tweet.id_str || tweet.id,
    text: tweet.text || tweet.full_text || '',
    fullText: tweet.full_text || tweet.text || '',
    lang: tweet.lang,
    type: determineTweetType(tweet),
    replyToTweetId: tweet.in_reply_to_status_id_str,
    replyToUserId: tweet.in_reply_to_user_id_str,
    replyToUsername: tweet.in_reply_to_screen_name,
    retweetedTweetId: tweet.retweeted_status?.id_str,
    retweetedUserId: tweet.retweeted_status?.user?.id_str,
    retweetedUsername: tweet.retweeted_status?.user?.screen_name,
    quotedTweetId: tweet.quoted_status?.id_str,
    quotedUserId: tweet.quoted_status?.user?.id_str,
    quotedUsername: tweet.quoted_status?.user?.screen_name,
    quotedText: tweet.quoted_status?.text || tweet.quoted_status?.full_text,
    likeCount: tweet.favorite_count || 0,
    retweetCount: tweet.retweet_count || 0,
    replyCount: tweet.reply_count || 0,
    quoteCount: tweet.quote_count || 0,
    viewCount: tweet.view_count,
    urls: extractUrls(tweet),
    hashtags: extractHashtags(tweet),
    mentions: extractMentions(tweet),
    media: extractMedia(tweet),
    conversationId: tweet.conversation_id_str || tweet.conversation_id,
    postedAt: tweet.created_at ? new Date(tweet.created_at) : null,
    rawJson: tweet // Store the full tweet JSON for future reference
  };
}

/**
 * Determine the type of tweet
 * 
 * @param {Object} tweet - Tweet object
 * @returns {string} - Tweet type (original, reply, retweet, quote)
 */
function determineTweetType(tweet) {
  if (tweet.retweeted_status) {
    return 'retweet';
  } else if (tweet.quoted_status) {
    return 'quote';
  } else if (tweet.in_reply_to_status_id_str) {
    return 'reply';
  } else {
    return 'original';
  }
}

/**
 * Extract URLs from a tweet
 * 
 * @param {Object} tweet - Tweet object
 * @returns {Array} - Array of URL objects
 */
function extractUrls(tweet) {
  const urls = [];
  
  // Check entities
  if (tweet.entities?.urls?.length) {
    urls.push(...tweet.entities.urls.map(url => ({
      url: url.url,
      expanded_url: url.expanded_url,
      display_url: url.display_url
    })));
  }
  
  // Check extended_entities
  if (tweet.extended_entities?.urls?.length) {
    urls.push(...tweet.extended_entities.urls.map(url => ({
      url: url.url,
      expanded_url: url.expanded_url,
      display_url: url.display_url
    })));
  }
  
  return urls.length > 0 ? urls : null;
}

/**
 * Extract hashtags from a tweet
 * 
 * @param {Object} tweet - Tweet object
 * @returns {Array} - Array of hashtag objects
 */
function extractHashtags(tweet) {
  if (tweet.entities?.hashtags?.length) {
    return tweet.entities.hashtags.map(tag => ({
      text: tag.text
    }));
  }
  return null;
}

/**
 * Extract mentions from a tweet
 * 
 * @param {Object} tweet - Tweet object
 * @returns {Array} - Array of mention objects
 */
function extractMentions(tweet) {
  if (tweet.entities?.user_mentions?.length) {
    return tweet.entities.user_mentions.map(mention => ({
      user_id: mention.id_str,
      username: mention.screen_name,
      name: mention.name
    }));
  }
  return null;
}

/**
 * Extract media from a tweet
 * 
 * @param {Object} tweet - Tweet object
 * @returns {Array} - Array of media objects
 */
function extractMedia(tweet) {
  const media = [];
  
  // Check entities
  if (tweet.entities?.media?.length) {
    media.push(...tweet.entities.media.map(m => ({
      id: m.id_str,
      type: m.type,
      url: m.url,
      media_url: m.media_url_https || m.media_url,
      display_url: m.display_url
    })));
  }
  
  // Check extended_entities
  if (tweet.extended_entities?.media?.length) {
    media.push(...tweet.extended_entities.media.map(m => ({
      id: m.id_str,
      type: m.type,
      url: m.url,
      media_url: m.media_url_https || m.media_url,
      display_url: m.display_url,
      video_info: m.video_info
    })));
  }
  
  return media.length > 0 ? media : null;
}

/**
 * Generate analytics for a user's tweets
 * 
 * @param {FastifyInstance} fastify - Fastify instance
 * @param {string} username - Twitter username
 * @param {string} userId - Database user ID
 * @returns {Object} - Analytics results
 */
async function generateAnalytics(fastify, username, userId) {
  try {
    // Get repositories
    const userRepo = fastify.repositories.user;
    const tweetRepo = fastify.repositories.tweet;
    const analyticsRepo = fastify.repositories.analytics;
    
    // Find the user
    const user = await userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new Error(`User with ID ${userId} not found`);
    }
    
    // Get all user's tweets
    const tweets = await tweetRepo.find({ where: { userId } });
    
    if (tweets.length === 0) {
      throw new Error(`No tweets found for user ${username}`);
    }
    
    // Compute analytics
    const analytics = {
      userId,
      tweetCount: tweets.length,
      originalTweetCount: tweets.filter(t => t.type === 'original').length,
      replyCount: tweets.filter(t => t.type === 'reply').length,
      retweetCount: tweets.filter(t => t.type === 'retweet').length,
      quoteCount: tweets.filter(t => t.type === 'quote').length,
      withMediaCount: tweets.filter(t => t.media).length,
      withImagesCount: tweets.filter(t => t.media && t.media.some(m => m.type === 'photo')).length,
      withVideosCount: tweets.filter(t => t.media && t.media.some(m => ['video', 'animated_gif'].includes(m.type))).length,
      withLinksCount: tweets.filter(t => t.urls).length,
      withHashtagsCount: tweets.filter(t => t.hashtags).length,
      withMentionsCount: tweets.filter(t => t.mentions).length,
      
      // Engagement metrics
      totalLikes: tweets.reduce((sum, t) => sum + (t.likeCount || 0), 0),
      totalRetweets: tweets.reduce((sum, t) => sum + (t.retweetCount || 0), 0),
      totalReplies: tweets.reduce((sum, t) => sum + (t.replyCount || 0), 0),
      totalQuotes: tweets.reduce((sum, t) => sum + (t.quoteCount || 0), 0),
      
      // Average engagement
      averageLikes: tweets.length > 0 ? 
        tweets.reduce((sum, t) => sum + (t.likeCount || 0), 0) / tweets.length : 0,
      averageRetweets: tweets.length > 0 ? 
        tweets.reduce((sum, t) => sum + (t.retweetCount || 0), 0) / tweets.length : 0,
      averageReplies: tweets.length > 0 ? 
        tweets.reduce((sum, t) => sum + (t.replyCount || 0), 0) / tweets.length : 0,
      averageQuotes: tweets.length > 0 ? 
        tweets.reduce((sum, t) => sum + (t.quoteCount || 0), 0) / tweets.length : 0,
      
      // Time metrics
      oldestTweetDate: tweets.reduce((oldest, t) => 
        !oldest || (t.postedAt && t.postedAt < oldest) ? t.postedAt : oldest, null),
      newestTweetDate: tweets.reduce((newest, t) => 
        !newest || (t.postedAt && t.postedAt > newest) ? t.postedAt : newest, null),
      
      // Advanced analytics
      mostUsedHashtags: calculateMostUsedHashtags(tweets),
      mostMentionedUsers: calculateMostMentionedUsers(tweets),
      mostReactedTweets: calculateMostReactedTweets(tweets),
      postingFrequency: calculatePostingFrequency(tweets),
      postingDayDistribution: calculatePostingDayDistribution(tweets),
      postingTimeDistribution: calculatePostingTimeDistribution(tweets),
      languageDistribution: calculateLanguageDistribution(tweets),
      
      // Metadata
      lastUpdated: new Date(),
    };
    
    // Find existing analytics or create new one
    let analyticsEntity = await analyticsRepo.findOne({ where: { userId } });
    
    if (analyticsEntity) {
      // Update existing
      analyticsEntity = analyticsRepo.merge(analyticsEntity, analytics);
    } else {
      // Create new
      analyticsEntity = analyticsRepo.create(analytics);
    }
    
    // Save analytics
    await analyticsRepo.save(analyticsEntity);
    
    fastify.log.info(`Generated analytics for user ${username}`);
    
    return {
      status: 'success',
      username,
      analyticsId: analyticsEntity.id
    };
  } catch (error) {
    fastify.log.error(`Failed to generate analytics: ${error.message}`);
    throw error;
  }
}

/**
 * Calculate most used hashtags
 * 
 * @param {Array} tweets - Array of tweets
 * @returns {Object} - Hashtag distribution
 */
function calculateMostUsedHashtags(tweets) {
  const hashtags = {};
  
  // Count hashtags
  tweets.forEach(tweet => {
    if (tweet.hashtags) {
      tweet.hashtags.forEach(tag => {
        const text = tag.text.toLowerCase();
        hashtags[text] = (hashtags[text] || 0) + 1;
      });
    }
  });
  
  // Convert to array and sort
  const sorted = Object.entries(hashtags)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20); // Top 20
  
  return sorted.length > 0 ? sorted : null;
}

/**
 * Calculate most mentioned users
 * 
 * @param {Array} tweets - Array of tweets
 * @returns {Object} - User mention distribution
 */
function calculateMostMentionedUsers(tweets) {
  const mentions = {};
  
  // Count mentions
  tweets.forEach(tweet => {
    if (tweet.mentions) {
      tweet.mentions.forEach(mention => {
        const username = mention.username.toLowerCase();
        mentions[username] = (mentions[username] || 0) + 1;
      });
    }
  });
  
  // Convert to array and sort
  const sorted = Object.entries(mentions)
    .map(([username, count]) => ({ username, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20); // Top 20
  
  return sorted.length > 0 ? sorted : null;
}

/**
 * Calculate most reacted tweets
 * 
 * @param {Array} tweets - Array of tweets
 * @returns {Object} - Top reacted tweets
 */
function calculateMostReactedTweets(tweets) {
  // Copy and sort by total engagement
  const sortedTweets = [...tweets]
    .map(tweet => {
      const totalEngagement = 
        (tweet.likeCount || 0) + 
        (tweet.retweetCount || 0) + 
        (tweet.replyCount || 0) + 
        (tweet.quoteCount || 0);
      
      return {
        id: tweet.id,
        tweetId: tweet.tweetId,
        text: tweet.text,
        totalEngagement,
        likes: tweet.likeCount || 0,
        retweets: tweet.retweetCount || 0,
        replies: tweet.replyCount || 0,
        quotes: tweet.quoteCount || 0,
        postedAt: tweet.postedAt
      };
    })
    .sort((a, b) => b.totalEngagement - a.totalEngagement)
    .slice(0, 10); // Top 10
  
  return sortedTweets.length > 0 ? sortedTweets : null;
}

/**
 * Calculate posting frequency
 * 
 * @param {Array} tweets - Array of tweets
 * @returns {Object} - Posting frequency statistics
 */
function calculatePostingFrequency(tweets) {
  const tweetsWithDates = tweets.filter(tweet => tweet.postedAt);
  
  if (tweetsWithDates.length < 2) {
    return null;
  }
  
  // Sort by date
  const sortedTweets = [...tweetsWithDates].sort((a, b) => 
    a.postedAt.getTime() - b.postedAt.getTime()
  );
  
  const firstDate = new Date(sortedTweets[0].postedAt);
  const lastDate = new Date(sortedTweets[sortedTweets.length - 1].postedAt);
  
  // Calculate days between first and last tweet
  const daysDiff = Math.max(1, Math.ceil((lastDate - firstDate) / (1000 * 60 * 60 * 24)));
  
  return {
    totalTweets: tweetsWithDates.length,
    daysCovered: daysDiff,
    tweetsPerDay: parseFloat((tweetsWithDates.length / daysDiff).toFixed(2)),
    firstTweetDate: firstDate,
    lastTweetDate: lastDate
  };
}

/**
 * Calculate posting day distribution
 * 
 * @param {Array} tweets - Array of tweets
 * @returns {Object} - Day of week distribution
 */
function calculatePostingDayDistribution(tweets) {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const distribution = days.reduce((acc, day) => ({ ...acc, [day]: 0 }), {});
  
  // Count tweets by day of week
  tweets.forEach(tweet => {
    if (tweet.postedAt) {
      const day = days[tweet.postedAt.getDay()];
      distribution[day]++;
    }
  });
  
  return distribution;
}

/**
 * Calculate posting time distribution
 * 
 * @param {Array} tweets - Array of tweets
 * @returns {Object} - Hour of day distribution
 */
function calculatePostingTimeDistribution(tweets) {
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const distribution = hours.reduce((acc, hour) => ({ ...acc, [hour]: 0 }), {});
  
  // Count tweets by hour of day
  tweets.forEach(tweet => {
    if (tweet.postedAt) {
      const hour = tweet.postedAt.getUTCHours();
      distribution[hour]++;
    }
  });
  
  return distribution;
}

/**
 * Calculate language distribution
 * 
 * @param {Array} tweets - Array of tweets
 * @returns {Object} - Language distribution
 */
function calculateLanguageDistribution(tweets) {
  const languages = {};
  
  // Count languages
  tweets.forEach(tweet => {
    if (tweet.lang) {
      languages[tweet.lang] = (languages[tweet.lang] || 0) + 1;
    }
  });
  
  // Convert to array and sort
  const sorted = Object.entries(languages)
    .map(([lang, count]) => ({ lang, count }))
    .sort((a, b) => b.count - a.count);
  
  return sorted.length > 0 ? sorted : null;
}

/**
 * Generate fine-tuning data
 * 
 * @param {FastifyInstance} fastify - Fastify instance
 * @param {string} username - Twitter username
 * @param {string} userId - Database user ID
 * @returns {Object} - Fine-tuning results
 */
async function generateFinetuningData(fastify, username, userId) {
  try {
    // Get repositories
    const userRepo = fastify.repositories.user;
    const tweetRepo = fastify.repositories.tweet;
    
    // Find the user
    const user = await userRepo.findOne({ 
      where: { id: userId }
    });
    
    if (!user) {
      throw new Error(`User with ID ${userId} not found`);
    }
    
    // Get tweets for fine-tuning (only original and replies)
    const tweets = await tweetRepo.find({ 
      where: [
        { userId, type: 'original' },
        { userId, type: 'reply' }
      ],
      order: { postedAt: 'ASC' }
    });
    
    if (tweets.length === 0) {
      throw new Error(`No suitable tweets found for fine-tuning for user ${username}`);
    }
    
    fastify.log.info(`Generated fine-tuning data for user ${username}, ${tweets.length} tweets processed`);
    
    // Store the results
    const finetuningDataPath = path.join(process.cwd(), 'data', 'finetuning');
    
    // Import file system dynamically
    const fs = await import('fs/promises');
    
    // Create directory if it doesn't exist
    await fs.mkdir(finetuningDataPath, { recursive: true });
    
    // Write fine-tuning data
    const outputPath = path.join(finetuningDataPath, `${username}_finetuning.jsonl`);
    
    // Format tweets for fine-tuning
    const finetuningData = tweets.map(tweet => {
      let prompt = '';
      let completion = tweet.text;
      
      // If this is a reply, use the original tweet as prompt
      if (tweet.type === 'reply' && tweet.replyToTweetId) {
        // We could fetch the original tweet here if needed
        prompt = `Reply to: ${tweet.replyToTweetId}`;
      } else {
        // For original tweets, use empty prompt
        prompt = 'Write a tweet:';
      }
      
      return JSON.stringify({
        prompt,
        completion
      });
    });
    
    // Write to file as JSONL
    await fs.writeFile(outputPath, finetuningData.join('\n'));
    
    return {
      status: 'success',
      username,
      tweetCount: tweets.length,
      outputPath
    };
  } catch (error) {
    fastify.log.error(`Failed to generate fine-tuning data: ${error.message}`);
    throw error;
  }
}

export default fp(queuePlugin, {
  name: 'queue',
  dependencies: ['redis', 'database'],
  fastify: '4.x'
}); 
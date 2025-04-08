/**
 * Twitter Service - Handles business logic for Twitter operations
 */
class TwitterService {
  constructor(fastify) {
    this.fastify = fastify;
    this.redis = fastify.redis;
    this.queues = fastify.queues;
    this.db = fastify.db;
    this.repositories = fastify.repositories;
  }

  /**
   * Submit a job to scrape tweets for a specific user
   * 
   * @param {string} username - Twitter username to scrape
   * @param {Object} options - Custom options for scraping
   * @returns {Object} - Job information
   */
  async queueScrapeJob(username, options = {}) {
    // Check if the user is currently rate limited
    const rateLimitKey = `rate-limit:${username}`;
    const rateLimitTimestamp = await this.redis.get(rateLimitKey);
    
    if (rateLimitTimestamp) {
      const rateLimitTime = parseInt(rateLimitTimestamp);
      const now = Date.now();
      
      // Get rate limit duration from environment variable or use default (15 minutes)
      const rateLimitDuration = parseInt(process.env.RATE_LIMIT_DURATION) || 15 * 60 * 1000; // milliseconds
      
      if (!isNaN(rateLimitTime) && now - rateLimitTime < rateLimitDuration) {
        // User is still rate limited
        const remainingSeconds = Math.ceil((rateLimitTime + rateLimitDuration - now) / 1000);
        const estimatedEndTime = new Date(rateLimitTime + rateLimitDuration).toISOString();
        
        return {
          message: `Cannot start job for @${username} due to rate limiting`,
          status: 'rate_limited',
          details: {
            username,
            rateLimitedSince: new Date(rateLimitTime).toISOString(),
            rateLimitedUntil: estimatedEndTime,
            remainingSeconds
          }
        };
      }
    }
    
    // Check if job for this username is already running
    const activeJobs = await this.queues.twitterScraper.getActive();
    const existingJob = activeJobs.find(job => 
      job.data.username === username && 
      job.data.operation === 'scrape-twitter-user'
    );

    if (existingJob) {
      return {
        message: `A job for @${username} is already running`,
        jobId: existingJob.id,
        status: 'already_running'
      };
    }

    // Store or update the user in database
    await this.ensureUserExists(username);

    // Add job to queue with modified options
    const job = await this.queues.twitterScraper.add(
      'scrape-twitter-user',
      { 
        username, 
        options,
        operation: 'scrape-twitter-user',
        storeInDatabase: true // Flag to indicate we want to store in database
      },
      { 
        jobId: `twitter-${username}-${Date.now()}`,
        attempts: 3,
        removeOnComplete: true,
        removeOnFail: false, // Keep failed jobs for debugging
        backoff: {
          type: 'exponential',
          delay: 5000
        }
      }
    );
    
    return {
      message: `Started Twitter scraping job for @${username}`,
      jobId: job.id,
      status: 'queued'
    };
  }

  /**
   * Ensure the user exists in the database
   * 
   * @param {string} username - Twitter username
   * @returns {Object} - User entity
   */
  async ensureUserExists(username) {
    try {
      // Try to find existing user
      let user = await this.repositories.user.findOne({ 
        where: { username } 
      });

      // Create user if not found
      if (!user) {
        user = this.repositories.user.create({
          username,
          lastScrapedAt: new Date(),
        });
        await this.repositories.user.save(user);
        this.fastify.log.info(`Created new user record for @${username}`);
      } else {
        // Update last scraped time
        user.lastScrapedAt = new Date();
        await this.repositories.user.save(user);
        this.fastify.log.info(`Updated existing user record for @${username}`);
      }

      return user;
    } catch (error) {
      this.fastify.log.error(`Failed to ensure user exists: ${error.message}`);
      throw error;
    }
  }

  /**
   * Submit a job to process tweets for analytics
   * 
   * @param {string} username - Twitter username 
   * @param {string} action - Processing action
   * @param {Array} tweets - Optional array of tweets (if not provided, will fetch from DB)
   * @returns {Object} - Job information
   */
  async queueProcessJob(username, action, tweets = null) {
    // Find user in database
    const user = await this.repositories.user.findOne({ 
      where: { username } 
    });

    if (!user) {
      throw new Error(`User @${username} not found. Please run a scraping job first.`);
    }

    // Add job to queue
    const job = await this.queues.tweetProcessor.add(
      `process-${action}`,
      { 
        username, 
        userId: user.id,
        action,
        tweets 
      },
      { 
        jobId: `process-${username}-${action}-${Date.now()}`,
        removeOnComplete: true
      }
    );
    
    return {
      message: `Started ${action} job for @${username}`,
      jobId: job.id,
      status: 'queued'
    };
  }

  /**
   * Get analytics for a user
   * 
   * @param {string} username - Twitter username
   * @returns {Object} - Analytics data
   */
  async getUserAnalytics(username) {
    // Find user in database
    const user = await this.repositories.user.findOne({ 
      where: { username },
      relations: ['analytics'] 
    });

    if (!user) {
      throw new Error(`User @${username} not found`);
    }

    if (!user.analytics) {
      throw new Error(`No analytics found for @${username}. Please run a processing job first.`);
    }

    return user.analytics;
  }

  /**
   * Get statistics about current jobs
   * 
   * @returns {Object} - Job statistics
   */
  async getJobStats() {
    const activeJobs = await this.queues.twitterScraper.getActive();
    const waitingJobs = await this.queues.twitterScraper.getWaiting();
    const completedJobs = await this.queues.twitterScraper.getCompleted();
    const failedJobs = await this.queues.twitterScraper.getFailed();
    
    return {
      active: activeJobs.length,
      waiting: waitingJobs.length,
      completed: completedJobs.length,
      failed: failedJobs.length,
      jobs: {
        active: activeJobs.map(job => ({
          id: job.id,
          username: job.data.username,
          operation: job.data.operation,
          createdAt: job.timestamp ? new Date(job.timestamp).toISOString() : null
        })),
        waiting: waitingJobs.map(job => ({
          id: job.id,
          username: job.data.username,
          operation: job.data.operation,
          createdAt: job.timestamp ? new Date(job.timestamp).toISOString() : null
        }))
      }
    };
  }

  /**
   * Get information about a specific job
   * 
   * @param {string} jobId - ID of the job
   * @returns {Object} - Job details
   */
  async getJobById(jobId) {
    // Try to find job in either queue
    let job = await this.queues.twitterScraper.getJob(jobId);
    if (!job) {
      job = await this.queues.tweetProcessor.getJob(jobId);
    }
    
    if (!job) {
      return null;
    }
    
    const state = await job.getState();
    const result = job.returnvalue;
    
    // Check if the job failed due to authentication issues or rate limiting
    let failureReason = null;
    let failureType = null;
    let failureDetails = null;
    
    if (state === 'failed' && job.failedReason) {
      failureReason = job.failedReason;
      
      // Try to parse structured error information
      try {
        const errorData = JSON.parse(job.failedReason);
        if (errorData && errorData.isJobFailure) {
          failureReason = errorData.message;
          failureType = errorData.type;
          failureDetails = errorData.details;
          
          // Provide friendly error messages for common failures
          if (errorData.type === 'authentication') {
            failureReason = 'Twitter authentication failed. Please check your Twitter credentials.';
          } else if (errorData.type === 'rate-limited') {
            failureReason = 'Twitter API rate limit reached. The job has been stopped to prevent account restrictions.';
          }
        }
      } catch (e) {
        // Not a structured error, use basic detection instead
        if (job.failedReason.includes('Authentication failed') || 
            job.failedReason.includes('login') || 
            job.failedReason.includes('credentials')) {
          failureReason = 'Twitter authentication failed. Please check your Twitter credentials.';
          failureType = 'authentication';
        } else if (job.failedReason.includes('rate limit') || 
                  job.failedReason.includes('too many requests')) {
          failureReason = 'Twitter API rate limit reached. The job has been stopped to prevent account restrictions.';
          failureType = 'rate-limited';
        }
      }
    }
    
    // Check if the account is currently rate limited
    let isRateLimited = false;
    let rateLimitedUntil = null;
    
    if (job.data.username) {
      const rateLimitKey = `rate-limit:${job.data.username}`;
      const rateLimitTimestamp = await this.redis.get(rateLimitKey);
      
      if (rateLimitTimestamp) {
        isRateLimited = true;
        // Assume rate limits typically last 15 minutes
        const rateLimitTime = parseInt(rateLimitTimestamp);
        if (!isNaN(rateLimitTime)) {
          const estimatedEndTime = new Date(rateLimitTime + (15 * 60 * 1000));
          rateLimitedUntil = estimatedEndTime.toISOString();
        }
      }
    }
    
    return {
      id: job.id,
      data: job.data,
      state: state,
      createdAt: job.timestamp ? new Date(job.timestamp).toISOString() : null,
      processedOn: job.processedOn ? new Date(job.processedOn).toISOString() : null,
      finishedOn: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
      progress: job.progress,
      attemptsMade: job.attemptsMade,
      result: result,
      failureReason: failureReason,
      failureType: failureType,
      failureDetails: failureDetails,
      isRateLimited: isRateLimited,
      rateLimitedUntil: rateLimitedUntil
    };
  }

  /**
   * Get tweets for a user
   * 
   * @param {string} username - Twitter username
   * @param {Object} options - Query options (limit, offset, type, etc.)
   * @returns {Object} - Tweets with pagination info
   */
  async getUserTweets(username, options = {}) {
    const {
      limit = 20,
      offset = 0,
      fromId = null,
      toId = null,
      type = null,
      sortBy = 'postedAt',
      sortOrder = 'DESC',
      startDate = null,
      endDate = null,
    } = options;

    // Find user in database
    const user = await this.repositories.user.findOne({ 
      where: { username } 
    });

    if (!user) {
      throw new Error(`User @${username} not found`);
    }

    // Build query
    const queryBuilder = this.repositories.tweet
      .createQueryBuilder('tweet')
      .where('tweet.userId = :userId', { userId: user.id });
    
    // Apply incrementalId range filter if provided
    if (fromId !== null && !isNaN(fromId)) {
      queryBuilder.andWhere('tweet.incrementalId >= :fromId', { fromId });
    }
    
    if (toId !== null && !isNaN(toId)) {
      queryBuilder.andWhere('tweet.incrementalId <= :toId', { toId });
    }
    
    // Apply other filters
    if (type) {
      queryBuilder.andWhere('tweet.type = :type', { type });
    }

    if (startDate) {
      queryBuilder.andWhere('tweet.postedAt >= :startDate', { startDate });
    }

    if (endDate) {
      queryBuilder.andWhere('tweet.postedAt <= :endDate', { endDate });
    }
    
    // Add ordering
    queryBuilder.orderBy(`tweet.${sortBy}`, sortOrder);
    
    // If no incrementalId range is specified, apply limit and offset
    if (fromId === null && toId === null) {
      queryBuilder.skip(offset).take(limit);
    } else {
      // When using incrementalId range, we don't apply skip/take by default
      // but we still respect the limit if specified
      if (limit) {
        queryBuilder.take(limit);
      }
    }

    // Execute query with count
    const [tweets, total] = await queryBuilder.getManyAndCount();

    return {
      data: tweets,
      pagination: {
        total,
        offset,
        limit,
        fromId: fromId || null,
        toId: toId || null,
        hasMore: offset + tweets.length < total,
      }
    };
  }

  /**
   * Get the min and max incrementalId for a specific user
   * 
   * @param {string} username - Twitter username
   * @returns {Object} - Min and max incrementalId information
   */
  async getTweetIdRange(username) {
    // Find user in database
    const user = await this.repositories.user.findOne({ 
      where: { username } 
    });

    if (!user) {
      throw new Error(`User @${username} not found`);
    }

    // Get min and max incrementalId from tweets table
    const result = await this.repositories.tweet
      .createQueryBuilder('tweet')
      .select('MIN(tweet.incrementalId)', 'minId')
      .addSelect('MAX(tweet.incrementalId)', 'maxId')
      .addSelect('COUNT(tweet.id)', 'totalTweets')
      .where('tweet.userId = :userId', { userId: user.id })
      .getRawOne();
    
    // Convert values to numbers (they come as strings from raw query)
    const minId = result.minId !== null ? parseInt(result.minId) : null;
    const maxId = result.maxId !== null ? parseInt(result.maxId) : null;
    const totalTweets = parseInt(result.totalTweets) || 0;
    
    if (totalTweets === 0 || minId === null || maxId === null) {
      throw new Error(`No tweets found for user @${username}`);
    }
    
    return {
      username,
      minId,
      maxId,
      totalTweets
    };
  }

  /**
   * Cancel and remove a job
   * 
   * @param {string} jobId - ID of the job to cancel
   * @param {boolean} force - Whether to force unlock and remove the job
   * @returns {Object} - Operation result with success status and error information if applicable
   */
  async cancelJob(jobId, force = false) {
    // Try to find job in either queue
    let job = await this.queues.twitterScraper.getJob(jobId);
    let queueName = 'twitterScraper';
    
    if (!job) {
      job = await this.queues.tweetProcessor.getJob(jobId);
      queueName = 'tweetProcessor';
    }
    
    if (!job) {
      return { success: false, error: 'Job not found' };
    }
    
    try {
      // If force is true, we'll try to unlock the job first
      if (force) {
        // Get current job state to see if it's locked
        const jobState = await job.getState();
        this.fastify.log.info(`Attempting to force cancel job ${jobId} in state: ${jobState}`);
        
        // Make a direct Redis call to remove the lock
        // The Redis key format that BullMQ uses for locks is: `bull:${queueName}:${jobId}:lock`
        const lockKey = `bull:${queueName}:${jobId}:lock`;
        const wasLocked = await this.redis.del(lockKey);
        
        if (wasLocked) {
          this.fastify.log.info(`Successfully removed lock for job ${jobId}`);
        }
        
        // Also try to clean up active job in case it's still in the active list
        // BullMQ stores active jobs in a list with key: `bull:${queueName}:active`
        try {
          await this.redis.lrem(`bull:${queueName}:active`, 0, jobId);
          this.fastify.log.info(`Removed job ${jobId} from active list`);
        } catch (err) {
          this.fastify.log.warn(`Could not remove job ${jobId} from active list: ${err.message}`);
        }
      }
      
      // Remove the job
      await job.remove();
      
      // Also try to clean up any in-progress resources
      await this.redis.set(`cancel:${jobId}`, '1', 'EX', 3600); // signal to worker to cancel
      
      // If we have an active pipeline, try to interrupt it
      if (global.activePipelines && global.activePipelines[jobId]) {
        try {
          global.activePipelines[jobId].interrupt();
          this.fastify.log.info(`Successfully interrupted pipeline for job ${jobId}`);
          delete global.activePipelines[jobId];
        } catch (err) {
          this.fastify.log.error(`Failed to interrupt pipeline: ${err.message}`);
        }
      }
      
      return { success: true };
    } catch (error) {
      this.fastify.log.error(`Error cancelling job ${jobId}: ${error.message}`);
      
      // Don't throw, return error information instead
      let errorMessage = error.message;
      let errorType = 'unknown';
      
      if (error.message.includes("locked by another worker")) {
        errorType = 'locked';
        if (!force) {
          this.fastify.log.warn(`Job ${jobId} is locked. Try with force=true parameter.`);
        }
      }
      
      return { 
        success: false, 
        error: errorMessage,
        errorType,
        needsForce: errorType === 'locked' && !force
      };
    }
  }

  /**
   * Get tweets for a user using the tweets_view
   * 
   * @param {string} username - Twitter username
   * @param {Object} options - Query options (limit, offset, type, etc.)
   * @returns {Object} - Tweets with pagination info
   */
  async getTweetsFromView(username = null, options = {}) {
    const {
      limit = 20,
      offset = 0,
      fromId = null,
      toId = null,
      type = null,
      sortBy = 'incrementalId',
      sortOrder = 'DESC',
      tweetId = null,
      replyToTweetId = null
    } = options;

    // Build query
    const queryBuilder = this.repositories.tweetsView
      .createQueryBuilder('tweetsView');
    
    // Apply filters
    if (username) {
      queryBuilder.andWhere('tweetsView.username = :username', { username });
    }
    
    if (type) {
      queryBuilder.andWhere('tweetsView.type = :type', { type });
    }

    if (tweetId) {
      queryBuilder.andWhere('tweetsView.tweetId = :tweetId', { tweetId });
    }

    if (replyToTweetId) {
      queryBuilder.andWhere('tweetsView.replyToTweetId = :replyToTweetId', { replyToTweetId });
    }

    // Apply incrementalId range filter if provided
    if (fromId !== null && !isNaN(fromId)) {
      queryBuilder.andWhere('tweetsView.incrementalId >= :fromId', { fromId });
    }
    
    if (toId !== null && !isNaN(toId)) {
      queryBuilder.andWhere('tweetsView.incrementalId <= :toId', { toId });
    }
    
    // Add ordering
    queryBuilder.orderBy(`tweetsView.${sortBy}`, sortOrder);
    
    // If no incrementalId range is specified, apply limit and offset
    if (fromId === null && toId === null) {
      queryBuilder.skip(offset).take(limit);
    } else {
      // When using incrementalId range, we don't apply skip/take by default
      // but we still respect the limit if specified
      if (limit) {
        queryBuilder.take(limit);
      }
    }

    // Execute query with count
    const [tweets, total] = await queryBuilder.getManyAndCount();

    return {
      data: tweets,
      pagination: {
        total,
        offset,
        limit,
        fromId: fromId || null,
        toId: toId || null,
        hasMore: offset + tweets.length < total,
      }
    };
  }

  /**
   * Get the min and max incrementalId range from the tweets_view
   * 
   * @param {string} username - Optional Twitter username to filter by
   * @returns {Object} - Min and max incrementalId information
   */
  async getTweetsViewIdRange(username = null) {
    // Build query to get min and max incrementalId
    const queryBuilder = this.repositories.tweetsView
      .createQueryBuilder('tweetsView')
      .select('MIN(tweetsView.incrementalId)', 'minId')
      .addSelect('MAX(tweetsView.incrementalId)', 'maxId')
      .addSelect('COUNT(tweetsView.id)', 'totalTweets');
    
    // Filter by username if provided
    if (username) {
      queryBuilder.where('tweetsView.username = :username', { username });
    }
    
    // Execute raw query
    const result = await queryBuilder.getRawOne();
    
    // Convert values to numbers (they come as strings from raw query)
    const minId = result.minId !== null ? parseInt(result.minId) : null;
    const maxId = result.maxId !== null ? parseInt(result.maxId) : null;
    const totalTweets = parseInt(result.totalTweets) || 0;
    
    if (totalTweets === 0 || minId === null || maxId === null) {
      throw new Error(`No tweets found${username ? ` for user @${username}` : ''}`);
    }
    
    return {
      username: username || null,
      minId,
      maxId,
      totalTweets
    };
  }

  /**
   * Identify stuck jobs that have been running for too long
   * 
   * @param {number} thresholdHours - Jobs running longer than this many hours are considered stuck (default: 24 hours)
   * @returns {Object} - List of stuck jobs by queue
   */
  async identifyStuckJobs(thresholdHours = 24) {
    const thresholdMs = thresholdHours * 60 * 60 * 1000;
    const now = Date.now();
    
    // Get all active jobs from both queues
    const twitterScraperActive = await this.queues.twitterScraper.getActive();
    const tweetProcessorActive = await this.queues.tweetProcessor.getActive();
    
    // Filter for jobs that have been active for too long
    const stuckTwitterJobs = twitterScraperActive.filter(job => {
      // Check if job has been processing for longer than threshold
      return job.processedOn && (now - job.processedOn) > thresholdMs;
    });
    
    const stuckProcessorJobs = tweetProcessorActive.filter(job => {
      return job.processedOn && (now - job.processedOn) > thresholdMs;
    });
    
    // Also check for jobs that have been in "waiting" or "delayed" state for too long
    // These could be jobs that the worker has crashed while processing
    const waitingTwitterJobs = await this.queues.twitterScraper.getWaiting();
    const delayedTwitterJobs = await this.queues.twitterScraper.getDelayed();
    
    // Filter for waiting/delayed jobs that are too old
    const stuckWaitingTwitterJobs = waitingTwitterJobs.filter(job => {
      // Check if job was created too long ago and has a high attempt count
      return job.timestamp && (now - job.timestamp) > thresholdMs && job.attemptsMade > 2;
    });
    
    const stuckDelayedTwitterJobs = delayedTwitterJobs.filter(job => {
      return job.timestamp && (now - job.timestamp) > thresholdMs && job.attemptsMade > 2;
    });
    
    // Combine all stuck Twitter jobs
    const allStuckTwitterJobs = [...stuckTwitterJobs, ...stuckWaitingTwitterJobs, ...stuckDelayedTwitterJobs];
    
    // Get job states - we need to handle the awaits properly
    const twitterScraperResults = await Promise.all(
      allStuckTwitterJobs.map(async (job) => {
        let state = 'unknown';
        if (job.getState) {
          try {
            state = await job.getState();
          } catch (err) {
            this.fastify.log.error(`Error getting state for job ${job.id}: ${err.message}`);
          }
        }
        
        return {
          id: job.id,
          data: job.data,
          state,
          age: job.processedOn ? Math.round((now - job.processedOn) / (60 * 60 * 1000)) + ' hours' : 'unknown',
          attempts: job.attemptsMade
        };
      })
    );
    
    const tweetProcessorResults = await Promise.all(
      stuckProcessorJobs.map(async (job) => {
        let state = 'unknown';
        if (job.getState) {
          try {
            state = await job.getState();
          } catch (err) {
            this.fastify.log.error(`Error getting state for job ${job.id}: ${err.message}`);
          }
        }
        
        return {
          id: job.id,
          data: job.data,
          state,
          age: job.processedOn ? Math.round((now - job.processedOn) / (60 * 60 * 1000)) + ' hours' : 'unknown',
          attempts: job.attemptsMade
        };
      })
    );
    
    return {
      twitterScraper: twitterScraperResults,
      tweetProcessor: tweetProcessorResults
    };
  }

  /**
   * Clean up stuck jobs
   * 
   * @param {number} thresholdHours - Jobs running longer than this many hours will be terminated
   * @returns {Object} - Results of the cleanup operation
   */
  async cleanupStuckJobs(thresholdHours = 24) {
    const stuckJobs = await this.identifyStuckJobs(thresholdHours);
    const results = {
      twitterScraper: { total: stuckJobs.twitterScraper.length, succeeded: 0, failed: 0, details: [] },
      tweetProcessor: { total: stuckJobs.tweetProcessor.length, succeeded: 0, failed: 0, details: [] }
    };
    
    // Process Twitter scraper jobs
    for (const job of stuckJobs.twitterScraper) {
      try {
        this.fastify.log.warn(`Force terminating stuck job ${job.id} (${job.age} old, ${job.attempts} attempts)`);
        
        // Force terminate with our enhanced cancel method
        const result = await this.cancelJob(job.id, true);
        
        if (result.success) {
          results.twitterScraper.succeeded++;
          results.twitterScraper.details.push({
            id: job.id,
            status: 'terminated',
            message: `Successfully terminated job after ${job.age}`
          });
        } else {
          results.twitterScraper.failed++;
          results.twitterScraper.details.push({
            id: job.id,
            status: 'failed',
            error: result.error
          });
          
          // If the normal force cancel didn't work, try more aggressive Redis cleanup
          await this.forceRemoveJobFromRedis('twitterScraper', job.id);
        }
      } catch (error) {
        results.twitterScraper.failed++;
        results.twitterScraper.details.push({
          id: job.id,
          status: 'error',
          error: error.message
        });
      }
    }
    
    // Process tweet processor jobs
    for (const job of stuckJobs.tweetProcessor) {
      try {
        this.fastify.log.warn(`Force terminating stuck job ${job.id} (${job.age} old, ${job.attempts} attempts)`);
        
        const result = await this.cancelJob(job.id, true);
        
        if (result.success) {
          results.tweetProcessor.succeeded++;
          results.tweetProcessor.details.push({
            id: job.id,
            status: 'terminated',
            message: `Successfully terminated job after ${job.age}`
          });
        } else {
          results.tweetProcessor.failed++;
          results.tweetProcessor.details.push({
            id: job.id,
            status: 'failed',
            error: result.error
          });
          
          // If the normal force cancel didn't work, try more aggressive Redis cleanup
          await this.forceRemoveJobFromRedis('tweetProcessor', job.id);
        }
      } catch (error) {
        results.tweetProcessor.failed++;
        results.tweetProcessor.details.push({
          id: job.id,
          status: 'error',
          error: error.message
        });
      }
    }
    
    return results;
  }
  
  /**
   * Force remove a job from Redis using direct Redis commands
   * This is a last resort when all other methods fail
   * 
   * @param {string} queueName - Name of the queue ('twitterScraper' or 'tweetProcessor')
   * @param {string} jobId - ID of the job to remove
   * @returns {boolean} - Whether the operation succeeded
   */
  async forceRemoveJobFromRedis(queueName, jobId) {
    try {
      // Convert our queue name to the actual Bull queue name
      const bullQueueName = queueName === 'twitterScraper' ? 'twitter-scraper' : 'tweet-processor';
      
      // The key prefix in Redis
      const prefix = `bull:${bullQueueName}:`;
      
      // Log what we're about to do
      this.fastify.log.warn(`Performing aggressive Redis cleanup for job ${jobId} in queue ${bullQueueName}`);
      
      // Remove from all possible states in Redis
      const keys = [
        `${prefix}${jobId}`, // The job hash itself
        `${prefix}${jobId}:lock`, // Job lock
        `${prefix}active`, // Active set
        `${prefix}wait`, // Waiting list
        `${prefix}delayed`, // Delayed zset
        `${prefix}failed`, // Failed set
        `${prefix}stalled` // Stalled set
      ];
      
      // Delete the job data
      await this.redis.del(`${prefix}${jobId}`);
      
      // Remove lock if exists
      await this.redis.del(`${prefix}${jobId}:lock`);
      
      // Remove from active list
      await this.redis.lrem(`${prefix}active`, 0, jobId);
      
      // Remove from wait list
      await this.redis.lrem(`${prefix}wait`, 0, jobId);
      
      // Remove from delayed zset
      await this.redis.zrem(`${prefix}delayed`, jobId);
      
      // Remove from failed set
      await this.redis.zrem(`${prefix}failed`, jobId);
      
      // Remove from stalled set
      await this.redis.srem(`${prefix}stalled`, jobId);
      
      // Signal cancellation
      await this.redis.set(`cancel:${jobId}`, '1', 'EX', 3600);
      
      // Remove from active pipelines if it exists
      if (global.activePipelines && global.activePipelines[jobId]) {
        try {
          global.activePipelines[jobId].interrupt();
          delete global.activePipelines[jobId];
        } catch (err) {
          this.fastify.log.error(`Failed to interrupt pipeline: ${err.message}`);
        }
      }
      
      this.fastify.log.info(`Successfully performed Redis cleanup for job ${jobId}`);
      return true;
    } catch (error) {
      this.fastify.log.error(`Failed to clean up job ${jobId} from Redis: ${error.message}`);
      return false;
    }
  }
}

export default TwitterService; 
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

    // Add job to queue
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
        removeOnComplete: true
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
   * @returns {boolean} - Success status
   */
  async cancelJob(jobId) {
    // Try to find job in either queue
    let job = await this.queues.twitterScraper.getJob(jobId);
    let queueName = 'twitterScraper';
    
    if (!job) {
      job = await this.queues.tweetProcessor.getJob(jobId);
      queueName = 'tweetProcessor';
    }
    
    if (!job) {
      return false;
    }
    
    // Remove the job
    await job.remove();
    
    // Also try to clean up any in-progress resources
    await this.redis.set(`cancel:${jobId}`, '1', 'EX', 3600); // signal to worker to cancel
    
    return true;
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
}

export default TwitterService; 
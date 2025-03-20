/**
 * Twitter Service - Handles business logic for Twitter operations
 */
class TwitterService {
  constructor(fastify) {
    this.fastify = fastify;
    this.redis = fastify.redis;
    this.queues = fastify.queues;
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

    // Add job to queue
    const job = await this.queues.twitterScraper.add(
      'scrape-twitter-user',
      { 
        username, 
        options,
        operation: 'scrape-twitter-user'
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
   * Submit a job to process tweets
   * 
   * @param {string} username - Twitter username 
   * @param {string} action - Processing action
   * @param {string} basePath - Base path for data storage
   * @param {Array} tweets - Optional array of tweets
   * @returns {Object} - Job information
   */
  async queueProcessJob(username, action, basePath = 'pipeline', tweets = null) {
    // Add job to queue
    const job = await this.queues.tweetProcessor.add(
      `process-${action}`,
      { 
        username, 
        basePath, 
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
          createdAt: job.timestamp
        })),
        waiting: waitingJobs.map(job => ({
          id: job.id,
          username: job.data.username,
          operation: job.data.operation,
          createdAt: job.timestamp
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
    
    return {
      id: job.id,
      data: job.data,
      state: await job.getState(),
      createdAt: job.timestamp,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
      progress: job.progress,
      attemptsMade: job.attemptsMade,
      result: job.returnvalue
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
}

export default TwitterService; 
import TwitterService from '../services/TwitterService.js';

/**
 * Twitter API routes
 * 
 * @param {FastifyInstance} fastify - Fastify instance
 * @param {Object} options - Route options
 */
async function twitterRoutes(fastify, options) {
  // Initialize Twitter service
  const twitterService = new TwitterService(fastify);

  // Health check route
  fastify.get('/health', async (request, reply) => {
    return { status: 'ok', service: 'twitter-api' };
  });

  // Get active jobs
  fastify.get('/jobs', async (request, reply) => {
    return await twitterService.getJobStats();
  });

  // Get job by ID
  fastify.get('/jobs/:id', async (request, reply) => {
    const { id } = request.params;
    const job = await twitterService.getJobById(id);
    
    if (!job) {
      reply.code(404);
      return { error: 'Job not found' };
    }
    
    return job;
  });

  // Submit a new Twitter scraping job
  fastify.post('/scrape', {
    schema: {
      body: {
        type: 'object',
        required: ['username'],
        properties: {
          username: { type: 'string', minLength: 1 },
          options: {
            type: 'object',
            properties: {
              maxTweets: { type: 'integer', minimum: 1, maximum: 100000 },
              maxRetries: { type: 'integer', minimum: 1, maximum: 10 },
              minDelayBetweenRequests: { type: 'integer', minimum: 500 },
              maxDelayBetweenRequests: { type: 'integer', minimum: 1000 },
              tweetTypes: { 
                type: 'array', 
                items: { 
                  type: 'string', 
                  enum: ['original', 'replies', 'quotes', 'retweets'] 
                } 
              },
              contentTypes: { 
                type: 'array', 
                items: { 
                  type: 'string', 
                  enum: ['text', 'images', 'videos', 'links'] 
                } 
              }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    const { username, options } = request.body;
    const result = await twitterService.queueScrapeJob(username, options);
    
    if (result.status === 'already_running') {
      reply.code(409); // Conflict
    }
    
    return result;
  });

  // Submit a tweet processing job
  fastify.post('/process', {
    schema: {
      body: {
        type: 'object',
        required: ['username', 'action'],
        properties: {
          username: { type: 'string', minLength: 1 },
          basePath: { type: 'string', default: 'pipeline' },
          action: { 
            type: 'string', 
            enum: ['generate-analytics', 'generate-finetuning'] 
          },
          tweets: { 
            type: 'array',
            items: { type: 'object' }
          }
        }
      }
    }
  }, async (request, reply) => {
    const { username, basePath, action, tweets } = request.body;
    
    // If tweets are not provided, try to load them from the file
    let tweetsToProcess = tweets;
    if (!tweetsToProcess) {
      try {
        // Import file system dynamically
        const fs = await import('fs/promises');
        const path = await import('path');
        
        // Import DataOrganizer to get paths
        const { default: DataOrganizer } = await import('../../src/twitter/DataOrganizer.js');
        const organizer = new DataOrganizer(basePath || 'pipeline', username);
        const paths = organizer.getPaths();
        
        // Read tweets from file
        const rawTweetsData = await fs.readFile(paths.raw.tweets, 'utf-8');
        tweetsToProcess = JSON.parse(rawTweetsData);
      } catch (error) {
        fastify.log.error(`Failed to load tweets for processing: ${error.message}`);
        reply.code(400);
        return { error: 'Could not load tweets from file. Please provide tweets in the request body' };
      }
    }
    
    return await twitterService.queueProcessJob(username, action, basePath, tweetsToProcess);
  });

  // Get tweet analytics (if available)
  fastify.get('/analytics/:username', async (request, reply) => {
    const { username } = request.params;
    
    try {
      // Import file system dynamically
      const fs = await import('fs/promises');
      
      // Import DataOrganizer to get paths
      const { default: DataOrganizer } = await import('../../src/twitter/DataOrganizer.js');
      const organizer = new DataOrganizer('pipeline', username);
      const paths = organizer.getPaths();
      
      // Try to read analytics file
      const analyticsData = await fs.readFile(paths.analytics.stats, 'utf-8');
      const analytics = JSON.parse(analyticsData);
      
      return analytics;
    } catch (error) {
      fastify.log.error(`Failed to get analytics for @${username}: ${error.message}`);
      reply.code(404);
      return { 
        error: 'Analytics not found', 
        message: 'Run a scraping job first and then process the tweets with analytics'
      };
    }
  });

  // Cancel a job
  fastify.delete('/jobs/:id', async (request, reply) => {
    const { id } = request.params;
    const success = await twitterService.cancelJob(id);
    
    if (!success) {
      reply.code(404);
      return { error: 'Job not found' };
    }
    
    return {
      message: `Job ${id} has been cancelled`
    };
  });
}

export default twitterRoutes; 
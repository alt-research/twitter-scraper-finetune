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
          },
          credentials: {
            type: 'object',
            properties: {
              twitterUsername: { type: 'string', minLength: 1 },
              twitterPassword: { type: 'string', minLength: 1 },
              twitterEmail: { type: 'string', format: 'email' }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    const { username, options, credentials } = request.body;
    const result = await twitterService.queueScrapeJob(username, options, credentials);
    
    if (result.status === 'already_running') {
      reply.code(409); // Conflict
    }
    
    return result;
  });

  // Submit a tweet processing job for analytics
  fastify.post('/process', {
    schema: {
      body: {
        type: 'object',
        required: ['username', 'action'],
        properties: {
          username: { type: 'string', minLength: 1 },
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
    try {
      const { username, action, tweets } = request.body;
      return await twitterService.queueProcessJob(username, action, tweets);
    } catch (error) {
      fastify.log.error(`Failed to process tweets: ${error.message}`);
      reply.code(400);
      return { error: error.message };
    }
  });

  // Get tweets for a user with pagination and filters
  fastify.get('/tweets/:username', {
    schema: {
      params: {
        type: 'object',
        properties: {
          username: { type: 'string' }
        },
        required: ['username']
      },
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          offset: { type: 'integer', minimum: 0, default: 0 },
          type: { type: 'string', enum: ['original', 'reply', 'retweet', 'quote'] },
          sortBy: { type: 'string', enum: ['postedAt', 'likeCount', 'retweetCount', 'replyCount', 'quoteCount'], default: 'postedAt' },
          sortOrder: { type: 'string', enum: ['ASC', 'DESC'], default: 'DESC' },
          startDate: { type: 'string', format: 'date-time' },
          endDate: { type: 'string', format: 'date-time' }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const { username } = request.params;
      const { limit, offset, type, sortBy, sortOrder, startDate, endDate } = request.query;
      
      const tweets = await twitterService.getUserTweets(username, {
        limit: parseInt(limit),
        offset: parseInt(offset),
        type,
        sortBy,
        sortOrder,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null
      });
      
      return tweets;
    } catch (error) {
      fastify.log.error(`Failed to get tweets: ${error.message}`);
      reply.code(404);
      return { error: error.message };
    }
  });

  // Get tweet analytics (if available)
  fastify.get('/analytics/:username', async (request, reply) => {
    try {
      const { username } = request.params;
      return await twitterService.getUserAnalytics(username);
    } catch (error) {
      fastify.log.error(`Failed to get analytics for @${username}: ${error.message}`);
      reply.code(404);
      return { 
        error: error.message, 
        message: 'Analytics not found. Run a scraping job first and then process the tweets with analytics'
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
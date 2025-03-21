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
  fastify.get('/health', {
    schema: {
      description: 'Health check endpoint for Twitter API service',
      tags: ['health'],
      response: {
        200: {
          description: 'Successful response',
          type: 'object',
          properties: {
            status: { type: 'string' },
            service: { type: 'string' }
          },
          examples: [
            {
              status: 'ok',
              service: 'twitter-api'
            }
          ]
        }
      }
    }
  }, async (request, reply) => {
    return { status: 'ok', service: 'twitter-api' };
  });

  // Get active jobs
  fastify.get('/jobs', {
    schema: {
      description: 'Get statistics about all jobs in the queue',
      tags: ['jobs'],
      response: {
        200: {
          description: 'Job statistics',
          type: 'object',
          properties: {
            active: { type: 'integer', description: 'Number of active jobs' },
            waiting: { type: 'integer', description: 'Number of waiting jobs' },
            completed: { type: 'integer', description: 'Number of completed jobs' },
            failed: { type: 'integer', description: 'Number of failed jobs' },
            jobs: { 
              type: 'array', 
              description: 'List of recent jobs',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  username: { type: 'string' },
                  status: { type: 'string' },
                  progress: { type: 'integer' },
                  timestamp: { type: 'string', format: 'date-time' }
                }
              }
            }
          },
          examples: [
            {
              active: 1,
              waiting: 2,
              completed: 10,
              failed: 1,
              jobs: [
                {
                  id: '123456',
                  username: 'elonmusk',
                  status: 'active',
                  progress: 50,
                  timestamp: '2023-01-01T00:00:00Z'
                }
              ]
            }
          ]
        }
      }
    }
  }, async (request, reply) => {
    return await twitterService.getJobStats();
  });

  // Get job by ID
  fastify.get('/jobs/:id', {
    schema: {
      description: 'Get a specific job by ID',
      tags: ['jobs'],
      params: {
        type: 'object',
        properties: {
          id: { 
            type: 'string', 
            description: 'Job ID'
          }
        },
        required: ['id']
      },
      response: {
        200: {
          description: 'Job details',
          type: 'object',
          properties: {
            id: { type: 'string' },
            username: { type: 'string' },
            status: { type: 'string' },
            progress: { type: 'integer' },
            data: { type: 'object' },
            timestamp: { type: 'string', format: 'date-time' }
          },
          examples: [
            {
              id: '123456',
              username: 'elonmusk',
              status: 'active',
              progress: 50,
              data: { maxTweets: 1000 },
              timestamp: '2023-01-01T00:00:00Z'
            }
          ]
        },
        404: {
          description: 'Job not found',
          type: 'object',
          properties: {
            error: { type: 'string' }
          },
          examples: [
            {
              error: 'Job not found'
            }
          ]
        }
      }
    }
  }, async (request, reply) => {
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
      description: 'Submit a new Twitter scraping job',
      tags: ['scraping'],
      body: {
        type: 'object',
        required: ['username'],
        properties: {
          username: { 
            type: 'string', 
            minLength: 1, 
            description: 'Twitter username to scrape'
          },
          options: {
            type: 'object',
            description: 'Scraping options',
            properties: {
              maxTweets: { 
                type: 'integer', 
                minimum: 1, 
                maximum: 100000, 
                description: 'Maximum number of tweets to scrape'
              },
              maxRetries: { 
                type: 'integer', 
                minimum: 1, 
                maximum: 10, 
                description: 'Maximum number of retries for failed requests'
              },
              minDelayBetweenRequests: { 
                type: 'integer', 
                minimum: 500, 
                description: 'Minimum delay between requests in milliseconds'
              },
              maxDelayBetweenRequests: { 
                type: 'integer', 
                minimum: 1000, 
                description: 'Maximum delay between requests in milliseconds'
              },
              tweetTypes: { 
                type: 'array', 
                description: 'Types of tweets to scrape',
                items: { 
                  type: 'string', 
                  enum: ['original', 'replies', 'quotes', 'retweets'] 
                } 
              },
              contentTypes: { 
                type: 'array', 
                description: 'Types of content to scrape',
                items: { 
                  type: 'string', 
                  enum: ['text', 'images', 'videos', 'links'] 
                } 
              },
              // Twitter credentials
              credentials: {
                type: 'object',
                description: 'Twitter account credentials (preferred format)',
                properties: {
                  username: { 
                    type: 'string', 
                    description: 'Twitter login username'
                  },
                  password: { 
                    type: 'string', 
                    description: 'Twitter password'
                  },
                  email: { 
                    type: 'string', 
                    description: 'Twitter account email'
                  }
                }
              },
              // Legacy format (for backward compatibility)
              twitterUsername: { 
                type: 'string', 
                description: 'Twitter login username (legacy format)',
                deprecated: true 
              },
              twitterPassword: { 
                type: 'string', 
                description: 'Twitter password (legacy format)',
                deprecated: true 
              },
              twitterEmail: { 
                type: 'string', 
                description: 'Twitter account email (legacy format)',
                deprecated: true 
              }
            }
          }
        },
        examples: [
          {
            username: 'elonmusk',
            options: {
              maxTweets: 10000,
              tweetTypes: ['original', 'replies'],
              contentTypes: ['text', 'images'],
              credentials: {
                username: 'your_twitter_username',
                password: 'your_twitter_password',
                email: 'your_twitter_email'
              }
            }
          }
        ]
      },
      response: {
        200: {
          description: 'Job successfully queued',
          type: 'object',
          properties: {
            status: { type: 'string' },
            jobId: { type: 'string' },
            message: { type: 'string' }
          },
          examples: [
            {
              status: 'queued',
              jobId: '123456',
              message: 'Scraping job started for @elonmusk'
            }
          ]
        },
        409: {
          description: 'Job already running',
          type: 'object',
          properties: {
            status: { type: 'string' },
            jobId: { type: 'string' },
            message: { type: 'string' }
          },
          examples: [
            {
              status: 'already_running',
              jobId: '123456',
              message: 'A scraping job for @elonmusk is already running'
            }
          ]
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

  // Submit a tweet processing job for analytics
  fastify.post('/process', {
    schema: {
      description: 'Submit a job to process tweets for analytics or finetuning',
      tags: ['processing'],
      body: {
        type: 'object',
        required: ['username', 'action'],
        properties: {
          username: { 
            type: 'string', 
            minLength: 1, 
            description: 'Twitter username to process',
            example: 'elonmusk'
          },
          action: { 
            type: 'string', 
            enum: ['generate-analytics', 'generate-finetuning'],
            description: 'Processing action to perform',
            example: 'generate-analytics'
          },
          tweets: { 
            type: 'array',
            description: 'Optional array of tweets to process. If not provided, tweets will be loaded from the database.',
            items: { 
              type: 'object',
              description: 'Tweet object'
            }
          }
        }
      },
      response: {
        200: {
          description: 'Processing job successfully queued',
          type: 'object',
          properties: {
            status: { type: 'string', example: 'queued' },
            jobId: { type: 'string', example: '123456' },
            message: { type: 'string', example: 'Processing job started for @elonmusk' }
          }
        },
        400: {
          description: 'Error processing tweets',
          type: 'object',
          properties: {
            error: { type: 'string', example: 'No tweets found for processing' }
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
      description: 'Get tweets for a specific user with pagination and filters',
      tags: ['tweets'],
      params: {
        type: 'object',
        properties: {
          username: { 
            type: 'string',
            description: 'Twitter username',
            example: 'elonmusk'
          }
        },
        required: ['username']
      },
      querystring: {
        type: 'object',
        properties: {
          limit: { 
            type: 'integer', 
            minimum: 1, 
            maximum: 100, 
            default: 20,
            description: 'Number of tweets to return',
            example: 20
          },
          offset: { 
            type: 'integer', 
            minimum: 0, 
            default: 0,
            description: 'Offset for pagination',
            example: 0
          },
          fromId: { 
            type: 'integer', 
            minimum: 1,
            description: 'Start from this incrementalId (inclusive)',
            example: 500
          },
          toId: { 
            type: 'integer', 
            minimum: 1,
            description: 'End at this incrementalId (inclusive)',
            example: 1500
          },
          type: { 
            type: 'string', 
            enum: ['original', 'reply', 'retweet', 'quote'],
            description: 'Filter by tweet type',
            example: 'original'
          },
          sortBy: { 
            type: 'string', 
            enum: ['postedAt', 'likeCount', 'retweetCount', 'replyCount', 'quoteCount'], 
            default: 'postedAt',
            description: 'Field to sort by',
            example: 'postedAt'
          },
          sortOrder: { 
            type: 'string', 
            enum: ['ASC', 'DESC'], 
            default: 'DESC',
            description: 'Sort order',
            example: 'DESC'
          },
          startDate: { 
            type: 'string', 
            format: 'date-time',
            description: 'Filter tweets after this date',
            example: '2023-01-01T00:00:00Z'
          },
          endDate: { 
            type: 'string', 
            format: 'date-time',
            description: 'Filter tweets before this date',
            example: '2023-12-31T23:59:59Z'
          }
        }
      },
      response: {
        200: {
          description: 'List of tweets',
          type: 'object',
          properties: {
            data: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', example: '1234567890' },
                  text: { type: 'string', example: 'This is a tweet' },
                  postedAt: { type: 'string', format: 'date-time' },
                  type: { type: 'string', example: 'original' },
                  likeCount: { type: 'integer', example: 1000 },
                  retweetCount: { type: 'integer', example: 500 },
                  replyCount: { type: 'integer', example: 100 },
                  quoteCount: { type: 'integer', example: 50 }
                }
              }
            },
            total: { type: 'integer', example: 1000 },
            limit: { type: 'integer', example: 20 },
            offset: { type: 'integer', example: 0 }
          }
        },
        404: {
          description: 'Tweets not found',
          type: 'object',
          properties: {
            error: { type: 'string', example: 'Tweets not found for user' }
          }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const { username } = request.params;
      const { limit, offset, fromId, toId, type, sortBy, sortOrder, startDate, endDate } = request.query;
      
      const tweets = await twitterService.getUserTweets(username, {
        limit: parseInt(limit),
        offset: parseInt(offset),
        fromId: parseInt(fromId),
        toId: parseInt(toId),
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
  fastify.get('/analytics/:username', {
    schema: {
      description: 'Get analytics for a specific Twitter user',
      tags: ['analytics'],
      params: {
        type: 'object',
        properties: {
          username: { 
            type: 'string',
            description: 'Twitter username',
            example: 'elonmusk'
          }
        },
        required: ['username']
      },
      response: {
        200: {
          description: 'Tweet analytics',
          type: 'object',
          properties: {
            username: { type: 'string', example: 'elonmusk' },
            totalTweets: { type: 'integer', example: 1000 },
            averageLikes: { type: 'number', example: 5000.5 },
            averageRetweets: { type: 'number', example: 1000.2 },
            topTopics: { 
              type: 'array', 
              items: { 
                type: 'object',
                properties: {
                  topic: { type: 'string', example: 'space' },
                  count: { type: 'integer', example: 200 }
                }
              }
            },
            tweetsByMonth: { 
              type: 'object',
              additionalProperties: { type: 'integer' },
              example: { "2023-01": 100, "2023-02": 150 }
            }
          }
        },
        404: {
          description: 'Analytics not found',
          type: 'object',
          properties: {
            error: { type: 'string', example: 'Analytics not found' },
            message: { type: 'string', example: 'Analytics not found. Run a scraping job first and then process the tweets with analytics' }
          }
        }
      }
    }
  }, async (request, reply) => {
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

  // Get incrementalId range for a user 
  fastify.get('/tweets/:username/range', {
    schema: {
      description: 'Get the min and max incrementalId for a specific user',
      tags: ['tweets'],
      params: {
        type: 'object',
        properties: {
          username: { 
            type: 'string',
            description: 'Twitter username',
            example: 'elonmusk'
          }
        },
        required: ['username']
      },
      response: {
        200: {
          description: 'IncrementalId range information',
          type: 'object',
          properties: {
            username: { type: 'string', example: 'elonmusk' },
            minId: { type: 'integer', example: 1 },
            maxId: { type: 'integer', example: 5000 },
            totalTweets: { type: 'integer', example: 5000 }
          }
        },
        404: {
          description: 'User not found or has no tweets',
          type: 'object',
          properties: {
            error: { type: 'string', example: 'User not found or has no tweets' }
          }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const { username } = request.params;
      const range = await twitterService.getTweetIdRange(username);
      
      return range;
    } catch (error) {
      fastify.log.error(`Failed to get tweet ID range: ${error.message}`);
      reply.code(404);
      return { error: error.message };
    }
  });

  // Cancel a job
  fastify.delete('/jobs/:id', {
    schema: {
      description: 'Cancel a specific job by ID',
      tags: ['jobs'],
      params: {
        type: 'object',
        properties: {
          id: { 
            type: 'string',
            description: 'Job ID',
            example: '123456'
          }
        },
        required: ['id']
      },
      response: {
        200: {
          description: 'Job cancelled successfully',
          type: 'object',
          properties: {
            message: { type: 'string', example: 'Job 123456 has been cancelled' }
          }
        },
        404: {
          description: 'Job not found',
          type: 'object',
          properties: {
            error: { type: 'string', example: 'Job not found' }
          }
        }
      }
    }
  }, async (request, reply) => {
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
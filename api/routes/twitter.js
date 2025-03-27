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

  // Debug route with no schema validation
  fastify.get('/debug-jobs', async (request, reply) => {
    const data = await twitterService.getJobStats();
    // Log the actual structure for debugging
    console.log('DEBUG JOB STRUCTURE:', JSON.stringify(data, null, 2));
    return data;
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
              type: 'object', 
              description: 'Jobs by status',
              properties: {
                active: {
                  type: 'array',
                  description: 'List of active jobs',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      username: { type: 'string' },
                      operation: { type: 'string' },
                      createdAt: { type: 'string', format: 'date-time' }
                    }
                  }
                },
                waiting: {
                  type: 'array',
                  description: 'List of waiting jobs',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      username: { type: 'string' },
                      operation: { type: 'string' },
                      createdAt: { type: 'string', format: 'date-time' }
                    }
                  }
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
              jobs: {
                active: [
                  {
                    id: '123456',
                    username: 'elonmusk',
                    operation: 'scrape-twitter-user',
                    createdAt: '2023-01-01T00:00:00Z'
                  }
                ],
                waiting: [
                  {
                    id: '234567',
                    username: 'jack',
                    operation: 'scrape-twitter-user',
                    createdAt: '2023-01-01T00:00:00Z'
                  }
                ]
              }
            }
          ]
        }
      }
    }
  }, async (request, reply) => {
    const data = await twitterService.getJobStats();
    return data;
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
            data: { 
              type: 'object',
              description: 'Job data including username and operation'
            },
            state: { 
              type: 'string',
              description: 'Current state of the job (active, completed, failed, etc.)'
            },
            createdAt: { 
              type: 'string', 
              format: 'date-time',
              description: 'When the job was created'
            },
            processedOn: { 
              type: ['string', 'null'], 
              format: 'date-time',
              description: 'When the job started processing'
            },
            finishedOn: { 
              type: ['string', 'null'], 
              format: 'date-time',
              description: 'When the job finished processing'
            },
            progress: { 
              type: 'integer',
              description: 'Job progress (0-100)'
            },
            attemptsMade: { 
              type: 'integer',
              description: 'Number of attempts made to process this job'
            },
            result: { 
              type: ['object', 'null'],
              description: 'Result data if the job has completed'
            }
          },
          examples: [
            {
              id: '123456',
              data: { 
                username: 'elonmusk',
                operation: 'scrape-twitter-user'
              },
              state: 'active',
              createdAt: '2023-01-01T00:00:00Z',
              processedOn: '2023-01-01T00:00:01Z',
              finishedOn: null,
              progress: 50,
              attemptsMade: 1,
              result: null
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

  // Get tweets for a user with pagination and filters from the tweets_view
  fastify.get('/tweets-view', {
    schema: {
      description: 'Get tweets from tweets_view with joined username data. Supports multiple pagination methods: offset-based or range-based using incrementalId.',
      tags: ['tweets'],
      querystring: {
        type: 'object',
        properties: {
          username: { 
            type: 'string',
            description: 'Twitter username (optional, can fetch tweets from all users)',
            example: 'elonmusk'
          },
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
            description: 'Offset for pagination (not used when fromId/toId are specified)',
            example: 0
          },
          fromId: {
            type: 'integer',
            description: 'Start of incrementalId range for efficient range-based pagination (inclusive)',
            example: 1000
          },
          toId: {
            type: 'integer',
            description: 'End of incrementalId range for efficient range-based pagination (inclusive)',
            example: 2000
          },
          type: { 
            type: 'string', 
            enum: ['original', 'reply', 'retweet', 'quote'],
            description: 'Filter by tweet type',
            example: 'original'
          },
          sortBy: { 
            type: 'string', 
            enum: ['incrementalId', 'tweetId'], 
            default: 'incrementalId',
            description: 'Field to sort by',
            example: 'incrementalId'
          },
          sortOrder: { 
            type: 'string', 
            enum: ['ASC', 'DESC'], 
            default: 'DESC',
            description: 'Sort order',
            example: 'DESC'
          },
          tweetId: {
            type: 'string',
            description: 'Filter by specific tweet ID',
            example: '1234567890'
          },
          replyToTweetId: {
            type: 'string',
            description: 'Filter by tweets replying to this tweet ID',
            example: '1234567890'
          }
        }
      },
      response: {
        200: {
          description: 'List of tweets with user information and pagination details',
          type: 'object',
          properties: {
            data: {
              type: 'array',
              description: 'Array of tweets from the view',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', example: '1234567890', description: 'UUID of the tweet record' },
                  incrementalId: { type: 'integer', example: 12345, description: 'Auto-incrementing ID for efficient pagination' },
                  tweetId: { type: 'string', example: '1234567890', description: 'Twitter\'s original tweet ID' },
                  username: { type: 'string', example: 'elonmusk', description: 'Twitter username of the tweet author' },
                  text: { type: 'string', example: 'This is a tweet', description: 'Tweet text (may be truncated)' },
                  fullText: { type: 'string', example: 'This is a tweet with extended text', description: 'Full tweet text (not truncated)' },
                  lang: { type: 'string', example: 'en', description: 'Language code of the tweet' },
                  type: { type: 'string', example: 'original', description: 'Type of tweet: original, reply, retweet, or quote' },
                  replyToTweetId: { type: 'string', example: '9876543210', description: 'ID of the tweet this is replying to (if a reply)' }
                }
              }
            },
            pagination: {
              type: 'object',
              description: 'Pagination metadata for navigating through results',
              properties: {
                total: { type: 'integer', example: 1000, description: 'Total number of tweets matching the criteria' },
                limit: { type: 'integer', example: 20, description: 'Number of tweets per page' },
                offset: { type: 'integer', example: 0, description: 'Current offset (for offset-based pagination)' },
                fromId: { type: 'integer', example: 1000, description: 'Start of incrementalId range (for range-based pagination)' },
                toId: { type: 'integer', example: 2000, description: 'End of incrementalId range (for range-based pagination)' },
                hasMore: { type: 'boolean', example: true, description: 'Whether there are more tweets available' }
              }
            }
          }
        },
        500: {
          description: 'Server error',
          type: 'object',
          properties: {
            error: { type: 'string', example: 'Failed to get tweets from view', description: 'Error message' }
          }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const { username, limit, offset, fromId, toId, type, sortBy, sortOrder, tweetId, replyToTweetId } = request.query;
      
      const tweets = await twitterService.getTweetsFromView(username, {
        limit: parseInt(limit) || 20,
        offset: parseInt(offset) || 0,
        fromId: fromId ? parseInt(fromId) : null,
        toId: toId ? parseInt(toId) : null,
        type,
        sortBy: sortBy || 'incrementalId',
        sortOrder: sortOrder || 'DESC',
        tweetId,
        replyToTweetId
      });
      
      return tweets;
    } catch (error) {
      fastify.log.error(`Failed to get tweets from view: ${error.message}`);
      reply.code(500);
      return { error: error.message };
    }
  });

  // Get tweets view ID range for a user (or all tweets)
  fastify.get('/tweets-view/range', {
    schema: {
      description: 'Get min and max incrementalId values for tweets in the tweets_view, to support efficient range-based pagination.',
      tags: ['tweets'],
      querystring: {
        type: 'object',
        properties: {
          username: { 
            type: 'string',
            description: 'Twitter username (optional, can fetch range for all tweets when omitted)',
            example: 'elonmusk'
          }
        }
      },
      response: {
        200: {
          description: 'Min and max incrementalId information for range-based pagination',
          type: 'object',
          properties: {
            username: { 
              type: ['string', 'null'], 
              example: 'elonmusk',
              description: 'Username if filtered, null if range is for all tweets'
            },
            minId: { 
              type: 'integer', 
              example: 1000,
              description: 'Smallest incrementalId in the range (use as fromId parameter)'
            },
            maxId: { 
              type: 'integer', 
              example: 5000,
              description: 'Largest incrementalId in the range (use as toId parameter)'
            },
            totalTweets: { 
              type: 'integer', 
              example: 3500,
              description: 'Total number of tweets in the specified range'
            }
          }
        },
        404: {
          description: 'No tweets found matching the criteria',
          type: 'object',
          properties: {
            error: { 
              type: 'string', 
              example: 'No tweets found for user @elonmusk',
              description: 'Error message explaining why no tweets were found'
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const { username } = request.query;
      
      const range = await twitterService.getTweetsViewIdRange(username || null);
      
      return range;
    } catch (error) {
      fastify.log.error(`Failed to get tweets view ID range: ${error.message}`);
      reply.code(404);
      return { error: error.message };
    }
  });

  // Get list of available log files
  fastify.get('/logs', {
    schema: {
      description: 'Get a list of available log files',
      tags: ['logs'],
      response: {
        200: {
          description: 'List of log files',
          type: 'object',
          properties: {
            logDirectory: { type: 'string' },
            logs: { 
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  filename: { type: 'string' },
                  size: { type: 'number' },
                  created: { type: 'string', format: 'date-time' }
                }
              }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    try {
      // Use the getLogFilesPath method added by the file-logger plugin
      if (!fastify.getLogFilesPath) {
        return { logDirectory: null, logs: [] };
      }
      
      const logPaths = fastify.getLogFilesPath();
      const fs = await import('fs/promises');
      const path = await import('path');
      
      // Get all files in the logs directory
      const files = await fs.readdir(logPaths.directory);
      
      // Get stats for each file
      const logFiles = await Promise.all(
        files.map(async (file) => {
          const filePath = path.join(logPaths.directory, file);
          const stats = await fs.stat(filePath);
          
          return {
            filename: file,
            size: stats.size,
            created: stats.birthtime.toISOString()
          };
        })
      );
      
      // Sort by newest first
      logFiles.sort((a, b) => new Date(b.created) - new Date(a.created));
      
      return {
        logDirectory: logPaths.directory,
        logs: logFiles
      };
    } catch (error) {
      fastify.log.error(`Failed to get log files: ${error.message}`);
      reply.code(500);
      return { error: 'Failed to get log files' };
    }
  });
  
  // Download a specific log file
  fastify.get('/logs/:filename', {
    schema: {
      description: 'Download a specific log file',
      tags: ['logs'],
      params: {
        type: 'object',
        properties: {
          filename: { type: 'string' }
        },
        required: ['filename']
      }
    }
  }, async (request, reply) => {
    try {
      // Use the getLogFilesPath method added by the file-logger plugin
      if (!fastify.getLogFilesPath) {
        reply.code(404);
        return { error: 'Logging system not available' };
      }
      
      const logPaths = fastify.getLogFilesPath();
      const fs = await import('fs/promises');
      const path = await import('path');
      
      // Sanitize the filename to prevent directory traversal
      const filename = path.basename(request.params.filename);
      const filePath = path.join(logPaths.directory, filename);
      
      // Check if the file exists
      try {
        await fs.access(filePath);
      } catch (error) {
        reply.code(404);
        return { error: 'Log file not found' };
      }
      
      // Read the file
      const content = await fs.readFile(filePath, 'utf-8');
      
      // Set headers for text file
      reply.header('Content-Type', 'text/plain');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      
      return content;
    } catch (error) {
      fastify.log.error(`Failed to get log file: ${error.message}`);
      reply.code(500);
      return { error: 'Failed to get log file' };
    }
  });
}

export default twitterRoutes; 
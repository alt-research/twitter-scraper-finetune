import fp from 'fastify-plugin';
import { Queue, Worker, QueueEvents } from 'bullmq';
import path from 'path';
import { fileURLToPath } from 'url';

// For ES modules support
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
      
      try {
        const pipeline = new TwitterPipeline(job.data.username);
        
        // Set any custom options from the job data
        if (job.data.options) {
          Object.keys(job.data.options).forEach(key => {
            if (key in pipeline.config.twitter) {
              pipeline.config.twitter[key] = job.data.options[key];
            }
          });
        }
        
        // Run the pipeline
        await pipeline.run();
        
        // Return the results path
        return {
          status: 'success',
          username: job.data.username,
          paths: pipeline.paths
        };
      } catch (error) {
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
      
      // Import DataOrganizer dynamically
      const { default: DataOrganizer } = await import('../../src/twitter/DataOrganizer.js');
      
      try {
        const organizer = new DataOrganizer(job.data.basePath, job.data.username);
        
        // Process tweets based on the job type
        switch (job.data.action) {
          case 'generate-analytics':
            return await organizer.generateAnalytics(job.data.tweets);
          case 'generate-finetuning':
            return await organizer.generateFinetuningData(job.data.tweets);
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

  twitterScraperWorker.on('failed', (job, err) => {
    fastify.log.error(`Twitter scraper job ${job?.id} failed: ${err.message}`);
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

export default fp(queuePlugin, {
  name: 'queue',
  dependencies: ['redis'],
  fastify: '4.x'
}); 
import fp from 'fastify-plugin';
import Redis from 'ioredis';

/**
 * Redis plugin for Fastify
 * 
 * @param {FastifyInstance} fastify - Fastify instance
 * @param {Object} options - Plugin options
 */
async function redisPlugin(fastify, options) {
  const redisConfig = {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || '',
    maxRetriesPerRequest: null,
    enableReadyCheck: false
  };

  // Create Redis client
  const redis = new Redis(redisConfig);

  // Handle connection events
  redis.on('connect', () => {
    fastify.log.info('Connected to Redis');
  });

  redis.on('error', (err) => {
    fastify.log.error(`Redis connection error: ${err.message}`);
  });

  // Register Redis client with Fastify
  fastify.decorate('redis', redis);

  // Close Redis connection when Fastify closes
  fastify.addHook('onClose', async (instance) => {
    fastify.log.info('Closing Redis connection');
    await instance.redis.quit();
  });
}

export default fp(redisPlugin, {
  name: 'redis',
  fastify: '4.x'
}); 
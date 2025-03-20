import Fastify from 'fastify';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
dotenv.config();

// For ES modules support
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create Fastify instance
const fastify = Fastify({
  logger: {
    transport: {
      target: 'pino-pretty',
      options: {
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
      },
    },
  },
});

// Register plugins
async function registerPlugins() {
  // Redis plugin
  await fastify.register(import('./plugins/redis.js'));
  
  // Queue plugin
  await fastify.register(import('./plugins/queue.js'));
  
  // Routes
  await fastify.register(import('./routes/twitter.js'), { prefix: '/api/twitter' });
  
  // Graceful shutdown
  process.on('SIGINT', async () => {
    fastify.log.info('Shutting down server...');
    await fastify.close();
    process.exit(0);
  });
}

// Start server
async function start() {
  try {
    // Register all plugins
    await registerPlugins();
    
    // Start listening
    await fastify.listen({
      port: process.env.PORT || 3000,
      host: process.env.HOST || '0.0.0.0'
    });
    
    fastify.log.info(`Server is running on ${fastify.server.address().port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start(); 
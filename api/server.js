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
    level: process.env.LOG_LEVEL || 'info',
    transport: {
      target: 'pino-pretty',
      options: {
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
      },
    },
  },
  ajv: {
    customOptions: {
      removeAdditional: false,
      useDefaults: true,
      coerceTypes: true,
      allErrors: true,
      strictSchema: false,  // Allow additional keywords like "example"
      keywords: ['example']  // Register example as a valid keyword
    }
  }
});

// Register plugins
async function registerPlugins() {
  // Database plugin - must be registered first
  await fastify.register(import('./plugins/database.js'));
  
  // Redis plugin
  await fastify.register(import('./plugins/redis.js'));
  
  // Queue plugin
  await fastify.register(import('./plugins/queue.js'));
  
  // Swagger documentation
  await fastify.register(import('./plugins/swagger.js'));
  
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
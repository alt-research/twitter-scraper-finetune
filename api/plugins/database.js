import fp from 'fastify-plugin';
import { initializeDatabase, AppDataSource } from '../database/typeorm.config.js';

/**
 * TypeORM database plugin for Fastify
 * 
 * @param {FastifyInstance} fastify - Fastify instance
 * @param {Object} options - Plugin options
 */
async function databasePlugin(fastify, options) {
  try {
    // Initialize database connection
    const dataSource = await initializeDatabase();
    
    // Make the DataSource available to the entire application
    fastify.decorate('db', dataSource);
    
    // Also decorate with repository getters for easier access
    fastify.decorate('repositories', {
      get tweet() {
        return dataSource.getRepository('Tweet');
      },
      get user() {
        return dataSource.getRepository('User');
      },
      get analytics() {
        return dataSource.getRepository('Analytics');
      },
      get tweetsView() {
        return dataSource.getRepository('TweetsView');
      }
    });
    
    // Log successful connection
    fastify.log.info('Database connection established');
    
    // Close database connection when Fastify closes
    fastify.addHook('onClose', async (instance) => {
      if (dataSource.isInitialized) {
        await dataSource.destroy();
        fastify.log.info('Database connection closed');
      }
    });
  } catch (error) {
    fastify.log.error(`Failed to initialize database: ${error.message}`);
    throw error;
  }
}

export default fp(databasePlugin, {
  name: 'database',
  fastify: '4.x'
}); 
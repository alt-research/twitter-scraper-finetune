import fastifyPlugin from 'fastify-plugin';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';

/**
 * Plugin to add Swagger documentation to the Fastify instance
 *
 * @param {FastifyInstance} fastify - Fastify instance
 * @param {Object} options - Plugin options
 */
async function swaggerPlugin(fastify, options) {
  // Register Swagger for API schema generation
  await fastify.register(swagger, {
    openapi: {
      info: {
        title: 'Twitter Scraper API',
        description: 'API for scraping Twitter data and generating analytics',
        version: '1.0.0',
        contact: {
          name: 'API Support',
          email: 'support@twitter-scraper.com',
          url: 'https://twitter-scraper.com/support'
        },
        license: {
          name: 'MIT',
          url: 'https://opensource.org/licenses/MIT'
        },
        termsOfService: 'https://twitter-scraper.com/terms'
      },
      externalDocs: {
        description: 'Find more info here',
        url: 'https://twitter-scraper.com/docs'
      },
      servers: [
        {
          url: process.env.API_BASE_URL || 'http://localhost:3000',
          description: process.env.NODE_ENV === 'production' ? 'Production server' : 'Local development server'
        }
      ],
      components: {
        securitySchemes: {
          apiKey: {
            type: 'apiKey',
            name: 'x-api-key',
            in: 'header',
            description: 'API key for authentication'
          }
        }
      },
      tags: [
        { name: 'health', description: 'API health check endpoints' },
        { name: 'scraping', description: 'Endpoints for scraping Twitter data' },
        { name: 'processing', description: 'Endpoints for processing Twitter data' },
        { name: 'jobs', description: 'Endpoints for managing scraping and processing jobs' },
        { name: 'tweets', description: 'Endpoints for retrieving scraped tweets' },
        { name: 'analytics', description: 'Endpoints for retrieving tweet analytics' },
        { name: 'admin', description: 'Administrative endpoints for system management' },
        { name: 'logs', description: 'Log file management endpoints' }
      ]
    }
  });

  // Register Swagger UI for interactive documentation
  await fastify.register(swaggerUI, {
    routePrefix: '/documentation',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
      displayRequestDuration: true,
      filter: true,
      showExtensions: true,
      showCommonExtensions: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha'
    },
    staticCSP: true,
    transformSpecification: (swaggerObject) => {
      // Transform "example" to "examples" for OpenAPI compliance
      const processObject = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        Object.keys(obj).forEach(key => {
          if (obj[key] && typeof obj[key] === 'object') {
            processObject(obj[key]);
          }
          if (key === 'example' && obj.type && !obj.examples) {
            obj.examples = { example1: { value: obj[key] } };
            delete obj.example;
          }
        });
      };
      processObject(swaggerObject);
      return swaggerObject;
    },
    transformSpecificationClone: true,
    theme: {
      title: 'Twitter Scraper API Documentation'
    }
  });

  fastify.log.info('Swagger documentation enabled at /documentation');
}

export default fastifyPlugin(swaggerPlugin);

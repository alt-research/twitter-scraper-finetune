import { AppDataSource } from '../typeorm.config.js';

/**
 * Runs the database migrations
 */
async function runMigrations() {
  try {
    // Check if connection is already initialized
    if (!AppDataSource.isInitialized) {
      // Initialize the data source
      await AppDataSource.initialize();
      console.log('Data Source has been initialized!');
    } else {
      console.log('Using existing database connection');
    }

    // Run migrations
    console.log('Running migrations...');
    const migrations = await AppDataSource.runMigrations();
    
    if (migrations.length === 0) {
      console.log('No pending migrations found!');
    } else {
      console.log(`Successfully ran ${migrations.length} migrations:`);
      migrations.forEach(migration => {
        console.log(`- ${migration.name}`);
      });
    }

    // Close the connection only if we initialized it
    if (AppDataSource.isInitialized && !process.env.KEEP_CONNECTION_OPEN) {
      await AppDataSource.destroy();
      console.log('Connection closed.');
    }
    
    if (!process.env.KEEP_CONNECTION_OPEN) {
      process.exit(0);
    }
  } catch (error) {
    console.error('Error during migration:', error);
    if (!process.env.KEEP_CONNECTION_OPEN) {
      process.exit(1);
    } else {
      throw error;
    }
  }
}

// Run migrations
runMigrations(); 
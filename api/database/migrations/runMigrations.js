import { AppDataSource } from '../typeorm.config.js';

/**
 * Runs the database migrations
 */
async function runMigrations() {
  try {
    // Initialize the data source
    await AppDataSource.initialize();
    console.log('Data Source has been initialized!');

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

    // Close the connection
    await AppDataSource.destroy();
    console.log('Connection closed.');
    
    process.exit(0);
  } catch (error) {
    console.error('Error during migration:', error);
    process.exit(1);
  }
}

// Run migrations
runMigrations(); 
import { DataSource } from 'typeorm';
import * as path from 'path';
import { fileURLToPath } from 'url';

// For ES modules support
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_DATABASE || 'twitter_scraper',
  // synchronize: process.env.NODE_ENV === 'development', // Auto-create schema in development
  synchronize: false,
  logging: process.env.NODE_ENV === 'development',
  entities: [path.join(__dirname, 'entities', '*.js')],
  migrations: [path.join(__dirname, 'migrations', '*.js')],
  migrationsRun: false,
  ssl: { rejectUnauthorized: false },
  subscribers: [],
});

// Initialize and export function to connect to the database
export const initializeDatabase = async () => {
  try {
    await AppDataSource.initialize();
    console.log('Data Source has been initialized!');
    return AppDataSource;
  } catch (error) {
    console.error('Error during Data Source initialization:', error);
    throw error;
  }
}; 
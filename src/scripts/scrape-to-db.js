#!/usr/bin/env node
import inquirer from 'inquirer';
import chalk from 'chalk';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables from .env file
dotenv.config();

import TwitterPipeline from '../twitter/TwitterPipeline.js';

// For ES modules support
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Parse command line arguments
 * @returns {Object} Parsed arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const result = { _: [] };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg.startsWith('--')) {
      // Handle --key=value format
      if (arg.includes('=')) {
        const [key, value] = arg.substring(2).split('=');
        result[key] = value;
      } 
      // Handle --key value format
      else if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        const key = arg.substring(2);
        result[key] = args[++i];
      } 
      // Handle --flag format (boolean flags)
      else {
        const key = arg.substring(2);
        result[key] = true;
      }
    } 
    // Handle positional arguments
    else if (!arg.startsWith('-')) {
      result._.push(arg);
    }
  }
  
  return result;
}

/**
 * Main function to run the Twitter scraper with database storage
 */
async function main() {
  console.log(chalk.bold.cyan('\n🐦 Twitter Scraper - Database Integration Mode'));
  console.log(chalk.grey('Store Twitter data directly in the PostgreSQL database\n'));
  
  // Parse command line arguments
  const args = parseArgs();
  
  // Extract arguments
  const maxTweets = args.maxTweets ? parseInt(args.maxTweets) : undefined;
  
  // Check for required environment variables
  const requiredVars = ['TWITTER_USERNAME', 'TWITTER_PASSWORD', 'TWITTER_EMAIL', 'DATABASE_URL'];
  
  const missingVars = requiredVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    console.log(chalk.red('❌ Missing required environment variables:'));
    missingVars.forEach(varName => {
      console.log(chalk.red(`   - ${varName}`));
    });
    console.log(chalk.yellow('\nPlease add these variables to your .env file or provide credentials via the credentials object:'));
    console.log(chalk.yellow('  --credentials.username=your_username --credentials.password=your_password --credentials.email=your_email'));
    process.exit(1);
  }
  
  // Get username from positional arguments or prompt
  let username = args._[0];
  
  if (!username) {
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'username',
        message: 'Enter Twitter username to scrape (without @):',
        validate: input => input.length > 0 ? true : 'Please enter a valid username'
      },
      {
        type: 'number',
        name: 'maxTweets',
        message: 'Maximum number of tweets to collect (0 for no limit):',
        default: 1000,
        validate: input => input >= 0 ? true : 'Please enter a valid number'
      }
    ]);
    
    username = answers.username;
    
    // Use answers.maxTweets if available and not provided via command line
    if (!maxTweets) {
      process.env.MAX_TWEETS = answers.maxTweets.toString();
    }
  }
  
  // Extract credentials from args if provided
  const credentials = args.credentials || {};
  
  // Prepare options for the pipeline
  const options = {
    credentials: {
      username: credentials.username,
      password: credentials.password,
      email: credentials.email
    },
    maxTweets
  };
  
  // Create pipeline instance with options
  const pipeline = new TwitterPipeline(username, options);
  
  try {
    // Show what credentials we're using (but mask the password)
    console.log(chalk.yellow(`\n🔍 Starting data collection for @${username}`));
    
    if (options.credentials.username) {
      console.log(chalk.grey(`Twitter Auth: ${options.credentials.username} (using provided credentials)`));
    } else {
      console.log(chalk.grey(`Twitter Auth: ${process.env.TWITTER_USERNAME} (using .env credentials)`));
    }
    
    console.log(chalk.grey(`Database: PostgreSQL (${process.env.DATABASE_URL.split('@')[1].split('/')[0]})`));
    
    // Display max tweets setting
    const maxTweetsDisplay = maxTweets || process.env.MAX_TWEETS;
    console.log(chalk.grey(`Max Tweets: ${maxTweetsDisplay === '0' ? 'No limit' : maxTweetsDisplay}\n`));
    
    // Run the pipeline
    const result = await pipeline.run();
    
    if (result && result.tweets && result.tweets.length > 0) {
      console.log(chalk.green(`\n✅ Successfully scraped and stored data for @${username}`));
      console.log(chalk.cyan(`   ${result.tweets.length.toLocaleString()} tweets processed`));
      
      if (result.user) {
        console.log(chalk.cyan(`   User profile data stored`));
      }
    } else {
      console.log(chalk.yellow(`\n⚠️ No tweets were collected for @${username}`));
    }
  } catch (error) {
    console.error(chalk.red(`\n❌ Error occurred during scraping: ${error.message}`));
    
    if (error.stack) {
      console.error(chalk.grey('\nError stack trace:'));
      console.error(chalk.grey(error.stack));
    }
    
    process.exit(1);
  }
}

// Run the main function
main().catch(err => {
  console.error(chalk.red(`Unhandled error: ${err.message}`));
  process.exit(1);
}); 
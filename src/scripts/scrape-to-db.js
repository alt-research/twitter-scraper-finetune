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
 * Main function to run the Twitter scraper with database storage
 */
async function main() {
  console.log(chalk.bold.cyan('\n🐦 Twitter Scraper - Database Integration Mode'));
  console.log(chalk.grey('Store Twitter data directly in the PostgreSQL database\n'));
  
  // Check for required environment variables
  const requiredVars = [
    'TWITTER_EMAIL',
    'TWITTER_USERNAME',
    'TWITTER_PASSWORD',
    'DATABASE_URL'
  ];
  
  const missingVars = requiredVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    console.log(chalk.red('❌ Missing required environment variables:'));
    missingVars.forEach(varName => {
      console.log(chalk.red(`   - ${varName}`));
    });
    console.log(chalk.yellow('\nPlease add these variables to your .env file and try again.'));
    process.exit(1);
  }
  
  // Get username from CLI arguments or prompt
  let username = process.argv[2];
  
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
    
    // Set environment variables based on answers
    process.env.MAX_TWEETS = answers.maxTweets.toString();
  }
  
  // Create pipeline instance
  const pipeline = new TwitterPipeline(username);
  
  try {
    console.log(chalk.yellow(`\n🔍 Starting data collection for @${username}`));
    console.log(chalk.grey(`Database: PostgreSQL (${process.env.DATABASE_URL.split('@')[1].split('/')[0]})`));
    console.log(chalk.grey(`Max Tweets: ${process.env.MAX_TWEETS === '0' ? 'No limit' : process.env.MAX_TWEETS}\n`));
    
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
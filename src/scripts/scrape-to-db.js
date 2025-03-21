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
  
  // Check for required environment variables (DB_URL only)
  if (!process.env.DB_URL) {
    console.log(chalk.red('❌ Missing required DB_URL environment variable'));
    console.log(chalk.yellow('\nPlease add this variable to your .env file and try again.'));
    process.exit(1);
  }
  
  // Parse command line arguments
  const args = process.argv.slice(2);
  let username;
  let maxTweets;
  let twitterCredentials = {
    twitterUsername: process.env.TWITTER_USERNAME,
    twitterPassword: process.env.TWITTER_PASSWORD,
    twitterEmail: process.env.TWITTER_EMAIL
  };
  
  // Check for username as positional argument
  if (args.length > 0 && !args[0].startsWith('--')) {
    username = args[0];
  }
  
  // Check for named arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--username' && i + 1 < args.length) {
      username = args[i + 1];
      i++;
    } else if (args[i] === '--max-tweets' && i + 1 < args.length) {
      maxTweets = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--twitter-username' && i + 1 < args.length) {
      twitterCredentials.twitterUsername = args[i + 1];
      i++;
    } else if (args[i] === '--twitter-password' && i + 1 < args.length) {
      twitterCredentials.twitterPassword = args[i + 1];
      i++;
    } else if (args[i] === '--twitter-email' && i + 1 < args.length) {
      twitterCredentials.twitterEmail = args[i + 1];
      i++;
    }
  }
  
  // Prompt for missing required values
  const prompts = [];
  
  if (!username) {
    prompts.push({
      type: 'input',
      name: 'username',
      message: 'Enter Twitter username to scrape (without @):',
      validate: input => input.length > 0 ? true : 'Please enter a valid username'
    });
  }
  
  if (!maxTweets && maxTweets !== 0) {
    prompts.push({
      type: 'number',
      name: 'maxTweets',
      message: 'Maximum number of tweets to collect (0 for no limit):',
      default: 1000,
      validate: input => input >= 0 ? true : 'Please enter a valid number'
    });
  }
  
  if (!twitterCredentials.twitterUsername) {
    prompts.push({
      type: 'input',
      name: 'twitterUsername',
      message: 'Enter your Twitter username:',
      validate: input => input.length > 0 ? true : 'Please enter a valid Twitter username'
    });
  }
  
  if (!twitterCredentials.twitterPassword) {
    prompts.push({
      type: 'password',
      name: 'twitterPassword',
      message: 'Enter your Twitter password:',
      validate: input => input.length > 0 ? true : 'Please enter your Twitter password'
    });
  }
  
  if (!twitterCredentials.twitterEmail) {
    prompts.push({
      type: 'input',
      name: 'twitterEmail',
      message: 'Enter your Twitter email:',
      validate: input => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input) ? 
                        true : 'Please enter a valid email'
    });
  }
  
  // Ask for any missing values
  if (prompts.length > 0) {
    const answers = await inquirer.prompt(prompts);
    
    username = username || answers.username;
    maxTweets = maxTweets ?? answers.maxTweets;
    
    if (answers.twitterUsername) twitterCredentials.twitterUsername = answers.twitterUsername;
    if (answers.twitterPassword) twitterCredentials.twitterPassword = answers.twitterPassword;
    if (answers.twitterEmail) twitterCredentials.twitterEmail = answers.twitterEmail;
  }
  
  // Set environment variables for the process
  if (maxTweets !== undefined) {
    process.env.MAX_TWEETS = maxTweets.toString();
  }
  
  // Create pipeline instance with credentials
  const pipeline = new TwitterPipeline(username, twitterCredentials);
  
  try {
    console.log(chalk.yellow(`\n🔍 Starting data collection for @${username}`));
    console.log(chalk.grey(`Twitter Account: ${twitterCredentials.twitterUsername}`));
    console.log(chalk.grey(`Database: PostgreSQL (${process.env.DB_URL.split('@')[1].split('/')[0]})`));
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
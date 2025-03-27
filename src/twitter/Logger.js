import chalk from 'chalk';
import ora from 'ora';
import Table from 'cli-table3';
import { format } from 'date-fns';
import fs from 'fs';
import path from 'path';

class Logger {
  static spinner = null;
  static progressBar = null;
  static lastUpdate = Date.now();
  static collectionStats = {
    oldestTweet: null,
    newestTweet: null,
    rateLimitHits: 0,
    resets: 0,
    batchesWithNewTweets: 0,
    totalBatches: 0,
    startTime: Date.now(),
    tweetsPerMinute: 0,
    currentDelay: 0,
    lastResetTime: null
  };
  
  // Determine if debug logs should be shown based on an environment variable
  static isDebugEnabled = process.env.DEBUG === 'true';
  
  // File logging configuration
  static logDir = process.env.LOG_DIR || path.join(process.cwd(), 'logs');
  static logToFile = process.env.LOG_TO_FILE !== 'false'; // Enable file logging by default
  static currentDate = format(new Date(), 'yyyy-MM-dd');
  static logFiles = {
    info: null,
    warn: null,
    error: null,
    debug: null,
    combined: null
  };
  
  // Initialize file logging
  static initFileLogging() {
    if (!this.logToFile) return;
    
    try {
      // Create logs directory if it doesn't exist
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
      
      // Create log files
      this.logFiles.info = fs.createWriteStream(
        path.join(this.logDir, `${this.currentDate}-pipeline-info.log`), 
        { flags: 'a' }
      );
      
      this.logFiles.warn = fs.createWriteStream(
        path.join(this.logDir, `${this.currentDate}-pipeline-warn.log`), 
        { flags: 'a' }
      );
      
      this.logFiles.error = fs.createWriteStream(
        path.join(this.logDir, `${this.currentDate}-pipeline-error.log`), 
        { flags: 'a' }
      );
      
      this.logFiles.debug = fs.createWriteStream(
        path.join(this.logDir, `${this.currentDate}-pipeline-debug.log`), 
        { flags: 'a' }
      );
      
      this.logFiles.combined = fs.createWriteStream(
        path.join(this.logDir, `${this.currentDate}-pipeline-combined.log`), 
        { flags: 'a' }
      );
      
      // Log initialization
      this.writeToFile('info', 'File logging initialized');
      
      // Setup process exit handlers to close log files
      process.on('exit', () => this.closeLogFiles());
      process.on('SIGINT', () => {
        this.writeToFile('info', 'Process interrupted, closing log files');
        this.closeLogFiles();
        process.exit(0);
      });
      
    } catch (error) {
      console.error(`Failed to initialize file logging: ${error.message}`);
      this.logToFile = false;
    }
  }
  
  // Format log message for file
  static formatLogMessage(level, msg) {
    const timestamp = format(new Date(), 'yyyy-MM-dd HH:mm:ss.SSS');
    return `[${timestamp}] [${level.toUpperCase()}] ${msg}\n`;
  }
  
  // Write to log file
  static writeToFile(level, msg) {
    if (!this.logToFile) return;
    
    // Initialize file logging if not already done
    if (!this.logFiles.combined) {
      this.initFileLogging();
    }
    
    try {
      const formattedMsg = this.formatLogMessage(level, msg);
      
      // Write to level-specific log file
      if (this.logFiles[level]) {
        this.logFiles[level].write(formattedMsg);
      }
      
      // Write to combined log file
      if (this.logFiles.combined) {
        this.logFiles.combined.write(formattedMsg);
      }
    } catch (error) {
      console.error(`Failed to write to log file: ${error.message}`);
    }
  }
  
  // Close log files
  static closeLogFiles() {
    if (!this.logToFile) return;
    
    try {
      for (const stream of Object.values(this.logFiles)) {
        if (stream) {
          stream.end();
        }
      }
    } catch (error) {
      console.error(`Failed to close log files: ${error.message}`);
    }
  }

  static startSpinner(text) {
    this.spinner = ora(text).start();
    this.writeToFile('info', text);
  }

  static stopSpinner(success = true) {
    if (this.spinner) {
      success ? this.spinner.succeed() : this.spinner.fail();
      this.spinner = null;
    }
  }

  static info(msg) {
    console.log(chalk.blue(`ℹ️  ${msg}`));
    this.writeToFile('info', msg);
  }

  static success(msg) {
    console.log(chalk.green(`✅ ${msg}`));
    this.writeToFile('info', `SUCCESS: ${msg}`);
  }

  static warn(msg) {
    console.log(chalk.yellow(`⚠️  ${msg}`));
    this.writeToFile('warn', msg);
  }

  static error(msg) {
    console.log(chalk.red(`❌ ${msg}`));
    this.writeToFile('error', msg);
  }

  static debug(msg) {
    if (this.isDebugEnabled) {
      console.log(chalk.gray(`🔍 Debug: ${msg}`));
    }
    this.writeToFile('debug', msg);
  }

  static updateCollectionProgress({
    totalCollected,
    newInBatch = 0,
    batchSize = 0,
    oldestTweetDate = null,
    newestTweetDate = null,
    currentDelay = 0,
    isReset = false
  }) {
    const now = Date.now();
    
    // Update stats
    this.collectionStats.totalBatches++;
    if (newInBatch > 0) this.collectionStats.batchesWithNewTweets++;
    if (isReset) this.collectionStats.resets++;
    this.collectionStats.currentDelay = currentDelay;
    
    // Update date range
    if (oldestTweetDate) {
      this.collectionStats.oldestTweet = !this.collectionStats.oldestTweet ? 
        oldestTweetDate : 
        Math.min(this.collectionStats.oldestTweet, oldestTweetDate);
    }
    if (newestTweetDate) {
      this.collectionStats.newestTweet = !this.collectionStats.newestTweet ? 
        newestTweetDate : 
        Math.max(this.collectionStats.newestTweet, newestTweetDate);
    }

    // Calculate efficiency metrics
    const runningTime = (now - this.collectionStats.startTime) / 1000 / 60; // minutes
    this.collectionStats.tweetsPerMinute = (totalCollected / runningTime).toFixed(1);

    // Only update display every second to avoid spam
    if (now - this.lastUpdate > 1000) {
      this.displayCollectionStatus({
        totalCollected,
        newInBatch,
        batchSize,
        isReset
      });
      this.lastUpdate = now;
    }
  }

  static displayCollectionStatus({ totalCollected, newInBatch, batchSize, isReset }) {
    console.clear(); // Clear console for clean display
    
    // Display collection header
    console.log(chalk.bold.blue('\n🐦 Twitter Collection Status\n'));

    // Display current activity
    if (isReset) {
      console.log(chalk.yellow('↩️  Resetting collection position...\n'));
    }

    // Create status table
    const table = new Table({
      head: [chalk.white('Metric'), chalk.white('Value')],
      colWidths: [25, 50]
    });

    // Add current status
    table.push(
      ['Total Tweets Collected', chalk.green(totalCollected.toLocaleString())],
      ['Collection Rate', `${chalk.cyan(this.collectionStats.tweetsPerMinute)} tweets/minute`],
      ['Current Delay', `${chalk.yellow(this.collectionStats.currentDelay)}ms`],
      ['Batch Efficiency', `${chalk.cyan((this.collectionStats.batchesWithNewTweets / this.collectionStats.totalBatches * 100).toFixed(1))}%`],
      ['Position Resets', chalk.yellow(this.collectionStats.resets)],
      ['Rate Limit Hits', chalk.red(this.collectionStats.rateLimitHits)]
    );

    // Add date range if we have it
    if (this.collectionStats.oldestTweet) {
      const dateRange = `${format(this.collectionStats.oldestTweet, 'yyyy-MM-dd')} to ${format(this.collectionStats.newestTweet, 'yyyy-MM-dd')}`;
      table.push(['Date Range', chalk.cyan(dateRange)]);
    }

    // Add latest batch info
    table.push(
      ['Latest Batch', `${chalk.green(newInBatch)} new / ${chalk.blue(batchSize)} total`]
    );

    console.log(table.toString());
    
    // Add running time
    const runningTime = Math.floor((Date.now() - this.collectionStats.startTime) / 1000);
    console.log(chalk.dim(`\nRunning for ${Math.floor(runningTime / 60)}m ${runningTime % 60}s`));
    
    // Log to file
    this.writeToFile('info', `Status: ${totalCollected} tweets collected, ${newInBatch} new in latest batch, running for ${Math.floor(runningTime / 60)}m ${runningTime % 60}s`);
  }

  static recordRateLimit() {
    this.collectionStats.rateLimitHits++;
    this.collectionStats.lastResetTime = Date.now();
    this.writeToFile('warn', 'Rate limit hit recorded');
  }

  static stats(title, data) {
    console.log(chalk.cyan(`\n📊 ${title}:`));
    const table = new Table({
      head: [chalk.white('Parameter'), chalk.white('Value')],
      colWidths: [25, 60],
    });
    Object.entries(data).forEach(([key, value]) => {
      table.push([chalk.white(key), value]);
    });
    console.log(table.toString());
    
    // Log statistics to file
    this.writeToFile('info', `STATS - ${title}:`);
    Object.entries(data).forEach(([key, value]) => {
      this.writeToFile('info', `  ${key}: ${value}`);
    });
  }

  static reset() {
    this.collectionStats = {
      oldestTweet: null,
      newestTweet: null,
      rateLimitHits: 0,
      resets: 0,
      batchesWithNewTweets: 0,
      totalBatches: 0,
      startTime: Date.now(),
      tweetsPerMinute: 0,
      currentDelay: 0,
      lastResetTime: null
    };
    this.lastUpdate = Date.now();
    this.writeToFile('info', 'Logger stats reset');
  }
}

// Initialize file logging when module is loaded
Logger.initFileLogging();

export default Logger;

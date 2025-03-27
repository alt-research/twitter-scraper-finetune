import fs from 'fs';
import path from 'path';
import { format } from 'date-fns';
import fp from 'fastify-plugin';

/**
 * File logger plugin for Fastify
 * - Creates log files organized by date and level
 * - Intercepts Fastify's built-in logging methods 
 * - Provides a method to get log file paths
 */
async function fileLogger(fastify, options) {
  const logDir = options.logDir || process.env.LOG_DIR || path.join(process.cwd(), 'logs');
  const logToFile = process.env.LOG_TO_FILE !== 'false'; // Enable file logging by default
  const currentDate = format(new Date(), 'yyyy-MM-dd');
  
  // Initialize log file paths
  const logFiles = {
    info: null,
    warn: null,
    error: null,
    debug: null,
    combined: null,
  };
  
  // Add method to get log file paths
  fastify.decorate('getLogFilesPath', () => {
    return {
      directory: logDir,
      files: {
        info: logFiles.info ? path.join(logDir, `${currentDate}-info.log`) : null,
        warn: logFiles.warn ? path.join(logDir, `${currentDate}-warn.log`) : null,
        error: logFiles.error ? path.join(logDir, `${currentDate}-error.log`) : null,
        debug: logFiles.debug ? path.join(logDir, `${currentDate}-debug.log`) : null,
        combined: logFiles.combined ? path.join(logDir, `${currentDate}-combined.log`) : null,
      }
    };
  });
  
  // If file logging is disabled, don't proceed with setup
  if (!logToFile) {
    fastify.log.info('File logging is disabled');
    return;
  }
  
  try {
    // Create logs directory if it doesn't exist
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    
    // Create log file streams
    logFiles.info = fs.createWriteStream(
      path.join(logDir, `${currentDate}-info.log`), 
      { flags: 'a' }
    );
    
    logFiles.warn = fs.createWriteStream(
      path.join(logDir, `${currentDate}-warn.log`), 
      { flags: 'a' }
    );
    
    logFiles.error = fs.createWriteStream(
      path.join(logDir, `${currentDate}-error.log`), 
      { flags: 'a' }
    );
    
    logFiles.debug = fs.createWriteStream(
      path.join(logDir, `${currentDate}-debug.log`), 
      { flags: 'a' }
    );
    
    logFiles.combined = fs.createWriteStream(
      path.join(logDir, `${currentDate}-combined.log`), 
      { flags: 'a' }
    );
    
    // Format log message for file
    function formatLogMessage(level, message) {
      const timestamp = format(new Date(), 'yyyy-MM-dd HH:mm:ss.SSS');
      return `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
    }
    
    // Write to log file
    function writeToFile(level, message) {
      try {
        const formattedMsg = formatLogMessage(level, message);
        
        // Write to level-specific log file
        if (logFiles[level]) {
          logFiles[level].write(formattedMsg);
        }
        
        // Write to combined log file
        if (logFiles.combined) {
          logFiles.combined.write(formattedMsg);
        }
      } catch (error) {
        console.error(`Failed to write to log file: ${error.message}`);
      }
    }
    
    // Store original log methods
    const originalLogMethods = {
      info: fastify.log.info,
      error: fastify.log.error,
      warn: fastify.log.warn,
      debug: fastify.log.debug,
      trace: fastify.log.trace,
      fatal: fastify.log.fatal,
    };
    
    // Override log methods to also write to files
    fastify.log.info = function(msg, ...args) {
      writeToFile('info', typeof msg === 'string' ? msg : JSON.stringify(msg));
      return originalLogMethods.info.call(this, msg, ...args);
    };
    
    fastify.log.error = function(msg, ...args) {
      writeToFile('error', typeof msg === 'string' ? msg : JSON.stringify(msg));
      return originalLogMethods.error.call(this, msg, ...args);
    };
    
    fastify.log.warn = function(msg, ...args) {
      writeToFile('warn', typeof msg === 'string' ? msg : JSON.stringify(msg));
      return originalLogMethods.warn.call(this, msg, ...args);
    };
    
    fastify.log.debug = function(msg, ...args) {
      writeToFile('debug', typeof msg === 'string' ? msg : JSON.stringify(msg));
      return originalLogMethods.debug.call(this, msg, ...args);
    };
    
    fastify.log.trace = function(msg, ...args) {
      writeToFile('debug', typeof msg === 'string' ? msg : JSON.stringify(msg));
      return originalLogMethods.trace.call(this, msg, ...args);
    };
    
    fastify.log.fatal = function(msg, ...args) {
      writeToFile('error', typeof msg === 'string' ? msg : JSON.stringify(msg));
      return originalLogMethods.fatal.call(this, msg, ...args);
    };
    
    // Setup process exit handlers to close log files
    function closeLogFiles() {
      try {
        for (const stream of Object.values(logFiles)) {
          if (stream) {
            stream.end();
          }
        }
      } catch (error) {
        console.error(`Failed to close log files: ${error.message}`);
      }
    }
    
    process.on('exit', closeLogFiles);
    process.on('SIGINT', () => {
      writeToFile('info', 'Process interrupted, closing log files');
      closeLogFiles();
      process.exit(0);
    });
    
    // Log initialization
    writeToFile('info', 'File logging initialized');
    fastify.log.info('File logging initialized');
    
  } catch (error) {
    fastify.log.error(`Failed to initialize file logging: ${error.message}`);
  }
}

export default fp(fileLogger, {
  fastify: '4.x',
  name: 'file-logger'
}); 
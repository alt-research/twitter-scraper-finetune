import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// For ES modules support
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Database Logger Utility
 * Handles logging database errors to files for better debugging
 */
class DbLogger {
  constructor() {
    // Default configuration
    this.config = {
      logDir: path.join(process.cwd(), 'db_logs'),
      maxLogSize: 10 * 1024 * 1024, // 10 MB
      maxLogFiles: 20,
      logLevels: {
        ERROR: 0,
        WARN: 1,
        INFO: 2,
        DEBUG: 3
      },
      currentLogLevel: process.env.DB_LOG_LEVEL || 'ERROR',
      timeZone: 'UTC'
    };
    
    // Initialize logger
    this.init().catch(err => {
      console.error(`Failed to initialize database logger: ${err.message}`);
    });
  }
  
  /**
   * Initialize the logger, ensuring log directory exists
   */
  async init() {
    await this.ensureLogDirectoryExists();
  }
  
  /**
   * Ensure the log directory exists
   */
  async ensureLogDirectoryExists() {
    try {
      await fs.mkdir(this.config.logDir, { recursive: true });
    } catch (err) {
      console.error(`Failed to create log directory: ${err.message}`);
      throw err;
    }
  }
  
  /**
   * Format a log message with timestamp and details
   * 
   * @param {string} level - Log level (ERROR, WARN, INFO, DEBUG)
   * @param {string} message - The log message
   * @param {Error} error - The error object
   * @param {Object} context - Additional context for the log
   * @returns {string} - Formatted log entry
   */
  formatLogMessage(level, message, error, context = {}) {
    const timestamp = new Date().toISOString();
    const errorStack = error?.stack || '';
    const errorMessage = error?.message || '';
    const errorName = error?.name || '';
    const errorCode = error?.code || '';
    
    let formattedContext = '';
    if (Object.keys(context).length > 0) {
      try {
        formattedContext = JSON.stringify(context, null, 2);
      } catch (e) {
        formattedContext = `[Error serializing context: ${e.message}]`;
      }
    }
    
    return `[${timestamp}] [${level}] ${message}\n` +
           `Error: ${errorName} - ${errorMessage}\n` +
           `Code: ${errorCode}\n` +
           `Context: ${formattedContext}\n` +
           `Stack: ${errorStack}\n` +
           '---------------------------------------------\n';
  }
  
  /**
   * Write a log entry to a file
   * 
   * @param {string} logFile - Path to the log file
   * @param {string} entry - The log entry to write
   */
  async writeLog(logFile, entry) {
    try {
      // Ensure directory exists
      await this.ensureLogDirectoryExists();
      
      // Check if file exists and rotate if needed
      try {
        const stats = await fs.stat(logFile);
        if (stats.size > this.config.maxLogSize) {
          await this.rotateLog(logFile);
        }
      } catch (err) {
        // File doesn't exist, will be created
      }
      
      // Append log entry to file
      await fs.appendFile(logFile, entry, 'utf8');
    } catch (err) {
      console.error(`Failed to write to log file: ${err.message}`);
    }
  }
  
  /**
   * Rotate log files when they exceed the maximum size
   * 
   * @param {string} logFile - Path to the log file to rotate
   */
  async rotateLog(logFile) {
    try {
      // Get base name for rotated logs
      const baseName = path.basename(logFile);
      const dirName = path.dirname(logFile);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const rotatedName = path.join(dirName, `${baseName}.${timestamp}`);
      
      // Rename current log file
      await fs.rename(logFile, rotatedName);
      
      // Clean up old log files if we have too many
      await this.cleanupOldLogs(dirName, baseName);
    } catch (err) {
      console.error(`Failed to rotate log file: ${err.message}`);
    }
  }
  
  /**
   * Clean up old log files when there are too many
   * 
   * @param {string} dirName - Directory containing log files
   * @param {string} baseName - Base name pattern for the log files
   */
  async cleanupOldLogs(dirName, baseName) {
    try {
      // Get all log files in the directory
      const files = await fs.readdir(dirName);
      const pattern = new RegExp(`^${baseName}\\.(.*)`);
      
      // Filter for rotated log files matching our pattern
      const logFiles = files
        .filter(file => pattern.test(file))
        .map(file => ({
          name: file,
          path: path.join(dirName, file),
          time: 0
        }));
      
      // Get file stats for each log file
      for (const logFile of logFiles) {
        const stats = await fs.stat(logFile.path);
        logFile.time = stats.mtime.getTime();
      }
      
      // Sort by modification time (oldest first)
      logFiles.sort((a, b) => a.time - b.time);
      
      // Remove oldest files if we have too many
      if (logFiles.length > this.config.maxLogFiles) {
        const filesToRemove = logFiles.slice(0, logFiles.length - this.config.maxLogFiles);
        for (const file of filesToRemove) {
          await fs.unlink(file.path);
        }
      }
    } catch (err) {
      console.error(`Failed to clean up old logs: ${err.message}`);
    }
  }
  
  /**
   * Log a database-related error
   * 
   * @param {string} operation - The database operation that failed
   * @param {Error} error - The error object
   * @param {Object} context - Additional context for the log
   */
  async logDbError(operation, error, context = {}) {
    const message = `Database operation failed: ${operation}`;
    const logEntry = this.formatLogMessage('ERROR', message, error, context);
    const logFile = path.join(this.config.logDir, 'db-errors.log');
    await this.writeLog(logFile, logEntry);
  }
  
  /**
   * Log a database connection error
   * 
   * @param {Error} error - The connection error
   * @param {Object} context - Additional context for the log
   */
  async logConnectionError(error, context = {}) {
    const message = `Database connection error`;
    const logEntry = this.formatLogMessage('ERROR', message, error, context);
    const logFile = path.join(this.config.logDir, 'db-connection-errors.log');
    await this.writeLog(logFile, logEntry);
  }
  
  /**
   * Log a database transaction error
   * 
   * @param {Error} error - The transaction error
   * @param {Object} context - Additional context for the log
   */
  async logTransactionError(error, context = {}) {
    const message = `Database transaction error`;
    const logEntry = this.formatLogMessage('ERROR', message, error, context);
    const logFile = path.join(this.config.logDir, 'db-transaction-errors.log');
    await this.writeLog(logFile, logEntry);
  }
  
  /**
   * Log a database query error
   * 
   * @param {string} query - The SQL query that failed
   * @param {Error} error - The error object
   * @param {Object} context - Additional context for the log
   */
  async logQueryError(query, error, context = {}) {
    const message = `Database query error`;
    const contextWithQuery = { ...context, query };
    const logEntry = this.formatLogMessage('ERROR', message, error, contextWithQuery);
    const logFile = path.join(this.config.logDir, 'db-query-errors.log');
    await this.writeLog(logFile, logEntry);
  }
  
  /**
   * Log database information (not errors)
   * 
   * @param {string} message - Informational message
   * @param {Object} context - Additional context for the log
   */
  async logInfo(message, context = {}) {
    // Skip if log level is below INFO
    if (this.config.logLevels[this.config.currentLogLevel] < this.config.logLevels.INFO) {
      return;
    }
    
    const logEntry = this.formatLogMessage('INFO', message, null, context);
    const logFile = path.join(this.config.logDir, 'db-info.log');
    await this.writeLog(logFile, logEntry);
  }
  
  /**
   * Log database debug information
   * 
   * @param {string} message - Debug message
   * @param {Object} context - Additional context for the log
   */
  async logDebug(message, context = {}) {
    // Skip if log level is below DEBUG
    if (this.config.logLevels[this.config.currentLogLevel] < this.config.logLevels.DEBUG) {
      return;
    }
    
    const logEntry = this.formatLogMessage('DEBUG', message, null, context);
    const logFile = path.join(this.config.logDir, 'db-debug.log');
    await this.writeLog(logFile, logEntry);
  }
  
  /**
   * Log database warnings
   * 
   * @param {string} message - Warning message
   * @param {Object} context - Additional context for the log
   */
  async logWarning(message, context = {}) {
    // Skip if log level is below WARN
    if (this.config.logLevels[this.config.currentLogLevel] < this.config.logLevels.WARN) {
      return;
    }
    
    const logEntry = this.formatLogMessage('WARN', message, null, context);
    const logFile = path.join(this.config.logDir, 'db-warnings.log');
    await this.writeLog(logFile, logEntry);
  }
}

// Export singleton instance
const dbLogger = new DbLogger();
export default dbLogger; 
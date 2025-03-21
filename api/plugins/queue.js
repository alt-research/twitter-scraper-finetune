import fp from 'fastify-plugin';
import { Queue, Worker, QueueEvents } from 'bullmq';
import path from 'path';
import { fileURLToPath } from 'url';

// For ES modules support
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * BullMQ queue plugin for Fastify
 * 
 * @param {FastifyInstance} fastify - Fastify instance
 * @param {Object} options - Plugin options
 */
async function queuePlugin(fastify, options) {
  // Define queues
  const queues = {
    twitterScraper: new Queue('twitter-scraper', {
      connection: fastify.redis,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000
        },
        removeOnComplete: 100,
        removeOnFail: 200
      }
    }),
    tweetProcessor: new Queue('tweet-processor', {
      connection: fastify.redis,
      defaultJobOptions: {
        attempts: 2,
        backoff: {
          type: 'fixed',
          delay: 5000
        }
      }
    })
  };

  // Create worker for Twitter scraper queue
  const twitterScraperWorker = new Worker(
    'twitter-scraper',
    async (job) => {
      fastify.log.info(`Processing job ${job.id} to scrape tweets for @${job.data.username}`);
      
      // Import TwitterPipeline dynamically
      const { default: TwitterPipeline } = await import('../../src/twitter/TwitterPipeline.js');
      
      try {
        const pipeline = new TwitterPipeline(job.data.username);
        
        // Set any custom options from the job data
        if (job.data.options) {
          Object.keys(job.data.options).forEach(key => {
            if (key in pipeline.config.twitter) {
              pipeline.config.twitter[key] = job.data.options[key];
            }
          });
        }
        
        // Run the pipeline to get tweets
        const { tweets, user: scrapedUserData } = await pipeline.run();
        
        // Store in database if flag is set
        if (job.data.storeInDatabase) {
          await storeTweetsInDatabase(fastify, job.data.username, tweets, scrapedUserData);
        }
        
        // Return the results
        return {
          status: 'success',
          username: job.data.username,
          tweetCount: tweets?.length || 0
        };
      } catch (error) {
        fastify.log.error(`Failed to scrape tweets for @${job.data.username}: ${error.message}`);
        throw error;
      }
    },
    { connection: fastify.redis }
  );

  // Create worker for tweet processor queue
  const tweetProcessorWorker = new Worker(
    'tweet-processor',
    async (job) => {
      fastify.log.info(`Processing tweets for further analysis: ${job.id}`);
      
      try {
        // Handle different processing actions
        switch (job.data.action) {
          case 'generate-analytics':
            return await generateAnalytics(fastify, job.data.username, job.data.userId);
          case 'generate-finetuning':
            return await generateFinetuningData(fastify, job.data.username, job.data.userId);
          default:
            throw new Error(`Unknown tweet processing action: ${job.data.action}`);
        }
      } catch (error) {
        fastify.log.error(`Failed to process tweets: ${error.message}`);
        throw error;
      }
    },
    { connection: fastify.redis }
  );

  // Handle worker events
  twitterScraperWorker.on('completed', (job) => {
    fastify.log.info(`Twitter scraper job ${job.id} completed successfully`);
  });

  twitterScraperWorker.on('failed', (job, err) => {
    fastify.log.error(`Twitter scraper job ${job?.id} failed: ${err.message}`);
  });

  tweetProcessorWorker.on('completed', (job) => {
    fastify.log.info(`Tweet processor job ${job.id} completed successfully`);
  });

  tweetProcessorWorker.on('failed', (job, err) => {
    fastify.log.error(`Tweet processor job ${job?.id} failed: ${err.message}`);
  });

  // Register queues with Fastify
  fastify.decorate('queues', queues);

  // Add a hook to close all queues when Fastify closes
  fastify.addHook('onClose', async (instance) => {
    fastify.log.info('Closing queue connections');
    await Promise.all([
      twitterScraperWorker.close(),
      tweetProcessorWorker.close(),
      ...Object.values(queues).map(queue => queue.close())
    ]);
  });
}

/**
 * Store scraped tweets in the database
 * 
 * @param {FastifyInstance} fastify - Fastify instance
 * @param {string} username - Twitter username
 * @param {Array} tweets - Array of scraped tweets
 * @param {Object} userData - Scraped user data
 */
async function storeTweetsInDatabase(fastify, username, tweets = [], userData = {}) {
  try {
    // Get repositories
    const userRepo = fastify.repositories.user;
    const tweetRepo = fastify.repositories.tweet;
    
    // Find or create the user
    let user = await userRepo.findOne({ where: { username } });
    
    if (!user) {
      fastify.log.warn(`User ${username} not found in database. Creating new record.`);
      user = userRepo.create({ username });
    }
    
    // Update user data from scraped info
    if (userData) {
      user.displayName = userData.name || userData.displayName;
      user.profileImageUrl = userData.profileImageUrl;
      user.bio = userData.description || userData.bio;
      user.location = userData.location;
      user.url = userData.url;
      user.followersCount = userData.followersCount;
      user.followingCount = userData.followingCount;
      user.tweetCount = userData.statusesCount || userData.tweetCount;
      user.verified = userData.verified || false;
      user.protected = userData.protected || false;
      user.joinedAt = userData.createdAt || userData.joinedAt;
      user.lastScrapedAt = new Date();
    }
    
    // Save user record
    await userRepo.save(user);
    fastify.log.info(`Saved user ${username} with ID ${user.id}`);
    
    // Process tweets in batches to avoid memory issues
    const batchSize = 100;
    let totalSaved = 0;
    
    for (let i = 0; i < tweets.length; i += batchSize) {
      const batch = tweets.slice(i, i + batchSize);
      
      // Process each tweet in batch
      const tweetEntities = batch.map(tweet => {
        // Parse tweet data
        const tweetData = parseTweetForDatabase(tweet, user.id);
        
        // Create tweet entity
        return tweetRepo.create(tweetData);
      });
      
      // Save batch
      await tweetRepo.save(tweetEntities);
      totalSaved += tweetEntities.length;
      
      fastify.log.info(`Saved batch of ${tweetEntities.length} tweets, progress: ${totalSaved}/${tweets.length}`);
    }
    
    fastify.log.info(`Successfully saved ${totalSaved} tweets for user ${username}`);
    
    return {
      status: 'success',
      username,
      savedTweets: totalSaved
    };
  } catch (error) {
    fastify.log.error(`Failed to store tweets in database: ${error.message}`);
    throw error;
  }
}

/**
 * Parse a tweet object for database storage
 * 
 * @param {Object} tweet - Tweet object from the scraper
 * @param {string} userId - Database user ID
 * @returns {Object} - Parsed tweet object ready for database
 */
function parseTweetForDatabase(tweet, userId) {
  // Extract relevant fields
  return {
    userId: userId,
    tweetId: tweet.id_str || tweet.id,
    text: tweet.text || tweet.full_text || '',
    fullText: tweet.full_text || tweet.text || '',
    lang: tweet.lang,
    type: determineTweetType(tweet),
    replyToTweetId: tweet.in_reply_to_status_id_str,
    replyToUserId: tweet.in_reply_to_user_id_str,
    replyToUsername: tweet.in_reply_to_screen_name,
    retweetedTweetId: tweet.retweeted_status?.id_str,
    retweetedUserId: tweet.retweeted_status?.user?.id_str,
    retweetedUsername: tweet.retweeted_status?.user?.screen_name,
    quotedTweetId: tweet.quoted_status?.id_str,
    quotedUserId: tweet.quoted_status?.user?.id_str,
    quotedUsername: tweet.quoted_status?.user?.screen_name,
    quotedText: tweet.quoted_status?.text || tweet.quoted_status?.full_text,
    likeCount: tweet.favorite_count || 0,
    retweetCount: tweet.retweet_count || 0,
    replyCount: tweet.reply_count || 0,
    quoteCount: tweet.quote_count || 0,
    viewCount: tweet.view_count,
    urls: extractUrls(tweet),
    hashtags: extractHashtags(tweet),
    mentions: extractMentions(tweet),
    media: extractMedia(tweet),
    conversationId: tweet.conversation_id_str || tweet.conversation_id,
    postedAt: tweet.created_at ? new Date(tweet.created_at) : null,
    rawJson: tweet // Store the full tweet JSON for future reference
  };
}

/**
 * Determine the type of tweet
 * 
 * @param {Object} tweet - Tweet object
 * @returns {string} - Tweet type (original, reply, retweet, quote)
 */
function determineTweetType(tweet) {
  if (tweet.retweeted_status) {
    return 'retweet';
  } else if (tweet.quoted_status) {
    return 'quote';
  } else if (tweet.in_reply_to_status_id_str) {
    return 'reply';
  } else {
    return 'original';
  }
}

/**
 * Extract URLs from a tweet
 * 
 * @param {Object} tweet - Tweet object
 * @returns {Array} - Array of URL objects
 */
function extractUrls(tweet) {
  const urls = [];
  
  // Check entities
  if (tweet.entities?.urls?.length) {
    urls.push(...tweet.entities.urls.map(url => ({
      url: url.url,
      expanded_url: url.expanded_url,
      display_url: url.display_url
    })));
  }
  
  // Check extended_entities
  if (tweet.extended_entities?.urls?.length) {
    urls.push(...tweet.extended_entities.urls.map(url => ({
      url: url.url,
      expanded_url: url.expanded_url,
      display_url: url.display_url
    })));
  }
  
  return urls.length > 0 ? urls : null;
}

/**
 * Extract hashtags from a tweet
 * 
 * @param {Object} tweet - Tweet object
 * @returns {Array} - Array of hashtag objects
 */
function extractHashtags(tweet) {
  if (tweet.entities?.hashtags?.length) {
    return tweet.entities.hashtags.map(tag => ({
      text: tag.text
    }));
  }
  return null;
}

/**
 * Extract mentions from a tweet
 * 
 * @param {Object} tweet - Tweet object
 * @returns {Array} - Array of mention objects
 */
function extractMentions(tweet) {
  if (tweet.entities?.user_mentions?.length) {
    return tweet.entities.user_mentions.map(mention => ({
      user_id: mention.id_str,
      username: mention.screen_name,
      name: mention.name
    }));
  }
  return null;
}

/**
 * Extract media from a tweet
 * 
 * @param {Object} tweet - Tweet object
 * @returns {Array} - Array of media objects
 */
function extractMedia(tweet) {
  const media = [];
  
  // Check entities
  if (tweet.entities?.media?.length) {
    media.push(...tweet.entities.media.map(m => ({
      id: m.id_str,
      type: m.type,
      url: m.url,
      media_url: m.media_url_https || m.media_url,
      display_url: m.display_url
    })));
  }
  
  // Check extended_entities
  if (tweet.extended_entities?.media?.length) {
    media.push(...tweet.extended_entities.media.map(m => ({
      id: m.id_str,
      type: m.type,
      url: m.url,
      media_url: m.media_url_https || m.media_url,
      display_url: m.display_url,
      video_info: m.video_info
    })));
  }
  
  return media.length > 0 ? media : null;
}

/**
 * Generate analytics for a user's tweets
 * 
 * @param {FastifyInstance} fastify - Fastify instance
 * @param {string} username - Twitter username
 * @param {string} userId - Database user ID
 * @returns {Object} - Analytics results
 */
async function generateAnalytics(fastify, username, userId) {
  try {
    // Get repositories
    const userRepo = fastify.repositories.user;
    const tweetRepo = fastify.repositories.tweet;
    const analyticsRepo = fastify.repositories.analytics;
    
    // Find the user
    const user = await userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new Error(`User with ID ${userId} not found`);
    }
    
    // Get all user's tweets
    const tweets = await tweetRepo.find({ where: { userId } });
    
    if (tweets.length === 0) {
      throw new Error(`No tweets found for user ${username}`);
    }
    
    // Compute analytics
    const analytics = {
      userId,
      tweetCount: tweets.length,
      originalTweetCount: tweets.filter(t => t.type === 'original').length,
      replyCount: tweets.filter(t => t.type === 'reply').length,
      retweetCount: tweets.filter(t => t.type === 'retweet').length,
      quoteCount: tweets.filter(t => t.type === 'quote').length,
      withMediaCount: tweets.filter(t => t.media).length,
      withImagesCount: tweets.filter(t => t.media && t.media.some(m => m.type === 'photo')).length,
      withVideosCount: tweets.filter(t => t.media && t.media.some(m => ['video', 'animated_gif'].includes(m.type))).length,
      withLinksCount: tweets.filter(t => t.urls).length,
      withHashtagsCount: tweets.filter(t => t.hashtags).length,
      withMentionsCount: tweets.filter(t => t.mentions).length,
      
      // Engagement metrics
      totalLikes: tweets.reduce((sum, t) => sum + (t.likeCount || 0), 0),
      totalRetweets: tweets.reduce((sum, t) => sum + (t.retweetCount || 0), 0),
      totalReplies: tweets.reduce((sum, t) => sum + (t.replyCount || 0), 0),
      totalQuotes: tweets.reduce((sum, t) => sum + (t.quoteCount || 0), 0),
      
      // Average engagement
      averageLikes: tweets.length > 0 ? 
        tweets.reduce((sum, t) => sum + (t.likeCount || 0), 0) / tweets.length : 0,
      averageRetweets: tweets.length > 0 ? 
        tweets.reduce((sum, t) => sum + (t.retweetCount || 0), 0) / tweets.length : 0,
      averageReplies: tweets.length > 0 ? 
        tweets.reduce((sum, t) => sum + (t.replyCount || 0), 0) / tweets.length : 0,
      averageQuotes: tweets.length > 0 ? 
        tweets.reduce((sum, t) => sum + (t.quoteCount || 0), 0) / tweets.length : 0,
      
      // Time metrics
      oldestTweetDate: tweets.reduce((oldest, t) => 
        !oldest || (t.postedAt && t.postedAt < oldest) ? t.postedAt : oldest, null),
      newestTweetDate: tweets.reduce((newest, t) => 
        !newest || (t.postedAt && t.postedAt > newest) ? t.postedAt : newest, null),
      
      // Advanced analytics
      mostUsedHashtags: calculateMostUsedHashtags(tweets),
      mostMentionedUsers: calculateMostMentionedUsers(tweets),
      mostReactedTweets: calculateMostReactedTweets(tweets),
      postingFrequency: calculatePostingFrequency(tweets),
      postingDayDistribution: calculatePostingDayDistribution(tweets),
      postingTimeDistribution: calculatePostingTimeDistribution(tweets),
      languageDistribution: calculateLanguageDistribution(tweets),
      
      // Metadata
      lastUpdated: new Date(),
    };
    
    // Find existing analytics or create new one
    let analyticsEntity = await analyticsRepo.findOne({ where: { userId } });
    
    if (analyticsEntity) {
      // Update existing
      analyticsEntity = analyticsRepo.merge(analyticsEntity, analytics);
    } else {
      // Create new
      analyticsEntity = analyticsRepo.create(analytics);
    }
    
    // Save analytics
    await analyticsRepo.save(analyticsEntity);
    
    fastify.log.info(`Generated analytics for user ${username}`);
    
    return {
      status: 'success',
      username,
      analyticsId: analyticsEntity.id
    };
  } catch (error) {
    fastify.log.error(`Failed to generate analytics: ${error.message}`);
    throw error;
  }
}

/**
 * Calculate most used hashtags
 * 
 * @param {Array} tweets - Array of tweets
 * @returns {Object} - Hashtag distribution
 */
function calculateMostUsedHashtags(tweets) {
  const hashtags = {};
  
  // Count hashtags
  tweets.forEach(tweet => {
    if (tweet.hashtags) {
      tweet.hashtags.forEach(tag => {
        const text = tag.text.toLowerCase();
        hashtags[text] = (hashtags[text] || 0) + 1;
      });
    }
  });
  
  // Convert to array and sort
  const sorted = Object.entries(hashtags)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20); // Top 20
  
  return sorted.length > 0 ? sorted : null;
}

/**
 * Calculate most mentioned users
 * 
 * @param {Array} tweets - Array of tweets
 * @returns {Object} - User mention distribution
 */
function calculateMostMentionedUsers(tweets) {
  const mentions = {};
  
  // Count mentions
  tweets.forEach(tweet => {
    if (tweet.mentions) {
      tweet.mentions.forEach(mention => {
        const username = mention.username.toLowerCase();
        mentions[username] = (mentions[username] || 0) + 1;
      });
    }
  });
  
  // Convert to array and sort
  const sorted = Object.entries(mentions)
    .map(([username, count]) => ({ username, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20); // Top 20
  
  return sorted.length > 0 ? sorted : null;
}

/**
 * Calculate most reacted tweets
 * 
 * @param {Array} tweets - Array of tweets
 * @returns {Object} - Top reacted tweets
 */
function calculateMostReactedTweets(tweets) {
  // Copy and sort by total engagement
  const sortedTweets = [...tweets]
    .map(tweet => {
      const totalEngagement = 
        (tweet.likeCount || 0) + 
        (tweet.retweetCount || 0) + 
        (tweet.replyCount || 0) + 
        (tweet.quoteCount || 0);
      
      return {
        id: tweet.id,
        tweetId: tweet.tweetId,
        text: tweet.text,
        totalEngagement,
        likes: tweet.likeCount || 0,
        retweets: tweet.retweetCount || 0,
        replies: tweet.replyCount || 0,
        quotes: tweet.quoteCount || 0,
        postedAt: tweet.postedAt
      };
    })
    .sort((a, b) => b.totalEngagement - a.totalEngagement)
    .slice(0, 10); // Top 10
  
  return sortedTweets.length > 0 ? sortedTweets : null;
}

/**
 * Calculate posting frequency
 * 
 * @param {Array} tweets - Array of tweets
 * @returns {Object} - Posting frequency statistics
 */
function calculatePostingFrequency(tweets) {
  const tweetsWithDates = tweets.filter(tweet => tweet.postedAt);
  
  if (tweetsWithDates.length < 2) {
    return null;
  }
  
  // Sort by date
  const sortedTweets = [...tweetsWithDates].sort((a, b) => 
    a.postedAt.getTime() - b.postedAt.getTime()
  );
  
  const firstDate = new Date(sortedTweets[0].postedAt);
  const lastDate = new Date(sortedTweets[sortedTweets.length - 1].postedAt);
  
  // Calculate days between first and last tweet
  const daysDiff = Math.max(1, Math.ceil((lastDate - firstDate) / (1000 * 60 * 60 * 24)));
  
  return {
    totalTweets: tweetsWithDates.length,
    daysCovered: daysDiff,
    tweetsPerDay: parseFloat((tweetsWithDates.length / daysDiff).toFixed(2)),
    firstTweetDate: firstDate,
    lastTweetDate: lastDate
  };
}

/**
 * Calculate posting day distribution
 * 
 * @param {Array} tweets - Array of tweets
 * @returns {Object} - Day of week distribution
 */
function calculatePostingDayDistribution(tweets) {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const distribution = days.reduce((acc, day) => ({ ...acc, [day]: 0 }), {});
  
  // Count tweets by day of week
  tweets.forEach(tweet => {
    if (tweet.postedAt) {
      const day = days[tweet.postedAt.getDay()];
      distribution[day]++;
    }
  });
  
  return distribution;
}

/**
 * Calculate posting time distribution
 * 
 * @param {Array} tweets - Array of tweets
 * @returns {Object} - Hour of day distribution
 */
function calculatePostingTimeDistribution(tweets) {
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const distribution = hours.reduce((acc, hour) => ({ ...acc, [hour]: 0 }), {});
  
  // Count tweets by hour of day
  tweets.forEach(tweet => {
    if (tweet.postedAt) {
      const hour = tweet.postedAt.getUTCHours();
      distribution[hour]++;
    }
  });
  
  return distribution;
}

/**
 * Calculate language distribution
 * 
 * @param {Array} tweets - Array of tweets
 * @returns {Object} - Language distribution
 */
function calculateLanguageDistribution(tweets) {
  const languages = {};
  
  // Count languages
  tweets.forEach(tweet => {
    if (tweet.lang) {
      languages[tweet.lang] = (languages[tweet.lang] || 0) + 1;
    }
  });
  
  // Convert to array and sort
  const sorted = Object.entries(languages)
    .map(([lang, count]) => ({ lang, count }))
    .sort((a, b) => b.count - a.count);
  
  return sorted.length > 0 ? sorted : null;
}

/**
 * Generate fine-tuning data
 * 
 * @param {FastifyInstance} fastify - Fastify instance
 * @param {string} username - Twitter username
 * @param {string} userId - Database user ID
 * @returns {Object} - Fine-tuning results
 */
async function generateFinetuningData(fastify, username, userId) {
  try {
    // Get repositories
    const userRepo = fastify.repositories.user;
    const tweetRepo = fastify.repositories.tweet;
    
    // Find the user
    const user = await userRepo.findOne({ 
      where: { id: userId }
    });
    
    if (!user) {
      throw new Error(`User with ID ${userId} not found`);
    }
    
    // Get tweets for fine-tuning (only original and replies)
    const tweets = await tweetRepo.find({ 
      where: [
        { userId, type: 'original' },
        { userId, type: 'reply' }
      ],
      order: { postedAt: 'ASC' }
    });
    
    if (tweets.length === 0) {
      throw new Error(`No suitable tweets found for fine-tuning for user ${username}`);
    }
    
    fastify.log.info(`Generated fine-tuning data for user ${username}, ${tweets.length} tweets processed`);
    
    // Store the results
    const finetuningDataPath = path.join(process.cwd(), 'data', 'finetuning');
    
    // Import file system dynamically
    const fs = await import('fs/promises');
    
    // Create directory if it doesn't exist
    await fs.mkdir(finetuningDataPath, { recursive: true });
    
    // Write fine-tuning data
    const outputPath = path.join(finetuningDataPath, `${username}_finetuning.jsonl`);
    
    // Format tweets for fine-tuning
    const finetuningData = tweets.map(tweet => {
      let prompt = '';
      let completion = tweet.text;
      
      // If this is a reply, use the original tweet as prompt
      if (tweet.type === 'reply' && tweet.replyToTweetId) {
        // We could fetch the original tweet here if needed
        prompt = `Reply to: ${tweet.replyToTweetId}`;
      } else {
        // For original tweets, use empty prompt
        prompt = 'Write a tweet:';
      }
      
      return JSON.stringify({
        prompt,
        completion
      });
    });
    
    // Write to file as JSONL
    await fs.writeFile(outputPath, finetuningData.join('\n'));
    
    return {
      status: 'success',
      username,
      tweetCount: tweets.length,
      outputPath
    };
  } catch (error) {
    fastify.log.error(`Failed to generate fine-tuning data: ${error.message}`);
    throw error;
  }
}

export default fp(queuePlugin, {
  name: 'queue',
  dependencies: ['redis', 'database'],
  fastify: '4.x'
}); 
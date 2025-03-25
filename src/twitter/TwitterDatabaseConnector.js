import { AppDataSource } from '../../api/database/typeorm.config.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { In } from 'typeorm';

// For ES modules support
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class TwitterDatabaseConnector {
  constructor() {
    this.dataSource = null;
    this.userRepo = null;
    this.tweetRepo = null;
    this.analyticsRepo = null;
    this.initialized = false;
  }
  
  async initialize() {
    if (this.initialized) return;
    
    try {
      // Initialize the data source if not already initialized
      if (!AppDataSource.isInitialized) {
        console.log('Initializing database connection...');
        await AppDataSource.initialize();
      }
      
      this.dataSource = AppDataSource;
      this.userRepo = this.dataSource.getRepository('User');
      this.tweetRepo = this.dataSource.getRepository('Tweet');
      this.analyticsRepo = this.dataSource.getRepository('Analytics');
      
      this.initialized = true;
      console.log('Database connection established');
    } catch (error) {
      console.error(`Failed to initialize database: ${error.message}`);
      throw error;
    }
  }
  
  async findOrCreateUser(username, userData = {}) {
    await this.initialize();
    
    // Find existing user
    let user = await this.userRepo.findOne({ where: { username } });
    
    if (!user) {
      console.log(`Creating new user record for @${username}`);
      user = this.userRepo.create({ username });
    }
    
    // Update user data from scraped info if provided
    if (Object.keys(userData).length > 0) {
      user.displayName = userData.name || userData.displayName || user.displayName;
      user.profileImageUrl = userData.profileImageUrl || user.profileImageUrl;
      user.bio = userData.description || userData.bio || user.bio;
      user.location = userData.location || user.location;
      user.url = userData.url || user.url;
      user.followersCount = userData.followersCount || user.followersCount;
      user.followingCount = userData.followingCount || user.followingCount;
      user.tweetCount = userData.statusesCount || userData.tweetCount || user.tweetCount;
      user.verified = userData.verified !== undefined ? userData.verified : user.verified;
      user.protected = userData.protected !== undefined ? userData.protected : user.protected;
      user.joinedAt = userData.createdAt || userData.joinedAt || user.joinedAt;
    }
    
    user.lastScrapedAt = new Date();
    
    // Save user
    await this.userRepo.save(user);
    console.log(`Saved user @${username} with ID ${user.id}`);
    
    return user;
  }
  
  async storeTweets(username, tweets = [], userData = {}) {
    await this.initialize();
    
    // Find or create user
    const user = await this.findOrCreateUser(username, userData);
    
    if (!tweets || tweets.length === 0) {
      console.log(`No tweets to save for user @${username}`);
      return { user, savedCount: 0 };
    }
    
    // Extract all tweet IDs for more efficient lookup
    const allTweetIds = tweets.map(tweet => tweet.id_str || tweet.id);
    
    // Find existing tweets to avoid duplicates
    const existingTweets = await this.tweetRepo.find({
      where: { tweetId: In(allTweetIds) },
      select: ['tweetId']
    }).then(results => new Set(results.map(t => t.tweetId)));
    
    console.log(`Found ${existingTweets.size} existing tweets that will be skipped`);
    
    // Process tweets in batches to avoid memory issues
    const batchSize = 100;
    let totalSaved = 0;
    let totalSkipped = 0;
    
    for (let i = 0; i < tweets.length; i += batchSize) {
      const batch = tweets.slice(i, i + batchSize);
      const batchEntities = [];
      
      // Process each tweet in batch
      for (const tweet of batch) {
        const tweetId = tweet.id_str || tweet.id;
        
        // Skip if tweet already exists in database
        if (existingTweets.has(tweetId)) {
          totalSkipped++;
          continue;
        }
        
        // Parse tweet data
        const tweetData = this.parseTweetForDatabase(tweet, user.id);
        
        // Create tweet entity
        batchEntities.push(this.tweetRepo.create(tweetData));
      }
      
      if (batchEntities.length > 0) {
        try {
          // Save batch
          await this.tweetRepo.save(batchEntities);
          totalSaved += batchEntities.length;
          
          console.log(`Saved batch of ${batchEntities.length} tweets, progress: ${totalSaved}/${tweets.length - totalSkipped}`);
        } catch (error) {
          // Check if it's a unique constraint violation
          if (error.code === '23505' || error.message.includes('duplicate key') || error.message.includes('unique constraint')) {
            console.warn(`Encountered duplicate tweets in batch. Switching to one-by-one processing.`);
            
            // Fall back to one-by-one processing for this batch
            for (const entity of batchEntities) {
              try {
                await this.tweetRepo.save(entity);
                totalSaved++;
              } catch (saveError) {
                if (saveError.code === '23505' || saveError.message.includes('duplicate key') || saveError.message.includes('unique constraint')) {
                  console.debug(`Skipped duplicate tweet: ${entity.tweetId}`);
                  totalSkipped++;
                } else {
                  // Re-throw any other error
                  throw saveError;
                }
              }
            }
            
            console.log(`Completed one-by-one processing. Progress: ${totalSaved}/${tweets.length - totalSkipped}`);
          } else {
            // Re-throw any other error
            throw error;
          }
        }
      } else {
        console.log(`No new tweets to save in this batch, all were duplicates`);
      }
    }
    
    console.log(`Successfully saved ${totalSaved} tweets for user @${username}, skipped ${totalSkipped} existing tweets`);
    
    return { 
      user, 
      savedCount: totalSaved,
      skippedCount: totalSkipped
    };
  }
  
  async generateAnalytics(username, userId) {
    await this.initialize();
    
    // Find the user
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new Error(`User with ID ${userId} not found`);
    }
    
    // Get all user's tweets
    const tweets = await this.tweetRepo.find({ where: { userId } });
    
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
      mostUsedHashtags: this.calculateMostUsedHashtags(tweets),
      mostMentionedUsers: this.calculateMostMentionedUsers(tweets),
      mostReactedTweets: this.calculateMostReactedTweets(tweets),
      postingFrequency: this.calculatePostingFrequency(tweets),
      postingDayDistribution: this.calculatePostingDayDistribution(tweets),
      postingTimeDistribution: this.calculatePostingTimeDistribution(tweets),
      languageDistribution: this.calculateLanguageDistribution(tweets),
      
      // Metadata
      lastUpdated: new Date(),
    };
    
    try {
      // Use a transaction to handle potential race conditions with unique constraints
      await this.dataSource.transaction(async transactionalEntityManager => {
        // Find existing analytics or create new one
        let analyticsEntity = await transactionalEntityManager.findOne('Analytics', { where: { userId } });
        
        if (analyticsEntity) {
          console.log(`Updating existing analytics for user ${username}`);
          analyticsEntity = Object.assign(analyticsEntity, analytics);
        } else {
          console.log(`Creating new analytics for user ${username}`);
          analyticsEntity = transactionalEntityManager.create('Analytics', analytics);
        }
        
        await transactionalEntityManager.save('Analytics', analyticsEntity);
      });
      
      console.log(`Successfully generated analytics for user ${username}`);
      
      return { success: true };
    } catch (err) {
      if (err.code === '23505' || err.message.includes('duplicate key')) {
        console.warn(`Duplicate key constraint issue, trying upsert approach`);
        
        try {
          // Try with query builder upsert
          await this.dataSource.createQueryBuilder()
            .insert()
            .into('analytics')
            .values(analytics)
            .onConflict('("userId")')
            .merge()
            .execute();
        } catch (upsertError) {
          console.error(`Failed to upsert analytics: ${upsertError.message}`);
          throw upsertError;
        }
      } else {
        console.error(`Failed to generate analytics: ${err.message}`);
        throw err;
      }
    }
    
    return { success: true };
  }
  
  parseTweetForDatabase(tweet, userId) {
    // Extract relevant fields and convert to format expected by database
    return {
      userId: userId,
      tweetId: tweet.id_str || tweet.id,
      text: tweet.text || tweet.full_text || '',
      fullText: tweet.full_text || tweet.text || '',
      lang: tweet.lang,
      type: this.determineTweetType(tweet),
      replyToTweetId: tweet.in_reply_to_status_id_str || tweet.inReplyToStatusId,
      replyToUserId: tweet.in_reply_to_user_id_str,
      replyToUsername: tweet.in_reply_to_screen_name,
      retweetedTweetId: tweet.retweeted_status?.id_str,
      retweetedUserId: tweet.retweeted_status?.user?.id_str,
      retweetedUsername: tweet.retweeted_status?.user?.screen_name,
      quotedTweetId: tweet.quoted_status?.id_str || tweet.quotedStatusId,
      quotedUserId: tweet.quoted_status?.user?.id_str,
      quotedUsername: tweet.quoted_status?.user?.screen_name,
      quotedText: tweet.quoted_status?.text || tweet.quoted_status?.full_text,
      likeCount: tweet.favorite_count || tweet.likes || 0,
      retweetCount: tweet.retweet_count || tweet.retweetCount || 0,
      replyCount: tweet.reply_count || tweet.replies || 0,
      quoteCount: tweet.quote_count || 0,
      viewCount: tweet.view_count,
      urls: this.extractUrls(tweet),
      hashtags: this.extractHashtags(tweet),
      mentions: this.extractMentions(tweet),
      media: this.extractMedia(tweet),
      conversationId: tweet.conversation_id_str || tweet.conversation_id,
      postedAt: tweet.created_at ? new Date(tweet.created_at) : 
                tweet.timestamp ? new Date(tweet.timestamp) : 
                tweet.createdAt ? new Date(tweet.createdAt) : null,
      rawJson: tweet // Store the full tweet JSON for future reference
    };
  }
  
  determineTweetType(tweet) {
    if (tweet.isRetweet || tweet.retweeted_status) {
      return 'retweet';
    } else if (tweet.quotedStatusId || tweet.quoted_status) {
      return 'quote';
    } else if (tweet.isReply || tweet.in_reply_to_status_id_str || tweet.inReplyToStatusId) {
      return 'reply';
    } else {
      return 'original';
    }
  }
  
  extractUrls(tweet) {
    const urls = [];
    
    // Handle direct urls array
    if (tweet.urls && Array.isArray(tweet.urls)) {
      urls.push(...tweet.urls.map(url => {
        if (typeof url === 'string') {
          return { url, expanded_url: url, display_url: url };
        }
        return {
          url: url.url,
          expanded_url: url.expanded_url || url.url,
          display_url: url.display_url || url.url
        };
      }));
    }
    
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
  
  extractHashtags(tweet) {
    const hashtags = [];
    
    // Handle direct hashtags array
    if (tweet.hashtags && Array.isArray(tweet.hashtags)) {
      hashtags.push(...tweet.hashtags.map(tag => {
        if (typeof tag === 'string') {
          return { text: tag };
        }
        return { text: tag.text || tag };
      }));
    }
    
    // Check entities
    if (tweet.entities?.hashtags?.length) {
      hashtags.push(...tweet.entities.hashtags.map(tag => ({
        text: tag.text
      })));
    }
    
    return hashtags.length > 0 ? hashtags : null;
  }
  
  extractMentions(tweet) {
    const mentions = [];
    
    // Handle direct entities
    if (tweet.entities?.user_mentions?.length) {
      mentions.push(...tweet.entities.user_mentions.map(mention => ({
        user_id: mention.id_str,
        username: mention.screen_name,
        name: mention.name
      })));
    }
    
    return mentions.length > 0 ? mentions : null;
  }
  
  extractMedia(tweet) {
    const media = [];
    
    // Handle direct photos/videos arrays
    if (tweet.photos && Array.isArray(tweet.photos)) {
      media.push(...tweet.photos.map(photo => ({
        type: 'photo',
        media_url: photo,
        url: photo,
        display_url: photo
      })));
    }
    
    if (tweet.videos && Array.isArray(tweet.videos)) {
      media.push(...tweet.videos.map(video => ({
        type: 'video',
        media_url: video,
        url: video,
        display_url: video
      })));
    }
    
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
  
  // Analytics helper methods
  calculateMostUsedHashtags(tweets) {
    const hashtags = {};
    
    tweets.forEach(tweet => {
      if (tweet.hashtags) {
        tweet.hashtags.forEach(tag => {
          const text = typeof tag === 'string' ? tag.toLowerCase() : tag.text.toLowerCase();
          hashtags[text] = (hashtags[text] || 0) + 1;
        });
      }
    });
    
    const sorted = Object.entries(hashtags)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);
    
    return sorted.length > 0 ? sorted : null;
  }
  
  calculateMostMentionedUsers(tweets) {
    const mentions = {};
    
    tweets.forEach(tweet => {
      if (tweet.mentions) {
        tweet.mentions.forEach(mention => {
          const username = typeof mention === 'string' ? mention.toLowerCase() : 
                         mention.username ? mention.username.toLowerCase() : 
                         mention.screen_name.toLowerCase();
          mentions[username] = (mentions[username] || 0) + 1;
        });
      }
    });
    
    const sorted = Object.entries(mentions)
      .map(([username, count]) => ({ username, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);
    
    return sorted.length > 0 ? sorted : null;
  }
  
  calculateMostReactedTweets(tweets) {
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
      .slice(0, 10);
    
    return sortedTweets.length > 0 ? sortedTweets : null;
  }
  
  calculatePostingFrequency(tweets) {
    const tweetsWithDates = tweets.filter(tweet => tweet.postedAt);
    
    if (tweetsWithDates.length < 2) {
      return null;
    }
    
    const sortedTweets = [...tweetsWithDates].sort((a, b) => 
      a.postedAt.getTime() - b.postedAt.getTime()
    );
    
    const firstDate = new Date(sortedTweets[0].postedAt);
    const lastDate = new Date(sortedTweets[sortedTweets.length - 1].postedAt);
    
    const daysDiff = Math.max(1, Math.ceil((lastDate - firstDate) / (1000 * 60 * 60 * 24)));
    
    return {
      totalTweets: tweetsWithDates.length,
      daysCovered: daysDiff,
      tweetsPerDay: parseFloat((tweetsWithDates.length / daysDiff).toFixed(2)),
      firstTweetDate: firstDate,
      lastTweetDate: lastDate
    };
  }
  
  calculatePostingDayDistribution(tweets) {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const distribution = days.reduce((acc, day) => ({ ...acc, [day]: 0 }), {});
    
    tweets.forEach(tweet => {
      if (tweet.postedAt) {
        const day = days[tweet.postedAt.getDay()];
        distribution[day]++;
      }
    });
    
    return distribution;
  }
  
  calculatePostingTimeDistribution(tweets) {
    const hours = Array.from({ length: 24 }, (_, i) => i);
    const distribution = hours.reduce((acc, hour) => ({ ...acc, [hour]: 0 }), {});
    
    tweets.forEach(tweet => {
      if (tweet.postedAt) {
        const hour = tweet.postedAt.getUTCHours();
        distribution[hour]++;
      }
    });
    
    return distribution;
  }
  
  calculateLanguageDistribution(tweets) {
    const languages = {};
    
    tweets.forEach(tweet => {
      if (tweet.lang) {
        languages[tweet.lang] = (languages[tweet.lang] || 0) + 1;
      }
    });
    
    const sorted = Object.entries(languages)
      .map(([lang, count]) => ({ lang, count }))
      .sort((a, b) => b.count - a.count);
    
    return sorted.length > 0 ? sorted : null;
  }
  
  async close() {
    if (this.dataSource && this.dataSource.isInitialized) {
      await this.dataSource.destroy();
      console.log('Database connection closed');
    }
  }
}

export default TwitterDatabaseConnector; 
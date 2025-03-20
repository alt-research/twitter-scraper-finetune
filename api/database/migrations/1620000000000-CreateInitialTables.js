export class CreateInitialTables1620000000000 {
  async up(queryRunner) {
    // Create users table
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        "username" VARCHAR(255) UNIQUE NOT NULL,
        "displayName" VARCHAR(255),
        "profileImageUrl" TEXT,
        "bio" TEXT,
        "location" VARCHAR(255),
        "url" TEXT,
        "followersCount" INTEGER,
        "followingCount" INTEGER,
        "tweetCount" INTEGER,
        "verified" BOOLEAN DEFAULT false,
        "protected" BOOLEAN DEFAULT false,
        "joinedAt" TIMESTAMP,
        "lastScrapedAt" TIMESTAMP DEFAULT NOW(),
        "createdAt" TIMESTAMP DEFAULT NOW(),
        "updatedAt" TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create tweets table
    await queryRunner.query(`
      CREATE TABLE "tweets" (
        "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        "userId" UUID NOT NULL,
        "tweetId" VARCHAR(255) UNIQUE NOT NULL,
        "text" TEXT NOT NULL,
        "fullText" TEXT,
        "lang" VARCHAR(10),
        "type" VARCHAR(20) DEFAULT 'original',
        "replyToTweetId" VARCHAR(255),
        "replyToUserId" VARCHAR(255),
        "replyToUsername" VARCHAR(255),
        "retweetedTweetId" VARCHAR(255),
        "retweetedUserId" VARCHAR(255),
        "retweetedUsername" VARCHAR(255),
        "quotedTweetId" VARCHAR(255),
        "quotedUserId" VARCHAR(255),
        "quotedUsername" VARCHAR(255),
        "quotedText" TEXT,
        "likeCount" INTEGER DEFAULT 0,
        "retweetCount" INTEGER DEFAULT 0,
        "replyCount" INTEGER DEFAULT 0,
        "quoteCount" INTEGER DEFAULT 0,
        "viewCount" INTEGER,
        "urls" JSONB,
        "hashtags" JSONB,
        "mentions" JSONB,
        "media" JSONB,
        "conversationId" VARCHAR(255),
        "postedAt" TIMESTAMP,
        "createdAt" TIMESTAMP DEFAULT NOW(),
        "updatedAt" TIMESTAMP DEFAULT NOW(),
        "rawJson" JSONB,
        FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    // Create analytics table
    await queryRunner.query(`
      CREATE TABLE "analytics" (
        "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        "userId" UUID UNIQUE NOT NULL,
        "tweetCount" INTEGER DEFAULT 0,
        "originalTweetCount" INTEGER DEFAULT 0,
        "replyCount" INTEGER DEFAULT 0,
        "retweetCount" INTEGER DEFAULT 0,
        "quoteCount" INTEGER DEFAULT 0,
        "withMediaCount" INTEGER DEFAULT 0,
        "withImagesCount" INTEGER DEFAULT 0,
        "withVideosCount" INTEGER DEFAULT 0,
        "withLinksCount" INTEGER DEFAULT 0,
        "withHashtagsCount" INTEGER DEFAULT 0,
        "withMentionsCount" INTEGER DEFAULT 0,
        "totalLikes" INTEGER DEFAULT 0,
        "totalRetweets" INTEGER DEFAULT 0,
        "totalReplies" INTEGER DEFAULT 0,
        "totalQuotes" INTEGER DEFAULT 0,
        "averageLikes" FLOAT DEFAULT 0,
        "averageRetweets" FLOAT DEFAULT 0,
        "averageReplies" FLOAT DEFAULT 0,
        "averageQuotes" FLOAT DEFAULT 0,
        "mostUsedHashtags" JSONB,
        "mostMentionedUsers" JSONB,
        "mostReactedTweets" JSONB,
        "contentTopics" JSONB,
        "postingFrequency" JSONB,
        "postingDayDistribution" JSONB,
        "postingTimeDistribution" JSONB,
        "activityTimespan" JSONB,
        "oldestTweetDate" TIMESTAMP,
        "newestTweetDate" TIMESTAMP,
        "languageDistribution" JSONB,
        "lastUpdated" TIMESTAMP DEFAULT NOW(),
        "createdAt" TIMESTAMP DEFAULT NOW(),
        "updatedAt" TIMESTAMP DEFAULT NOW(),
        FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    // Create indices
    await queryRunner.query(`CREATE INDEX "user_username_idx" ON "users" ("username")`);
    await queryRunner.query(`CREATE INDEX "tweet_tweetid_idx" ON "tweets" ("tweetId")`);
    await queryRunner.query(`CREATE INDEX "tweet_type_idx" ON "tweets" ("type")`);
    await queryRunner.query(`CREATE INDEX "tweet_postedat_idx" ON "tweets" ("postedAt")`);
    await queryRunner.query(`CREATE INDEX "tweet_userid_idx" ON "tweets" ("userId")`);
    await queryRunner.query(`CREATE INDEX "analytics_userid_idx" ON "analytics" ("userId")`);
  }

  async down(queryRunner) {
    // Drop tables in reverse order
    await queryRunner.query(`DROP TABLE IF EXISTS "analytics"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "tweets"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
  }
} 
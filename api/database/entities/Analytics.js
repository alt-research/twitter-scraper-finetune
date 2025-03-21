import { EntitySchema } from 'typeorm';

export const Analytics = new EntitySchema({
  name: 'Analytics',
  tableName: 'analytics',
  columns: {
    id: {
      primary: true,
      type: 'uuid',
      generated: 'uuid',
    },
    userId: {
      type: 'uuid',
      unique: true,
    },
    tweetCount: {
      type: 'int',
      default: 0,
    },
    originalTweetCount: {
      type: 'int',
      default: 0,
    },
    replyCount: {
      type: 'int',
      default: 0,
    },
    retweetCount: {
      type: 'int',
      default: 0,
    },
    quoteCount: {
      type: 'int',
      default: 0,
    },
    withMediaCount: {
      type: 'int',
      default: 0,
    },
    withImagesCount: {
      type: 'int',
      default: 0,
    },
    withVideosCount: {
      type: 'int',
      default: 0,
    },
    withLinksCount: {
      type: 'int',
      default: 0,
    },
    withHashtagsCount: {
      type: 'int',
      default: 0,
    },
    withMentionsCount: {
      type: 'int',
      default: 0,
    },
    totalLikes: {
      type: 'int',
      default: 0,
    },
    totalRetweets: {
      type: 'int',
      default: 0,
    },
    totalReplies: {
      type: 'int',
      default: 0,
    },
    totalQuotes: {
      type: 'int',
      default: 0,
    },
    averageLikes: {
      type: 'float',
      default: 0,
    },
    averageRetweets: {
      type: 'float',
      default: 0,
    },
    averageReplies: {
      type: 'float',
      default: 0,
    },
    averageQuotes: {
      type: 'float',
      default: 0,
    },
    mostUsedHashtags: {
      type: 'json',
      nullable: true,
    },
    mostMentionedUsers: {
      type: 'json',
      nullable: true,
    },
    mostReactedTweets: {
      type: 'json',
      nullable: true,
    },
    contentTopics: {
      type: 'json',
      nullable: true,
    },
    postingFrequency: {
      type: 'json',
      nullable: true,
    },
    postingDayDistribution: {
      type: 'json',
      nullable: true,
    },
    postingTimeDistribution: {
      type: 'json',
      nullable: true,
    },
    activityTimespan: {
      type: 'json',
      nullable: true,
    },
    oldestTweetDate: {
      type: 'timestamp',
      nullable: true,
    },
    newestTweetDate: {
      type: 'timestamp',
      nullable: true,
    },
    languageDistribution: {
      type: 'json',
      nullable: true,
    },
    lastUpdated: {
      type: 'timestamp',
      default: () => 'CURRENT_TIMESTAMP',
    },
    createdAt: {
      type: 'timestamp',
      default: () => 'CURRENT_TIMESTAMP',
    },
    updatedAt: {
      type: 'timestamp',
      default: () => 'CURRENT_TIMESTAMP',
      onUpdate: 'CURRENT_TIMESTAMP',
    },
  },
  relations: {
    user: {
      type: 'one-to-one',
      target: 'User',
      joinColumn: {
        name: 'userId',
        referencedColumnName: 'id',
      },
      onDelete: 'CASCADE',
    },
  },
  indices: [
    {
      name: 'analytics_userid_idx',
      columns: ['userId'],
    },
  ],
}); 
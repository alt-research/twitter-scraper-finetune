import { EntitySchema } from 'typeorm';

export const Tweet = new EntitySchema({
  name: 'Tweet',
  tableName: 'tweets',
  columns: {
    id: {
      primary: true,
      type: 'uuid',
      generated: 'uuid',
    },
    userId: {
      type: 'uuid',
    },
    tweetId: {
      type: 'varchar',
      length: 255,
      unique: true, // Twitter tweet IDs are unique
    },
    text: {
      type: 'text',
    },
    fullText: {
      type: 'text',
      nullable: true,
    },
    lang: {
      type: 'varchar',
      length: 10,
      nullable: true,
    },
    type: {
      type: 'varchar',
      length: 20, // original, reply, retweet, quote
      default: 'original',
    },
    replyToTweetId: {
      type: 'varchar',
      length: 255,
      nullable: true,
    },
    replyToUserId: {
      type: 'varchar',
      length: 255,
      nullable: true,
    },
    replyToUsername: {
      type: 'varchar',
      length: 255,
      nullable: true,
    },
    retweetedTweetId: {
      type: 'varchar',
      length: 255,
      nullable: true,
    },
    retweetedUserId: {
      type: 'varchar',
      length: 255,
      nullable: true,
    },
    retweetedUsername: {
      type: 'varchar',
      length: 255,
      nullable: true,
    },
    quotedTweetId: {
      type: 'varchar',
      length: 255,
      nullable: true,
    },
    quotedUserId: {
      type: 'varchar',
      length: 255,
      nullable: true,
    },
    quotedUsername: {
      type: 'varchar',
      length: 255,
      nullable: true,
    },
    quotedText: {
      type: 'text',
      nullable: true,
    },
    likeCount: {
      type: 'int',
      default: 0,
    },
    retweetCount: {
      type: 'int',
      default: 0,
    },
    replyCount: {
      type: 'int',
      default: 0,
    },
    quoteCount: {
      type: 'int',
      default: 0,
    },
    viewCount: {
      type: 'int',
      nullable: true,
    },
    urls: {
      type: 'json',
      nullable: true,
    },
    hashtags: {
      type: 'json',
      nullable: true,
    },
    mentions: {
      type: 'json',
      nullable: true,
    },
    media: {
      type: 'json',
      nullable: true,
    },
    conversationId: {
      type: 'varchar',
      length: 255,
      nullable: true,
    },
    postedAt: {
      type: 'timestamp',
      nullable: true,
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
    rawJson: {
      type: 'jsonb', // Using PostgreSQL's native JSONB type for efficient storage and querying
      nullable: true,
    },
  },
  relations: {
    user: {
      type: 'many-to-one',
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
      name: 'tweet_tweetid_idx',
      columns: ['tweetId'],
    },
    {
      name: 'tweet_type_idx',
      columns: ['type'],
    },
    {
      name: 'tweet_postedat_idx',
      columns: ['postedAt'],
    },
    {
      name: 'tweet_userid_idx',
      columns: ['userId'],
    },
  ],
}); 
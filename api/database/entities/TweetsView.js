import { EntitySchema } from 'typeorm';

export const TweetsView = new EntitySchema({
  name: 'TweetsView',
  tableName: 'tweets_view',
  columns: {
    id: {
      primary: true,
      type: 'uuid',
    },
    incrementalId: {
      type: 'int',
      comment: 'Auto-incrementing ID for range queries and pagination',
    },
    tweetId: {
      type: 'varchar',
      length: 255,
    },
    username: {
      type: 'varchar',
      length: 255,
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
    },
    replyToTweetId: {
      type: 'varchar',
      length: 255,
      nullable: true,
    }
  },
  // This is a view, so it's read-only
  readonly: true
  // Since this is a view, we don't define relations or indices here
}); 
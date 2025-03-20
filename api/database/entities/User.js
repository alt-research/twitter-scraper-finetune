import { EntitySchema } from 'typeorm';

export const User = new EntitySchema({
  name: 'User',
  tableName: 'users',
  columns: {
    id: {
      primary: true,
      type: 'uuid',
      generated: 'uuid',
    },
    username: {
      type: 'varchar',
      length: 255,
      unique: true, // Twitter usernames are unique
    },
    displayName: {
      type: 'varchar',
      length: 255,
      nullable: true,
    },
    profileImageUrl: {
      type: 'text',
      nullable: true,
    },
    bio: {
      type: 'text',
      nullable: true,
    },
    location: {
      type: 'varchar',
      length: 255,
      nullable: true,
    },
    url: {
      type: 'text',
      nullable: true,
    },
    followersCount: {
      type: 'int',
      nullable: true,
    },
    followingCount: {
      type: 'int',
      nullable: true,
    },
    tweetCount: {
      type: 'int',
      nullable: true,
    },
    verified: {
      type: 'boolean',
      default: false,
    },
    protected: {
      type: 'boolean',
      default: false,
    },
    joinedAt: {
      type: 'timestamp',
      nullable: true,
    },
    lastScrapedAt: {
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
    tweets: {
      type: 'one-to-many',
      target: 'Tweet',
      inverseSide: 'user',
    },
    analytics: {
      type: 'one-to-one',
      target: 'Analytics',
      inverseSide: 'user',
    },
  },
  indices: [
    {
      name: 'user_username_idx',
      columns: ['username'],
    }
  ]
}); 
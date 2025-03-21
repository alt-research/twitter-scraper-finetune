/**
 * Migration to add an auto-incrementing serial ID to tweets table
 */
export class AddIncrementalIdToTweets1620000000001 {
  async up(queryRunner) {
    // Add incrementalId column as a serial (auto-incrementing) type
    await queryRunner.query(`
      ALTER TABLE tweets
      ADD COLUMN "incrementalId" SERIAL NOT NULL;
    `);

    // Create an index on incrementalId for faster range queries
    await queryRunner.query(`
      CREATE INDEX "tweets_incremental_id_idx" ON tweets ("incrementalId");
    `);
  }

  async down(queryRunner) {
    // Drop the index first
    await queryRunner.query(`
      DROP INDEX IF EXISTS "tweets_incremental_id_idx";
    `);

    // Then drop the column
    await queryRunner.query(`
      ALTER TABLE tweets
      DROP COLUMN IF EXISTS "incrementalId";
    `);
  }
} 
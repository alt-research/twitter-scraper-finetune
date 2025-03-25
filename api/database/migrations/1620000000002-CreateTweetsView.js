/**
 * Migration to create a tweets_view for easier reading of tweets with username
 */
export class CreateTweetsView1620000000002 {
  async up(queryRunner) {
    // Create the tweets_view view
    await queryRunner.query(`
      CREATE OR REPLACE VIEW tweets_view AS
      SELECT 
        t.id AS id,
        t."incrementalId" AS "incrementalId",
        t."tweetId" AS "tweetId",
        u.username AS username,
        t.text AS text,
        t."fullText" AS "fullText",
        t.lang AS lang,
        t.type AS type,
        t."replyToTweetId" AS "replyToTweetId"
      FROM 
        tweets t
      INNER JOIN 
        users u ON t."userId" = u.id;
    `);
  }

  async down(queryRunner) {
    // Drop the view
    await queryRunner.query(`
      DROP VIEW IF EXISTS tweets_view;
    `);
  }
} 
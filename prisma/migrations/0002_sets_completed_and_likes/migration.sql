-- Add sets_completed column to workout_exercises (idempotent)
ALTER TABLE "workout_exercises" ADD COLUMN IF NOT EXISTS "setsCompleted" INTEGER NOT NULL DEFAULT 0;

-- Backfill from the existing "weight" hack (where possible)
UPDATE "workout_exercises"
   SET "setsCompleted" = LEAST("sets", GREATEST(0, COALESCE("weight", 0)::int))
 WHERE "setsCompleted" = 0 AND "weight" IS NOT NULL;

-- Create post_likes table
CREATE TABLE IF NOT EXISTS "post_likes" (
  "id"        TEXT PRIMARY KEY,
  "postId"    TEXT NOT NULL REFERENCES "posts"("id") ON DELETE CASCADE,
  "userId"    TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("postId", "userId")
);
CREATE INDEX IF NOT EXISTS "post_likes_postId_idx" ON "post_likes" ("postId");
CREATE INDEX IF NOT EXISTS "post_likes_userId_idx" ON "post_likes" ("userId");

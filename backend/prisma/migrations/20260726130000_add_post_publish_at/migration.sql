-- Add publishAt to posts so authoring can schedule a post to go live in the future
ALTER TABLE "posts" ADD COLUMN "publish_at" TIMESTAMP(3);

CREATE INDEX "posts_publish_at_idx" ON "posts"("publish_at");

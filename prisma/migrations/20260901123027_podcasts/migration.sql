-- AlterTable
ALTER TABLE "Track" ADD COLUMN "contentType" TEXT;

-- CreateTable
CREATE TABLE "FollowedChannel" (
    "channelId" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "followedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

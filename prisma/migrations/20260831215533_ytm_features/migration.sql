-- AlterTable
ALTER TABLE "Track" ADD COLUMN "album" TEXT;
ALTER TABLE "Track" ADD COLUMN "cachedBytes" INTEGER;
ALTER TABLE "Track" ADD COLUMN "cachedPath" TEXT;

-- CreateTable
CREATE TABLE "Dislike" (
    "trackId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "dislikedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Dislike_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Lyrics" (
    "trackId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "plain" TEXT,
    "synced" TEXT,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Lyrics_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SearchQuery" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "query" TEXT NOT NULL,
    "uses" INTEGER NOT NULL DEFAULT 1,
    "lastUsed" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_HistoryEntry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "trackId" INTEGER NOT NULL,
    "playedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "skipped" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "HistoryEntry_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_HistoryEntry" ("id", "playedAt", "trackId") SELECT "id", "playedAt", "trackId" FROM "HistoryEntry";
DROP TABLE "HistoryEntry";
ALTER TABLE "new_HistoryEntry" RENAME TO "HistoryEntry";
CREATE INDEX "HistoryEntry_playedAt_idx" ON "HistoryEntry"("playedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "SearchQuery_query_key" ON "SearchQuery"("query");

-- CreateIndex
CREATE INDEX "SearchQuery_lastUsed_idx" ON "SearchQuery"("lastUsed");

-- CreateIndex
CREATE INDEX "Track_artist_idx" ON "Track"("artist");

-- CreateIndex
CREATE INDEX "Track_album_idx" ON "Track"("album");

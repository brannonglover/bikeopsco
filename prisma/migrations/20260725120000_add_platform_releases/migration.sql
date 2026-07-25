-- CreateEnum
CREATE TYPE "PlatformReleaseStatus" AS ENUM ('draft', 'published', 'discarded');

-- CreateTable
CREATE TABLE "PlatformRelease" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "gitSha" TEXT NOT NULL,
    "title" TEXT,
    "bullets" TEXT[],
    "status" "PlatformReleaseStatus" NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "PlatformRelease_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformRelease_version_key" ON "PlatformRelease"("version");

-- CreateIndex
CREATE INDEX "PlatformRelease_gitSha_idx" ON "PlatformRelease"("gitSha");

-- CreateIndex
CREATE INDEX "PlatformRelease_status_publishedAt_idx" ON "PlatformRelease"("status", "publishedAt");

-- CreateEnum
CREATE TYPE "PreferenceRating" AS ENUM ('up', 'down');

-- CreateEnum
CREATE TYPE "RecommendationType" AS ENUM ('shopping_item', 'gap_analysis');

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "occasionType" TEXT NOT NULL,
    "dressCode" TEXT,
    "location" TEXT,
    "linkedOutfitId" TEXT,
    "weatherSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "RecommendationType" NOT NULL,
    "key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "source" TEXT,
    "dismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StylePreferenceSignal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT,
    "occasion" TEXT NOT NULL,
    "itemIds" TEXT[],
    "rationale" TEXT,
    "rating" "PreferenceRating" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StylePreferenceSignal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Event_userId_idx" ON "Event"("userId");

-- CreateIndex
CREATE INDEX "Event_userId_date_idx" ON "Event"("userId", "date");

-- CreateIndex
CREATE INDEX "Recommendation_userId_type_idx" ON "Recommendation"("userId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Recommendation_userId_key_key" ON "Recommendation"("userId", "key");

-- CreateIndex
CREATE INDEX "StylePreferenceSignal_userId_idx" ON "StylePreferenceSignal"("userId");

-- CreateIndex
CREATE INDEX "StylePreferenceSignal_rating_idx" ON "StylePreferenceSignal"("rating");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StylePreferenceSignal" ADD CONSTRAINT "StylePreferenceSignal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

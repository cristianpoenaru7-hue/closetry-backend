-- AlterEnum
ALTER TYPE "Category" ADD VALUE 'swimwear';

-- AlterTable
ALTER TABLE "Outfit" ADD COLUMN     "eventId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "acceptedPoliciesAt" TIMESTAMP(3),
ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "theme" TEXT NOT NULL DEFAULT 'gold';

-- CreateIndex
CREATE INDEX "Outfit_userId_eventId_idx" ON "Outfit"("userId", "eventId");

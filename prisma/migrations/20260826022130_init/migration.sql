-- CreateEnum
CREATE TYPE "Category" AS ENUM ('top', 'bottom', 'dress', 'outerwear', 'shoes', 'accessory', 'bag');

-- CreateEnum
CREATE TYPE "ItemMaterial" AS ENUM ('cotton', 'linen', 'wool', 'silk', 'denim', 'leather', 'cashmere', 'synthetic', 'other');

-- CreateEnum
CREATE TYPE "Season" AS ENUM ('spring', 'summer', 'fall', 'winter', 'all');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "stylePreferences" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClothingItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "imageUrl" TEXT,
    "category" "Category" NOT NULL,
    "subcategory" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "material" "ItemMaterial" NOT NULL,
    "season" "Season" NOT NULL,
    "brand" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "dateAdded" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastWornAt" TIMESTAMP(3),

    CONSTRAINT "ClothingItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Outfit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT,
    "occasion" TEXT NOT NULL,
    "itemIds" TEXT[],
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "wornDates" TIMESTAMP(3)[] DEFAULT ARRAY[]::TIMESTAMP(3)[],

    CONSTRAINT "Outfit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenerationSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "messages" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GenerationSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "ClothingItem_userId_idx" ON "ClothingItem"("userId");

-- CreateIndex
CREATE INDEX "ClothingItem_userId_category_idx" ON "ClothingItem"("userId", "category");

-- CreateIndex
CREATE INDEX "Outfit_userId_idx" ON "Outfit"("userId");

-- CreateIndex
CREATE INDEX "GenerationSession_userId_idx" ON "GenerationSession"("userId");

-- AddForeignKey
ALTER TABLE "ClothingItem" ADD CONSTRAINT "ClothingItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Outfit" ADD CONSTRAINT "Outfit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationSession" ADD CONSTRAINT "GenerationSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

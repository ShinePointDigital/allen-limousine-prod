/*
  Warnings:

  - You are about to drop the column `serviceId` on the `Ride` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "Ride" DROP CONSTRAINT "Ride_serviceId_fkey";

-- AlterTable
ALTER TABLE "Ride" DROP COLUMN "serviceId";

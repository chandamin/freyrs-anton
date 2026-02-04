/*
  Warnings:

  - You are about to drop the column `balance` on the `purchaseorder` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `purchaseorder` DROP COLUMN `balance`,
    MODIFY `orderDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

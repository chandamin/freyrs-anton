/*
  Warnings:

  - You are about to drop the column `totalUnits` on the `purchaseorder` table. All the data in the column will be lost.
  - Added the required column `updatedAt` to the `PurchaseOrder` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `purchaseorder` DROP COLUMN `totalUnits`,
    ADD COLUMN `receivedQuantity` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `totalQuantity` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `updatedAt` DATETIME(3) NOT NULL,
    MODIFY `note` TEXT NULL;

-- AlterTable
ALTER TABLE `purchaseorderitem` MODIFY `sku` VARCHAR(191) NULL,
    MODIFY `quantity` INTEGER NOT NULL DEFAULT 0,
    MODIFY `cost` DOUBLE NOT NULL DEFAULT 0,
    MODIFY `subtotal` DOUBLE NOT NULL DEFAULT 0;

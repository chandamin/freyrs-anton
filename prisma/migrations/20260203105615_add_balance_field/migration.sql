-- DropForeignKey
ALTER TABLE `payment` DROP FOREIGN KEY `Payment_purchaseOrderId_fkey`;

-- DropForeignKey
ALTER TABLE `purchaseorderitem` DROP FOREIGN KEY `PurchaseOrderItem_purchaseOrderId_fkey`;

-- DropIndex
DROP INDEX `Payment_purchaseOrderId_fkey` ON `payment`;

-- DropIndex
DROP INDEX `PurchaseOrderItem_purchaseOrderId_fkey` ON `purchaseorderitem`;

-- AlterTable
ALTER TABLE `purchaseorder` ADD COLUMN `balance` DOUBLE NOT NULL DEFAULT 0;

-- AddForeignKey
ALTER TABLE `PurchaseOrderItem` ADD CONSTRAINT `PurchaseOrderItem_purchaseOrderId_fkey` FOREIGN KEY (`purchaseOrderId`) REFERENCES `PurchaseOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_purchaseOrderId_fkey` FOREIGN KEY (`purchaseOrderId`) REFERENCES `PurchaseOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

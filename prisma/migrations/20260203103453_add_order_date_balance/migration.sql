/*
  Warnings:

  - Added the required column `balance` to the `PurchaseOrder` table without a default value. This is not possible if the table is not empty.
  - Added the required column `orderDate` to the `PurchaseOrder` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `purchaseorder` ADD COLUMN `balance` DOUBLE NOT NULL,
    ADD COLUMN `orderDate` DATETIME(3) NOT NULL;

-- AlterTable
ALTER TABLE `purchaseorderitem` ADD COLUMN `readyDate` DATETIME(3) NULL;

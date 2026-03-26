-- AlterTable
ALTER TABLE "Message" ADD COLUMN "smsSid" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Message_smsSid_key" ON "Message"("smsSid");

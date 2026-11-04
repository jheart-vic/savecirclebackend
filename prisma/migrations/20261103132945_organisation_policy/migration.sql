-- AlterTable
ALTER TABLE "organisations" ADD COLUMN     "policy" JSONB NOT NULL DEFAULT '{}';

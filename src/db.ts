import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "./generated/prisma/client.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
  // Prisma's defaults (2 s to start, 5 s to finish) were exceeded on slow links to Neon.
  transactionOptions: { maxWait: 5_000, timeout: 10_000 },
});

/** The shared client or a transaction client; model functions accept either. */
export type Db = Prisma.TransactionClient;

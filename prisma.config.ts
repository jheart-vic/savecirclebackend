import "dotenv/config";
import { defineConfig } from "prisma/config";

// The CLI (migrate, studio) uses Neon's direct connection: migrations need a
// session that Neon's pooler (PgBouncer, transaction mode) does not provide.
// The running app uses the pooled DATABASE_URL instead (see src/db.ts).
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DIRECT_URL"],
  },
});

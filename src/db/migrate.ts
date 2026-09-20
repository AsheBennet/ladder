import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createPool, type Db } from "./pool.js";

const here = dirname(fileURLToPath(import.meta.url));

export function schemaSql(): string {
  return readFileSync(join(here, "schema.sql"), "utf8");
}

export async function migrate(db: Db): Promise<void> {
  await db.query(schemaSql());
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required");
  const pool = createPool(url);
  await migrate(pool);
  await pool.end();
  console.log("migrate ok");
}

const isDirect =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirect) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

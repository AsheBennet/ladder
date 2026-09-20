import { buildApp } from "./server.js";

async function main() {
  const { app, cfg } = await buildApp();
  await app.listen({ port: cfg.port, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

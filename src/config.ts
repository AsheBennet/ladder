export type Config = {
  databaseUrl: string;
  port: number;
  seasonId: string;
  placeholderHost: string;
  placeholderPortBase: number;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL required");
  return {
    databaseUrl,
    port: Number(env.PORT ?? 8080),
    seasonId: env.SEASON_ID ?? "s1",
    placeholderHost: env.PLACEHOLDER_HOST ?? "127.0.0.1",
    placeholderPortBase: Number(env.PLACEHOLDER_PORT_BASE ?? 40000),
  };
}

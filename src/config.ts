interface Config {
  port: number;
  host: string;
  nodeEnv: "development" | "production" | "test";
}

function optionalEnv(name: string, defaultValue: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    return defaultValue;
  }
  return value;
}

function parseNodeEnv(value: string): Config["nodeEnv"] {
  if (value === "production" || value === "development" || value === "test") {
    return value;
  }
  throw new Error(
    `Invalid NODE_ENV: ${value}. Must be development, production, or test.`
  );
}

export function loadConfig(): Config {
  return {
    port: parseInt(optionalEnv("PORT", "3000"), 10),
    host: optionalEnv("HOST", "0.0.0.0"),
    nodeEnv: parseNodeEnv(optionalEnv("NODE_ENV", "development")),
  };
}

export type { Config };

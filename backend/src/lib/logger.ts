/* eslint-disable no-console */
type LogMeta = Record<string, unknown> | undefined;

function format(level: string, message: string, meta?: LogMeta): string {
  const timestamp = new Date().toISOString();
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
  return `[${timestamp}] [${level}] ${message}${metaStr}`;
}

export const logger = {
  info(message: string, meta?: LogMeta): void {
    console.log(format("INFO", message, meta));
  },
  warn(message: string, meta?: LogMeta): void {
    console.warn(format("WARN", message, meta));
  },
  error(message: string, meta?: LogMeta): void {
    console.error(format("ERROR", message, meta));
  },
  debug(message: string, meta?: LogMeta): void {
    if (process.env.NODE_ENV === "development") {
      console.debug(format("DEBUG", message, meta));
    }
  },
};

import winston from "winston";
import axios from "axios";

export const log = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json(),
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp, ...meta }) => {
          const metaString = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
          return `[${timestamp}] ${level}: ${message}${metaString}`;
        }),
      ),
    }),
  ],
});

export async function sendAlert(message: string, details?: Record<string, unknown>) {
  const hook = process.env.ALERT_WEBHOOK_URL;
  if (!hook) return;
  try {
    await axios.post(hook, {
      text: `:rotating_light: ${message}\n\`\`\`${JSON.stringify(details, null, 2)}\`\`\``,
    });
  } catch (error) {
    log.error("Failed to send alert", { error });
  }
}

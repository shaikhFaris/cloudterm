import winston from "winston";

const consoleFormat = winston.format.printf(({ level, message, timestamp, stack }) => {
  return stack
    ? `${timestamp} ${level}: ${message}\n${stack}`
    : `${timestamp} ${level}: ${message}`;
});

const logger = winston.createLogger({
  format: winston.format.combine(
    winston.format.errors({ stack: true }),
    winston.format.timestamp(),
    winston.format.json(),
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        consoleFormat,
      ),
    }),
  ],
});

export default logger;

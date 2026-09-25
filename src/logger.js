const path = require('node:path');
const winston = require('winston');
const { config } = require('./config');

const { combine, timestamp, printf, colorize, errors } = winston.format;

const fileFormat = combine(
  errors({ stack: true }),
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  printf(({ level, message, timestamp: ts, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `[${ts}] ${level.toUpperCase().padEnd(5)} ${stack || message}${metaStr}`;
  }),
);

const logger = winston.createLogger({
  level: config.infra.logLevel,
  format: fileFormat,
  transports: [
    new winston.transports.File({
      filename: path.join(config.infra.logDir, 'error.log'),
      level: 'error',
      maxsize: 2 * 1024 * 1024,
      maxFiles: 3,
    }),
    new winston.transports.File({
      filename: path.join(config.infra.logDir, 'combined.log'),
      maxsize: 5 * 1024 * 1024,
      maxFiles: 5,
    }),
  ],
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(
    new winston.transports.Console({
      format: combine(colorize(), timestamp({ format: 'HH:mm:ss' }), printf(({ level, message, timestamp: ts }) => `[${ts}] ${level}: ${message}`)),
    }),
  );
} else {
  logger.add(
    new winston.transports.Console({
      format: combine(timestamp({ format: 'HH:mm:ss' }), printf(({ level, message, timestamp: ts }) => `[${ts}] ${level}: ${message}`)),
    }),
  );
}

module.exports = logger;

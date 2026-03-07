import pino from 'pino';

const isDev = process.env.LOG_FORMAT === 'pretty' || process.env.NODE_ENV !== 'production';

const logger = pino(
  {
    level: process.env.LOG_LEVEL || 'info',
    base: null,
    timestamp: false,
  },
  isDev
    ? pino.transport({ target: 'pino-pretty', options: { colorize: true, ignore: 'pid,hostname' } })
    : undefined
);

export default logger;

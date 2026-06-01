import pino from 'pino';

export interface ILogger {
  info(msg: string, ...args: any[]): void;
  error(msg: string, ...args: any[]): void;
  warn(msg: string, ...args: any[]): void;
  debug(msg: string, ...args: any[]): void;
}

export const createLogger = (serviceName: string) => {
  const isDevelopment = process.env.NODE_ENV !== 'production';

  // Ở local/development, chúng ta dùng pino-pretty để xuất log ra console đẹp mắt
  // Và BẮN TRỰC TIẾP lên Elasticsearch qua pino-elasticsearch (đã cài ở shared-kernel)
  
  // NOTE: Trong môi trường production thực tế, tốt nhất là ghi log ra console dạng JSON
  // và để FluentBit/Filebeat scrape log đẩy lên ES, không nên push trực tiếp từ App.
  // Tuy nhiên, ở Phase 0/Local, push trực tiếp là cách dễ nhất để monitor.

  const transport = isDevelopment
    ? pino.transport({
        targets: [
          {
            target: 'pino-pretty',
            options: { colorize: true }
          },
          {
            target: 'pino-elasticsearch',
            options: {
              index: 'dsp-logs',
              node: process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
              opType: 'create'
            }
          }
        ]
      })
    : pino.transport({
        target: 'pino/file',
        options: { destination: 1 } // stdout
      });

  return pino({
    name: serviceName,
    level: process.env.LOG_LEVEL || 'info',
    base: { serviceContext: serviceName }
  }, transport);
};

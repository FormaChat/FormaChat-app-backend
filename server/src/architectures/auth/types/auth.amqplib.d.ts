declare module 'amqplib' {
  export interface SimpleConnection {
    createChannel(): Promise<SimpleChannel>;
    close(): Promise<void>;
    on(event: 'error' | 'close', listener: (...args: any[]) => void): void;
  }

  export interface SimpleChannel {
    assertExchange(...args: any[]): Promise<any>;
    assertQueue(...args: any[]): Promise<any>;
    bindQueue(...args: any[]): Promise<any>;
    publish(...args: any[]): boolean;
    consume(...args: any[]): Promise<any>;
    ack(msg: any): void;
    nack(msg: any, allUpTo?: boolean, requeue?: boolean): void;
    close(): Promise<void>;
    prefetch(count: number): Promise<void>;
    on(event: 'error' | 'close', listener: (...args: any[]) => void): void;

  }

  const amqp: {
    connect(url: string): Promise<SimpleConnection>;
  };

  export default amqp;
}

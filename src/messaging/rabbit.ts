import amqp, { Channel, ChannelModel } from 'amqplib';

export const OUTBOX_EXCHANGE = 'towos.events';

export interface RabbitConnection {
  channel: Channel;
  close(): Promise<void>;
}

/**
 * Connection, channel, and publisher - the plumbing messaging/outbox/'s
 * relay publishes through. Domain-event consumers (Phase 1/2) bind their
 * own queues to this exchange; nothing here assumes who's listening.
 */
export async function connectRabbit(url: string): Promise<RabbitConnection> {
  // RabbitMQ 4.3 (CLAUDE.md's pinned version) rejects amqplib's default
  // frame_max of 4096 outright ("negotiated frame_max = 4096 is lower than
  // the minimum allowed value (8192)"), closing the connection immediately
  // after the handshake starts - confirmed against a real 4.3 broker.
  // amqplib's own default predates that server-side minimum. amqplib reads
  // frameMax from the connection URL's query string, not from connect()'s
  // second argument (that's net.connect's socket options, unrelated to AMQP
  // protocol tuning) - easy to get backwards, confirmed against the source.
  const tunedUrl = new URL(url);
  tunedUrl.searchParams.set('frameMax', '8192');
  const connection: ChannelModel = await amqp.connect(tunedUrl.toString());
  const channel = await connection.createChannel();
  await channel.assertExchange(OUTBOX_EXCHANGE, 'topic', { durable: true });

  return {
    channel,
    close: async () => {
      await channel.close();
      await connection.close();
    },
  };
}

export function publishEvent(
  channel: Channel,
  routingKey: string,
  payload: Record<string, unknown>,
): boolean {
  return channel.publish(OUTBOX_EXCHANGE, routingKey, Buffer.from(JSON.stringify(payload)), {
    persistent: true,
    contentType: 'application/json',
  });
}

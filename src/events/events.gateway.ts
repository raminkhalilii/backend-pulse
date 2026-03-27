import { Logger } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { MonitorUpdatedPayload } from './events.constants';

@WebSocketGateway({
  cors: { origin: '*' }, // tighten to the frontend origin once the URL is known
})
export class EventsGateway {
  private readonly logger = new Logger(EventsGateway.name);

  @WebSocketServer()
  private server: Server;

  /**
   * Called by RedisSubscriberService whenever a new ping result arrives.
   * Broadcasts the update to every connected WebSocket client.
   */
  broadcastMonitorUpdate(payload: MonitorUpdatedPayload): void {
    this.server?.emit('monitor.updated', payload);
    this.logger.debug(`Broadcast monitor.updated for monitorId=${payload.monitorId}`);
  }
}

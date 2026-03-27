import { Module } from '@nestjs/common';
import { EventsGateway } from './events.gateway';
import { RedisSubscriberService } from './redis-subscriber.service';

@Module({
  providers: [
    EventsGateway, // WebSocket server — broadcasts to frontend clients
    RedisSubscriberService, // listens on Redis Pub/Sub → forwards to EventsGateway
  ],
})
export class EventsModule {}

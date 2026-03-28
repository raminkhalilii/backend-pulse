import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  // createApplicationContext spins up the NestJS DI container without an HTTP server.
  // The @Processor() decorator on MonitorProcessor registers the BullMQ worker
  // automatically once the module initialises.
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();

  console.log('Worker Node is running and listening on monitor-queue…');
}

void bootstrap();

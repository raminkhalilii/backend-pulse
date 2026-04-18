import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Graceful shutdown: NestJS will wait for in-flight requests to complete
  // before allowing the process to exit when it receives SIGTERM from Docker.
  // Without this, Docker kills the container mid-request after stop_grace_period.
  app.enableShutdownHooks();

  // Swagger
  const config = new DocumentBuilder()
    .setTitle('User API')
    .setDescription('API documentation for user management')
    .setVersion('1.0')
    .addTag('users')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  // Exclude /health from the /api prefix so Docker healthcheck, Nginx upstream
  // checks, and GitHub Actions verification can all reach it at GET /health
  // without needing to know about the /api prefix.
  app.setGlobalPrefix('api', { exclude: ['health'] });
  app.useWebSocketAdapter(new IoAdapter(app));
  app.useGlobalPipes(new ValidationPipe());

  const port = process.env.PORT ?? 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`Application listening on port ${port}`);
}
void bootstrap();

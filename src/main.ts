import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Swagger Configuration
  const config = new DocumentBuilder()
    .setTitle('User API')
    .setDescription('API documentation for user management')
    .setVersion('1.0')
    .addTag('users')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  app.setGlobalPrefix('api');
  app.useWebSocketAdapter(new IoAdapter(app));
  app.useGlobalPipes(new ValidationPipe());

  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
void bootstrap();

// user/user.module.ts
import { Module } from '@nestjs/common';
import { UserService } from './user.service';

// 1. Import your "Claim Ticket" (the token) from the user folder
import { USER_REPOSITORY_TOKEN } from './user.repository.interface';

// 2. Import the actual Prisma code from your database folder
import { PrismaUserRepository } from '../database/prisma-user.repository';

import { PrismaService } from '../../prisma/prisma';
import { UserController } from './user.controller';

@Module({
  controllers: [UserController],
  providers: [
    // Tell the manager about your service and database connection
    UserService,
    PrismaService,

    // The Magic Wiring (The Claim Ticket System):
    {
      provide: USER_REPOSITORY_TOKEN, // "If anyone hands you this ticket..."
      useClass: PrismaUserRepository, // "...give them this specific class from the database folder."
    },
  ],
  // If any other modules (like an AuthModule) need to use the UserService, we export it here
  exports: [UserService],
})
export class UserModule {}

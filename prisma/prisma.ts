import { Injectable, OnModuleInit } from '@nestjs/common';
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    // 1. Grab the connection string
    const connectionString = process.env.DATABASE_URL;

    // 2. Optional but recommended: Safety check
    if (!connectionString) {
      throw new Error('DATABASE_URL is not defined in the environment variables.');
    }

    // 3. Initialize the adapter
    const adapter = new PrismaPg({ connectionString });

    // 4. Pass the adapter to the underlying PrismaClient via super()
    super({ adapter });
  }

  // 5. Implement the OnModuleInit interface to connect when the app starts
  async onModuleInit() {
    await this.$connect();
  }
}

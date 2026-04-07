import { PrismaService } from '../../prisma/prisma';
import { IUserRepository, CreateUserData, OAuthUserData } from '../user/user.repository.interface';
import { Injectable } from '@nestjs/common';
import { User } from '../../generated/prisma/client';

@Injectable()
export class UserRepository implements IUserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { id },
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  async create(data: CreateUserData): Promise<User> {
    return this.prisma.user.create({
      data,
    });
  }

  async updateRefreshToken(id: string, refreshToken: string): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { refreshToken },
    });
  }

  async findOrCreateOAuthUser(data: OAuthUserData): Promise<User> {
    return this.prisma.$transaction(async (tx) => {
      // 1. Check if this exact OAuth account already exists → return its user
      const existingAccount = await tx.oAuthAccount.findUnique({
        where: {
          provider_providerAccountId: {
            provider: data.provider,
            providerAccountId: data.providerAccountId,
          },
        },
        include: { user: true },
      });
      if (existingAccount) return existingAccount.user;

      // 2. Check if a user with this email already exists → link the new provider
      let user = await tx.user.findUnique({ where: { email: data.email } });

      // 3. No user at all → create one (no password for OAuth users)
      if (!user) {
        user = await tx.user.create({
          data: { email: data.email, name: data.name },
        });
      }

      // 4. Create the OAuth account record linked to the user
      await tx.oAuthAccount.create({
        data: {
          userId: user.id,
          provider: data.provider,
          providerAccountId: data.providerAccountId,
        },
      });

      return user;
    });
  }
}

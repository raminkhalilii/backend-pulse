import { CreateUserData, OAuthUserData } from '../user/user.repository.interface';
import { UserService } from '../user/user.service';
import * as bcrypt from 'bcrypt';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OAuthProvider, User } from '../../generated/prisma/client';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface OAuthProfile {
  provider: 'GOOGLE' | 'GITHUB';
  providerAccountId: string;
  email: string;
  name: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
  ) {}

  async registerUser(data: CreateUserData): Promise<AuthTokens> {
    // 1. Check if a user exists
    const existingUser = await this.userService.userFindByEmail(data.email);
    if (existingUser) {
      throw new Error('User already exists');
    }

    const hashedPassword = await this.hashing(data.password);

    const userToCreate = {
      ...data,
      password: hashedPassword,
    };

    const savedUser = await this.userService.createUser(userToCreate);
    return await this.generateTokens(savedUser.id, savedUser.email);
  }

  async validateUser(email: string, password: string): Promise<User> {
    const user = await this.userService.userFindByEmail(email);
    if (!user) {
      throw new UnauthorizedException('Invalid email or password.');
    }
    if (!user.password) {
      // OAuth-only account — no password set
      throw new UnauthorizedException('Invalid email or password.');
    }
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password.');
    }
    return user;
  }

  async generateTokens(
    userId: string,
    email: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const jwtPayload = {
      sub: userId,
      email,
    };
    const accessToken = await this.jwtService.signAsync(jwtPayload);
    const refreshToken = await this.jwtService.signAsync(jwtPayload, {
      secret: process.env.JWT_REFRESH_SECRET,
      expiresIn: '7d',
    });

    const hashedRefreshToken = this.hashing(refreshToken);

    await this.userService.updateRefreshToken(userId, await hashedRefreshToken);

    return { accessToken, refreshToken };
  }

  async login(email: string, plainTextPassword: string): Promise<AuthTokens> {
    const user = await this.validateUser(email, plainTextPassword);
    return await this.generateTokens(user.id, user.email);
  }

  async handleOAuthLogin(profile: OAuthProfile): Promise<AuthTokens> {
    const oauthData: OAuthUserData = {
      provider: profile.provider as OAuthProvider,
      providerAccountId: profile.providerAccountId,
      email: profile.email,
      name: profile.name,
    };
    const user = await this.userService.findOrCreateOAuthUser(oauthData);
    return this.generateTokens(user.id, user.email);
  }

  private async hashing(secret: string): Promise<string> {
    const saltRounds = 10;
    return await bcrypt.hash(secret, saltRounds);
  }
}

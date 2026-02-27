import { CreateUserData, User } from '../user/user.repository.interface';
import { UserService } from '../user/user.service';
import * as bcrypt from 'bcrypt';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  private savedUser: Omit<User, 'password'>;
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
  ) {}
  async registerUser(data: CreateUserData): Promise<Omit<User, 'password'>> {
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

    return (this.savedUser = await this.userService.createUser(userToCreate));
  }

  async validateUser(email: string, password: string): Promise<User> {
    const user = await this.userService.userFindByEmail(email);
    if (!user) {
      throw new Error('User not found');
    }
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new Error('Password is incorrect');
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
    const accessToken = await this.jwtService.signAsync(jwtPayload, {
      secret: process.env.ACCESS_TOKEN_SECRET,
      expiresIn: '15m',
    });
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

  private async hashing(secret: string): Promise<string> {
    const saltRounds = 10;
    return await bcrypt.hash(secret, saltRounds);
  }
}

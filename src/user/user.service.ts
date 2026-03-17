import {
  CreateUserData,
  type IUserRepository,
  USER_REPOSITORY_TOKEN,
} from './user.repository.interface';
import { Inject } from '@nestjs/common';
import { User } from '../../generated/prisma/client';
// TODO: we need a test for this service
// TODO: fix the comments

export class UserService {
  constructor(@Inject(USER_REPOSITORY_TOKEN) private readonly userRepository: IUserRepository) {}
  async createUser(data: CreateUserData): Promise<Omit<User, 'password'>> {
    return await this.userRepository.create(data);
  }
  async userFindByEmail(email: string): Promise<User | null> {
    return await this.userRepository.findByEmail(email);
  }

  async updateRefreshToken(id: string, refreshToken: string): Promise<void> {
    return await this.userRepository.updateRefreshToken(id, refreshToken);
  }
}

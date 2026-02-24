import { type IUserRepository, CreateUserData, User } from './user.repository.interface';
import { USER_REPOSITORY_TOKEN } from './user.repository.interface';
import { Inject } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

// TODO: we need a test for this service
// TODO: fix the comments
export class UserService {
  constructor(@Inject(USER_REPOSITORY_TOKEN) private readonly userRepository: IUserRepository) {}
  async registerUser(data: CreateUserData): Promise<Omit<User, 'passwordHash'>> {
    // 1. Check if a user exists
    const existingUser = await this.userRepository.findByEmail(data.email);
    if (existingUser) {
      throw new Error('User already exists');
    }

    // 2. Any other business logic (e.g., hashing passwords) goes here
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(data.passwordHash, saltRounds);

    const userToCreate = {
      ...data,
      passwordHash: hashedPassword,
    };

    const savedUser = await this.userRepository.create(userToCreate);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash, ...result } = savedUser;
    return result;
  }
}

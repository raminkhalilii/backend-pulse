import { User } from '../../generated/prisma/client';
// what user needs: 1-username 2-password(hashed Bcrypt or Argon2) 3-email 4-id

export interface CreateUserData {
  email: string;
  name: string;
  password: string;
}

export interface IUserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  create(data: CreateUserData): Promise<User>;
  updateRefreshToken(id: string, refreshToken: string): Promise<void>;
}

// This token is what NestJS will use to inject the repository
export const USER_REPOSITORY_TOKEN = 'USER_REPOSITORY_TOKEN';

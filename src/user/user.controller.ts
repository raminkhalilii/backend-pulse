import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { UserService } from './user.service';
import { RegisterUserDto } from './dto/register-user-dto';
import { User } from './user.repository.interface';

@ApiTags('users') // Groups these endpoints together in the Swagger UI
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post()
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({ status: 201, description: 'The user has been successfully created.' })
  @ApiResponse({ status: 400, description: 'Bad Request.' })
  async registerUser(
    @Body() registerUserDto: RegisterUserDto,
  ): Promise<Omit<User, 'passwordHash'>> {
    // Calls the method you already made in your UserService
    return this.userService.registerUser(registerUserDto);
  }
}

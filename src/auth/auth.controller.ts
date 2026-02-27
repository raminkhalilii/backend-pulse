import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Body, Controller, Post } from '@nestjs/common';
import { RegisterUserDto } from './dto/register-user-dto';
import { LoginUserDto } from './dto/login-user-dto';
import { User } from '../user/user.repository.interface';
import { AuthService, AuthTokens } from './auth.service';

@ApiTags('auth') // Groups these endpoints together in the Swagger UI
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post()
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({ status: 201, description: 'The user has been successfully created.' })
  @ApiResponse({ status: 400, description: 'Bad Request.' })
  async registerUser(@Body() registerUserDto: RegisterUserDto): Promise<Omit<User, 'password'>> {
    return this.authService.registerUser(registerUserDto);
  }

  @Post('login')
  @ApiOperation({ summary: 'Login user' })
  @ApiResponse({ status: 200, description: 'User successfully logged in.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async login(@Body() loginUserDto: LoginUserDto): Promise<AuthTokens> {
    const { email, password } = loginUserDto;
    return this.authService.login(email, password);
  }
}

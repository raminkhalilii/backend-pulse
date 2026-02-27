import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { UserService } from './user.service';

@ApiTags('users') // Groups these endpoints together in the Swagger UI
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  // async loginUser(loginUserDto: LoginUserDto) {
  //   return this.userService.loginUser(loginUserDto);
  // }
}

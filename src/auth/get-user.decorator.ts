import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import type { Request } from 'express';

interface RequestUser {
  userId: string;
}

export interface AuthenticatedRequest extends Request {
  user: RequestUser;
}

export const GetUserId = createParamDecorator((ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  return request.user.userId;
});

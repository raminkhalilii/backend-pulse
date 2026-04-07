import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { RegisterUserDto } from './dto/register-user-dto';
import { LoginUserDto } from './dto/login-user-dto';
import { AuthService, OAuthProfile } from './auth.service';
import { GoogleOAuthGuard } from './guards/google-oauth.guard';
import { GithubOAuthGuard } from './guards/github-oauth.guard';
import express from 'express';

export interface LoginResponse {
  accessToken: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  private setRefreshTokenCookie(res: express.Response, refreshToken: string) {
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });
  }

  // ── Email / Password ──────────────────────────────────────────────────────

  @Post()
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({ status: 201, description: 'The user has been successfully created.' })
  @ApiResponse({ status: 400, description: 'Bad Request.' })
  async registerUser(
    @Body() registerUserDto: RegisterUserDto,
    @Res({ passthrough: true }) res: express.Response,
  ): Promise<LoginResponse> {
    const tokens = await this.authService.registerUser(registerUserDto);
    this.setRefreshTokenCookie(res, tokens.refreshToken);
    return { accessToken: tokens.accessToken };
  }

  @Post('login')
  @ApiOperation({ summary: 'Login user' })
  @ApiResponse({ status: 200, description: 'User successfully logged in.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async login(
    @Body() loginUserDto: LoginUserDto,
    @Res({ passthrough: true }) res: express.Response,
  ): Promise<LoginResponse> {
    const { email, password } = loginUserDto;
    const tokens = await this.authService.login(email, password);
    this.setRefreshTokenCookie(res, tokens.refreshToken);
    return { accessToken: tokens.accessToken };
  }

  // ── Google OAuth ──────────────────────────────────────────────────────────

  @Get('google')
  @UseGuards(GoogleOAuthGuard)
  @ApiOperation({ summary: 'Initiate Google OAuth login' })
  googleLogin(): void {
    // Passport redirects the browser to Google — no handler body needed
  }

  @Get('google/callback')
  @UseGuards(GoogleOAuthGuard)
  @ApiOperation({ summary: 'Google OAuth callback' })
  async googleCallback(
    @Req() req: express.Request & { user: OAuthProfile },
    @Res() res: express.Response,
  ): Promise<void> {
    const tokens = await this.authService.handleOAuthLogin(req.user);
    this.setRefreshTokenCookie(res, tokens.refreshToken);
    res.redirect(`${process.env.FRONTEND_URL}/auth/callback?access_token=${tokens.accessToken}`);
  }

  // ── GitHub OAuth ──────────────────────────────────────────────────────────

  @Get('github')
  @UseGuards(GithubOAuthGuard)
  @ApiOperation({ summary: 'Initiate GitHub OAuth login' })
  githubLogin(): void {
    // Passport redirects the browser to GitHub — no handler body needed
  }

  @Get('github/callback')
  @UseGuards(GithubOAuthGuard)
  @ApiOperation({ summary: 'GitHub OAuth callback' })
  async githubCallback(
    @Req() req: express.Request & { user: OAuthProfile },
    @Res() res: express.Response,
  ): Promise<void> {
    const tokens = await this.authService.handleOAuthLogin(req.user);
    this.setRefreshTokenCookie(res, tokens.refreshToken);
    res.redirect(`${process.env.FRONTEND_URL}/auth/callback?access_token=${tokens.accessToken}`);
  }
}

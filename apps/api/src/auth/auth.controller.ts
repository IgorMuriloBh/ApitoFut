import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
} from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** POST /auth/login — { email, senha } → { token, usuario } */
  @Post('login')
  @HttpCode(200)
  login(@Body() corpo: { email?: string; senha?: string }) {
    if (
      typeof corpo?.email !== 'string' ||
      typeof corpo?.senha !== 'string' ||
      !corpo.email.trim() ||
      !corpo.senha
    ) {
      throw new BadRequestException('Informe e-mail e senha.');
    }
    return this.auth.login(corpo.email.trim(), corpo.senha);
  }
}

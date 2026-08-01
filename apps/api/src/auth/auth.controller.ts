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

  /** POST /auth/cadastro — auto-cadastro do organizador (RF031). */
  @Post('cadastro')
  @HttpCode(201)
  cadastro(
    @Body()
    corpo: {
      nome?: string;
      email?: string;
      senha?: string;
      organizacao?: string;
    },
  ) {
    const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    const nome = texto(corpo?.nome);
    const email = texto(corpo?.email);
    const organizacao = texto(corpo?.organizacao);

    if (!nome || !email || !organizacao || typeof corpo?.senha !== 'string') {
      throw new BadRequestException(
        'Informe nome, e-mail, organização e senha.',
      );
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('E-mail inválido.');
    }

    return this.auth.cadastrar({ nome, email, senha: corpo.senha, organizacao });
  }
}

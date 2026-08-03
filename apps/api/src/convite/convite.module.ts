import { Module } from '@nestjs/common';
import { ConviteController } from './convite.controller';
import { ConviteService } from './convite.service';

@Module({
  controllers: [ConviteController],
  providers: [ConviteService],
})
export class ConviteModule {}

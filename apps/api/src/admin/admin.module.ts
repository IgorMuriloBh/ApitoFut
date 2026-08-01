import { Module } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { SuperadminGuard } from '../auth/superadmin.guard';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  controllers: [AdminController],
  providers: [AdminService, AuthGuard, SuperadminGuard],
  exports: [AdminService],
})
export class AdminModule {}

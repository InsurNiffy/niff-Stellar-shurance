import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { WalletJwtGuard } from '../../auth/wallet-jwt.guard';
import { ProfileService } from './profile.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { CreatePrivacyRequestDto } from './dto/create-privacy-request.dto';

interface WalletRequest {
  wallet: string;
}

@Controller('profile')
@UseGuards(WalletJwtGuard)
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get()
  async getProfile(@Req() req: WalletRequest) {
    return this.profileService.getOrCreateProfile(req.wallet);
  }

  @Patch()
  async updateProfile(
    @Req() req: WalletRequest,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.profileService.updateProfile(req.wallet, dto);
  }
}

@Controller('admin/privacy-requests')
@UseGuards(WalletJwtGuard)
export class PrivacyRequestController {
  constructor(private readonly profileService: ProfileService) {}

  @Post()
  async createPrivacyRequest(
    @Req() req: WalletRequest,
    @Body() dto: CreatePrivacyRequestDto,
  ) {
    return this.profileService.createPrivacyRequest(req.wallet, dto);
  }
}

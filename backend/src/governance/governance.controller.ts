import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { GovernanceService } from './governance.service';
import { DelegateVoteDto } from './dto/governance.dto';

@ApiTags('governance')
@Controller('governance/delegations')
export class GovernanceController {
  constructor(private readonly governanceService: GovernanceService) {}

  @Post()
  @ApiOperation({ summary: 'Build an unsigned vote delegation transaction' })
  async delegate(@Body() dto: DelegateVoteDto) {
    return this.governanceService.buildDelegate(dto);
  }

  @Get(':address')
  @ApiOperation({ summary: 'Fetch the current vote delegation for an address' })
  async getDelegation(@Param('address') address: string) {
    return this.governanceService.getDelegation(address);
  }

  @Delete(':address')
  @ApiOperation({ summary: 'Build an unsigned undelegate transaction' })
  async undelegate(@Param('address') address: string) {
    return this.governanceService.buildUndelegate(address);
  }
}

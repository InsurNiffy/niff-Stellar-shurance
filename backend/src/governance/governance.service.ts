import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Address, nativeToScVal } from '@stellar/stellar-sdk';
import { SorobanService } from '../soroban/soroban.service';
import { DelegateVoteDto } from './dto/governance.dto';

interface VoteDelegation {
  delegate: string;
  expiry_ledger: number;
}

@Injectable()
export class GovernanceService {
  constructor(private readonly soroban: SorobanService) {}

  private addr(a: string) {
    return new Address(a).toScVal();
  }

  private u32(n: number) {
    return nativeToScVal(n, { type: 'u32' });
  }

  private async fetchDelegation(delegator: string): Promise<VoteDelegation | null> {
    return (await this.soroban.simulate('get_vote_delegation', [
      this.addr(delegator),
    ])) as VoteDelegation | null;
  }

  async getDelegation(address: string) {
    const d = await this.fetchDelegation(address);
    if (!d) throw new NotFoundException(`No delegation found for ${address}`);
    return { delegator: address, delegate: d.delegate, expiryLedger: Number(d.expiry_ledger) };
  }

  /** Build unsigned `delegate_vote(delegator, delegate, expiry_ledger)` tx. */
  async buildDelegate(dto: DelegateVoteDto) {
    const xdr = await this.soroban.buildInvokeTx(dto.delegator, 'delegate_vote', [
      this.addr(dto.delegator),
      this.addr(dto.delegatee),
      this.u32(dto.expiryLedger),
    ]);
    return { xdr };
  }

  /**
   * Build an unsigned undelegate tx. The contract has no dedicated revoke
   * entrypoint, so the existing delegation is re-submitted with
   * expiry_ledger = 0, which is already expired and therefore inactive.
   */
  async buildUndelegate(delegator: string) {
    const current = await this.fetchDelegation(delegator);
    if (!current) throw new BadRequestException(`No delegation to revoke for ${delegator}`);
    const xdr = await this.soroban.buildInvokeTx(delegator, 'delegate_vote', [
      this.addr(delegator),
      this.addr(current.delegate),
      this.u32(0),
    ]);
    return { xdr };
  }
}

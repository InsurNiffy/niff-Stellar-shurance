import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RampTransaction } from './entities/ramp-transaction.entity';
import { PolicyRenewal } from '../policies/entities/policy-renewal.entity';

export interface ReconciliationResult {
  matched: number;
  unmatched: number;
  alreadyReconciled: number;
}

@Injectable()
export class RampReconciliationService {
  private readonly logger = new Logger(RampReconciliationService.name);

  constructor(
    @InjectRepository(RampTransaction)
    private readonly rampTransactionRepository: Repository<RampTransaction>,
    @InjectRepository(PolicyRenewal)
    private readonly policyRenewalRepository: Repository<PolicyRenewal>,
  ) {}

  /**
   * Reconcile completed Ramp transactions against pending PolicyRenewal rows.
   * A transaction matches a renewal when the renewal's policy id equals the
   * transaction's policy id and the renewal is still awaiting payment.
   */
  async reconcile(): Promise<ReconciliationResult> {
    const result: ReconciliationResult = {
      matched: 0,
      unmatched: 0,
      alreadyReconciled: 0,
    };

    const completed = await this.rampTransactionRepository.find({
      where: { status: 'completed' },
    });

    for (const transaction of completed) {
      if (transaction.reconciledAt) {
        result.alreadyReconciled += 1;
        continue;
      }

      const renewal = await this.policyRenewalRepository.findOne({
        where: {
          policyId: transaction.policyId,
          status: 'pending',
        },
      });

      if (!renewal) {
        result.unmatched += 1;
        this.logger.warn(
          `No pending PolicyRenewal for Ramp transaction ${transaction.id}`,
        );
        continue;
      }

      renewal.status = 'paid';
      renewal.paidAt = transaction.completedAt ?? new Date();
      renewal.paymentReference = transaction.providerReference;
      await this.policyRenewalRepository.save(renewal);

      transaction.reconciledAt = new Date();
      transaction.policyRenewalId = renewal.id;
      await this.rampTransactionRepository.save(transaction);

      result.matched += 1;
    }

    this.logger.log(
      `Ramp reconciliation complete: ${result.matched} matched, ${result.unmatched} unmatched, ${result.alreadyReconciled} already reconciled`,
    );

    return result;
  }

  /**
   * Reconcile a single transaction, used right after a webhook is persisted.
   */
  async reconcileTransaction(
    transaction: RampTransaction,
  ): Promise<boolean> {
    if (transaction.status !== 'completed' || transaction.reconciledAt) {
      return false;
    }

    const renewal = await this.policyRenewalRepository.findOne({
      where: {
        policyId: transaction.policyId,
        status: 'pending',
      },
    });

    if (!renewal) {
      this.logger.warn(
        `No pending PolicyRenewal for Ramp transaction ${transaction.id}`,
      );
      return false;
    }

    renewal.status = 'paid';
    renewal.paidAt = transaction.completedAt ?? new Date();
    renewal.paymentReference = transaction.providerReference;
    await this.policyRenewalRepository.save(renewal);

    transaction.reconciledAt = new Date();
    transaction.policyRenewalId = renewal.id;
    await this.rampTransactionRepository.save(transaction);

    return true;
  }
}

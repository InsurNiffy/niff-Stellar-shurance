import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import { getBullMQConnection } from '../redis/client';
import { IndexerService } from './indexer.service';
import { getRuntimeEnv } from '../config/runtime-env';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from '../metrics/metrics.service';

/**
 * Enhanced reindex worker with resumable replay, progress tracking, and circuit breaker.
 * Consumes BullMQ `reindex` jobs after admin resets the ledger cursor.
 * Supports full historical event replay with checkpointing and recovery.
 */
interface ReindexProgress {
  jobId: string;
  network: string;
  startLedger: number;
  currentLedger: number;
  targetLedger: number;
  totalEvents: number;
  processedEvents: number;
  startTime: Date;
  lastUpdate: Date;
  status: 'running' | 'paused' | 'completed' | 'failed';
  errorCount: number;
  lastError?: string;
}

interface CircuitBreakerState {
  failures: number;
  lastFailure: Date;
  isOpen: boolean;
  nextAttempt: Date;
}

@Injectable()
export class ReindexWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReindexWorkerService.name);
  private worker?: Worker;
  private activeJobs = new Map<string, ReindexProgress>();
  private circuitBreakers = new Map<string, CircuitBreakerState>();
  private readonly CIRCUIT_BREAKER_THRESHOLD = 5;
  private readonly CIRCUIT_BREAKER_TIMEOUT = 60000; // 1 minute
  private readonly PROGRESS_UPDATE_INTERVAL = 30000; // 30 seconds
  private readonly MAX_BATCH_SIZE = 1000;
  private readonly MAX_CONSECUTIVE_ERRORS = 10;

  constructor(
    private readonly indexer: IndexerService,
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit(): void {
    const env = getRuntimeEnv();
    if (env.NODE_ENV === 'test' || env.DISABLE_REINDEX_WORKER === '1') {
      this.logger.log('Reindex BullMQ worker disabled (test or DISABLE_REINDEX_WORKER)');
      return;
    }
    try {
      this.worker = new Worker(
        'reindex',
        async (job) => {
          await this.processReindexJob(job);
        },
        { 
          connection: getBullMQConnection(),
          concurrency: 2, // Allow concurrent reindex jobs for different networks
        },
      );
      
      this.worker.on('failed', (job, err) => {
        this.logger.error(`Reindex job ${job?.id} failed: ${err?.message}`, err?.stack);
        this.handleJobFailure(job, err);
      });
      
      this.worker.on('completed', (job) => {
        this.logger.log(`Reindex job ${job.id} completed successfully`);
        this.handleJobCompletion(job);
      });
      
      // Start progress monitoring
      this.startProgressMonitoring();
      
    } catch (err) {
      this.logger.warn(`Reindex worker not started: ${String(err)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }

  private async processReindexJob(job: Job): Promise<void> {
    const { network, startLedger, targetLedger } = job.data as {
      network?: string;
      startLedger?: number;
      targetLedger?: number;
    };

    const jobId = job.id || 'unknown';
    const net = network || 'mainnet';

    this.logger.log(`Starting reindex job ${jobId} for network ${net}`);

    // Check circuit breaker
    if (this.isCircuitBreakerOpen(net)) {
      throw new Error(`Circuit breaker is open for network ${net}`);
    }

    try {
      const progress: ReindexProgress = {
        jobId,
        network: net,
        startLedger: startLedger || 0,
        currentLedger: startLedger || 0,
        targetLedger: targetLedger || 0,
        totalEvents: 0,
        processedEvents: 0,
        startTime: new Date(),
        lastUpdate: new Date(),
        status: 'running',
        errorCount: 0,
      };

      this.activeJobs.set(jobId, progress);
      await this.saveProgressToDatabase(progress);

      // Execute resumable reindex
      const result = await this.executeResumableReindex(progress);
      
      // Update final progress
      progress.status = 'completed';
      progress.currentLedger = result.finalLedger;
      progress.processedEvents = result.eventsProcessed;
      progress.lastUpdate = new Date();
      
      await this.saveProgressToDatabase(progress);
      this.activeJobs.delete(jobId);
      
      // Reset circuit breaker on success
      this.resetCircuitBreaker(net);
      
      this.logger.log(`Reindex job ${jobId} completed: ${result.eventsProcessed} events processed`);
      
    } catch (error) {
      this.handleJobFailure(job, error);
      throw error;
    }
  }

  private async executeResumableReindex(progress: ReindexProgress): Promise<{
    finalLedger: number;
    eventsProcessed: number;
  }> {
    let consecutiveErrors = 0;
    let totalEvents = 0;

    while (progress.currentLedger < progress.targetLedger || progress.targetLedger === 0) {
      try {
        // Get current latest ledger if target is 0 (catch up to current)
        if (progress.targetLedger === 0) {
          const latestLedger = await this.indexer.getLatestLedger();
          progress.targetLedger = latestLedger;
        }

        // Process batch with progress tracking
        const batchResult = await this.processBatchWithProgress(progress);
        
        if (batchResult.processed === 0) {
          // Check if we're caught up
          const latestLedger = await this.indexer.getLatestLedger();
          if (progress.currentLedger >= latestLedger) {
            break;
          }
          // No events but not caught up, advance cursor
          progress.currentLedger = Math.min(progress.currentLedger + 100, progress.targetLedger);
        } else {
          totalEvents += batchResult.processed;
          progress.processedEvents = totalEvents;
          consecutiveErrors = 0; // Reset error counter on success
        }

        // Update progress periodically
        if (totalEvents % 1000 === 0) {
          progress.lastUpdate = new Date();
          await this.saveProgressToDatabase(progress);
        }

        // Check if job should pause (circuit breaker or rate limiting)
        if (this.shouldPauseProcessing(progress.network)) {
          await this.waitForCircuitBreakerReset(progress.network);
        }

      } catch (error) {
        consecutiveErrors++;
        progress.errorCount++;
        progress.lastError = error instanceof Error ? error.message : 'Unknown error';
        
        this.logger.error(`Batch processing failed: ${progress.lastError}`);
        
        if (consecutiveErrors >= this.MAX_CONSECUTIVE_ERRORS) {
          throw new Error(`Too many consecutive errors: ${consecutiveErrors}`);
        }
        
        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, consecutiveErrors) * 1000));
      }
    }

    return {
      finalLedger: progress.currentLedger,
      eventsProcessed: totalEvents,
    };
  }

  private async processBatchWithProgress(progress: ReindexProgress): Promise<{ processed: number }> {
    const batchSize = Math.min(this.MAX_BATCH_SIZE, progress.targetLedger - progress.currentLedger);
    const result = await this.indexer.processBatchForNetwork(
      progress.network,
      progress.currentLedger,
      batchSize
    );
    
    progress.currentLedger += batchSize;
    return result;
  }

  private async saveProgressToDatabase(progress: ReindexProgress): Promise<void> {
    try {
      await this.prisma.reindexProgress.upsert({
        where: { jobId: progress.jobId },
        update: {
          currentLedger: progress.currentLedger,
          processedEvents: progress.processedEvents,
          status: progress.status,
          lastUpdate: progress.lastUpdate,
          errorCount: progress.errorCount,
          lastError: progress.lastError,
        },
        create: {
          jobId: progress.jobId,
          network: progress.network,
          startLedger: progress.startLedger,
          targetLedger: progress.targetLedger,
          currentLedger: progress.currentLedger,
          processedEvents: progress.processedEvents,
          startTime: progress.startTime,
          lastUpdate: progress.lastUpdate,
          status: progress.status,
          errorCount: progress.errorCount,
          lastError: progress.lastError,
        },
      });
    } catch (error) {
      this.logger.error('Failed to save progress to database', error);
    }
  }

  private handleJobFailure(job: Job, error: any): void {
    const jobId = job.id || 'unknown';
    const progress = this.activeJobs.get(jobId);
    
    if (progress) {
      progress.status = 'failed';
      progress.lastError = error instanceof Error ? error.message : 'Unknown error';
      progress.lastUpdate = new Date();
      
      this.saveProgressToDatabase(progress);
      this.activeJobs.delete(jobId);
    }
    
    // Update circuit breaker
    this.updateCircuitBreaker(progress?.network || 'mainnet', error);
    
    this.logger.error(`Reindex job ${jobId} failed: ${error}`);
  }

  private handleJobCompletion(job: Job): void {
    const jobId = job.id || 'unknown';
    this.activeJobs.delete(jobId);
    
    // Record metrics
    this.metrics.recordReindexJobCompleted();
  }

  private startProgressMonitoring(): void {
    setInterval(async () => {
      for (const [jobId, progress] of this.activeJobs) {
        if (progress.status === 'running') {
          progress.lastUpdate = new Date();
          await this.saveProgressToDatabase(progress);
          
          // Log progress
          const elapsed = Date.now() - progress.startTime.getTime();
          const rate = progress.processedEvents / (elapsed / 1000);
          this.logger.debug(
            `Reindex ${jobId}: ${progress.processedEvents} events, ` +
            `${progress.currentLedger}/${progress.targetLedger}, ` +
            `${rate.toFixed(2)} events/sec`
          );
        }
      }
    }, this.PROGRESS_UPDATE_INTERVAL);
  }

  private isCircuitBreakerOpen(network: string): boolean {
    const breaker = this.circuitBreakers.get(network);
    if (!breaker) return false;
    
    if (breaker.isOpen) {
      return Date.now() < breaker.nextAttempt.getTime();
    }
    
    return false;
  }

  private updateCircuitBreaker(network: string, error: any): void {
    const breaker = this.circuitBreakers.get(network) || {
      failures: 0,
      lastFailure: new Date(),
      isOpen: false,
      nextAttempt: new Date(),
    };
    
    breaker.failures++;
    breaker.lastFailure = new Date();
    
    if (breaker.failures >= this.CIRCUIT_BREAKER_THRESHOLD) {
      breaker.isOpen = true;
      breaker.nextAttempt = new Date(Date.now() + this.CIRCUIT_BREAKER_TIMEOUT);
      this.logger.warn(`Circuit breaker opened for network ${network}`);
    }
    
    this.circuitBreakers.set(network, breaker);
  }

  private resetCircuitBreaker(network: string): void {
    this.circuitBreakers.delete(network);
    this.logger.debug(`Circuit breaker reset for network ${network}`);
  }

  private async waitForCircuitBreakerReset(network: string): Promise<void> {
    const breaker = this.circuitBreakers.get(network);
    if (breaker?.isOpen) {
      const waitTime = breaker.nextAttempt.getTime() - Date.now();
      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }

  private shouldPauseProcessing(network: string): boolean {
    return this.isCircuitBreakerOpen(network);
  }
}

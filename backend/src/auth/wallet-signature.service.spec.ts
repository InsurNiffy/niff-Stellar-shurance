import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { Keypair } from '@stellar/stellar-sdk';
import { WalletSignatureService } from './wallet-signature.service';

describe('WalletSignatureService', () => {
  let service: WalletSignatureService;
  let keypair: Keypair;
  let message: string;
  let signature: string;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WalletSignatureService],
    }).compile();

    service = module.get<WalletSignatureService>(WalletSignatureService);
    keypair = Keypair.random();
    message = 'Test message for signature verification';
    signature = keypair.sign(Buffer.from(message)).toString('base64');
  });

  it('should verify valid signature', async () => {
    await expect(
      service.verifyEd25519(keypair.publicKey(), message, signature),
    ).resolves.toBeUndefined();
  });

  it('should throw on invalid signature', async () => {
    const invalidSignature = Keypair.random()
      .sign(Buffer.from(message))
      .toString('base64');

    await expect(
      service.verifyEd25519(keypair.publicKey(), message, invalidSignature),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('should throw on tampered message', async () => {
    const tamperedMessage = message + ' tampered';

    await expect(
      service.verifyEd25519(keypair.publicKey(), tamperedMessage, signature),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('should throw on wrong public key', async () => {
    const otherKeypair = Keypair.random();

    await expect(
      service.verifyEd25519(otherKeypair.publicKey(), message, signature),
    ).rejects.toThrow(UnauthorizedException);
  });
});

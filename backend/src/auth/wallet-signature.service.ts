import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Keypair } from '@stellar/stellar-sdk';

@Injectable()
export class WalletSignatureService {
  async verifyEd25519(
    publicKey: string,
    message: string,
    signatureBase64: string,
  ): Promise<void> {
    try {
      const keypair = Keypair.fromPublicKey(publicKey);
      const valid = keypair.verify(
        Buffer.from(message),
        Buffer.from(signatureBase64, 'base64'),
      );
      if (!valid) {
        throw new UnauthorizedException('Signature verification failed.');
      }
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException('Signature verification failed.');
    }
  }
}

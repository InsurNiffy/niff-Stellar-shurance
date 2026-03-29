import {
  loadNetworkConfig,
  _resetNetworkConfig,
} from './network.config';

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    saved[key] = process.env[key];
    if (vars[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = vars[key];
    }
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    _resetNetworkConfig();
  }
}

describe('loadNetworkConfig', () => {
  afterEach(() => _resetNetworkConfig());

  it('loads testnet defaults with correct passphrase', () => {
    withEnv({ STELLAR_NETWORK: 'testnet', STELLAR_NETWORK_PASSPHRASE: undefined }, () => {
      const cfg = loadNetworkConfig();
      expect(cfg.network).toBe('testnet');
      expect(cfg.networkPassphrase).toBe('Test SDF Network ; September 2015');
      expect(cfg.rpcUrl).toContain('testnet');
    });
  });

  it('loads mainnet config with correct passphrase', () => {
    withEnv(
      {
        STELLAR_NETWORK: 'mainnet',
        STELLAR_NETWORK_PASSPHRASE: undefined,
        CONTRACT_ID_MAINNET: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
      },
      () => {
        const cfg = loadNetworkConfig();
        expect(cfg.network).toBe('mainnet');
        expect(cfg.networkPassphrase).toBe('Public Global Stellar Network ; September 2015');
        expect(cfg.rpcUrl).toContain('mainnet');
      },
    );
  });

  it('loads futurenet config with correct passphrase', () => {
    withEnv({ STELLAR_NETWORK: 'futurenet', STELLAR_NETWORK_PASSPHRASE: undefined }, () => {
      const cfg = loadNetworkConfig();
      expect(cfg.network).toBe('futurenet');
      expect(cfg.networkPassphrase).toBe('Test SDF Future Network ; October 2022');
    });
  });

  // Acceptance criterion: startup fails with a clear error when network config is inconsistent
  it('throws on invalid STELLAR_NETWORK value', () => {
    withEnv({ STELLAR_NETWORK: 'devnet' }, () => {
      expect(() => loadNetworkConfig()).toThrow(/not valid/);
    });
  });

  it('throws when passphrase does not match the declared network', () => {
    withEnv(
      {
        STELLAR_NETWORK: 'testnet',
        STELLAR_NETWORK_PASSPHRASE: 'Public Global Stellar Network ; September 2015',
      },
      () => {
        expect(() => loadNetworkConfig()).toThrow(/passphrase mismatch/);
      },
    );
  });

  // Acceptance criterion: never allow Mainnet contract IDs with Testnet RPC
  it('throws when mainnet is active but CONTRACT_ID is missing', () => {
    withEnv(
      {
        STELLAR_NETWORK: 'mainnet',
        STELLAR_NETWORK_PASSPHRASE: undefined,
        CONTRACT_ID: undefined,
        CONTRACT_ID_MAINNET: undefined,
      },
      () => {
        expect(() => loadNetworkConfig()).toThrow(/CONTRACT_ID.*mainnet/i);
      },
    );
  });

  it('respects per-network RPC override', () => {
    withEnv(
      {
        STELLAR_NETWORK: 'testnet',
        SOROBAN_RPC_URL_TESTNET: 'https://custom-rpc.example.com',
        STELLAR_NETWORK_PASSPHRASE: undefined,
      },
      () => {
        const cfg = loadNetworkConfig();
        expect(cfg.rpcUrl).toBe('https://custom-rpc.example.com');
      },
    );
  });

  it('respects per-network contract ID override', () => {
    const contractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';
    withEnv(
      {
        STELLAR_NETWORK: 'testnet',
        CONTRACT_ID_TESTNET: contractId,
        STELLAR_NETWORK_PASSPHRASE: undefined,
      },
      () => {
        const cfg = loadNetworkConfig();
        expect(cfg.contractIds.niffyinsure).toBe(contractId);
      },
    );
  });

  // Acceptance criterion: RPC calls use the correct passphrase for the configured network
  it('testnet passphrase is never the mainnet passphrase', () => {
    withEnv({ STELLAR_NETWORK: 'testnet', STELLAR_NETWORK_PASSPHRASE: undefined }, () => {
      const cfg = loadNetworkConfig();
      expect(cfg.networkPassphrase).not.toBe('Public Global Stellar Network ; September 2015');
    });
  });

  it('mainnet passphrase is never the testnet passphrase', () => {
    withEnv(
      {
        STELLAR_NETWORK: 'mainnet',
        STELLAR_NETWORK_PASSPHRASE: undefined,
        CONTRACT_ID_MAINNET: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
      },
      () => {
        const cfg = loadNetworkConfig();
        expect(cfg.networkPassphrase).not.toBe('Test SDF Network ; September 2015');
      },
    );
  });
});

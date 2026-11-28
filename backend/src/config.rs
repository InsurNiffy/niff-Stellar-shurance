use std::collections::HashMap;
use std::env;
use std::fmt;

/// Environment-scoped network configuration.
///
/// Env var naming convention for multi-network deployments:
///   NETWORK                       -> active network: `futurenet` | `testnet` | `mainnet`
///   <NETWORK>_RPC_URL             -> e.g. TESTNET_RPC_URL
///   <NETWORK>_HORIZON_URL         -> e.g. TESTNET_HORIZON_URL
///   <NETWORK>_NETWORK_PASSPHRASE  -> e.g. TESTNET_NETWORK_PASSPHRASE
///   <NETWORK>_CONTRACT_<NAME>     -> e.g. TESTNET_CONTRACT_RAMP
///
/// `<NETWORK>` is the uppercased active network. Contract IDs are scoped to the
/// active network so a Mainnet contract ID can never be paired with a Testnet RPC.
#[derive(Debug, Clone)]
pub struct NetworkConfig {
    pub network: String,
    pub rpc_url: String,
    pub horizon_url: String,
    pub network_passphrase: String,
    pub contract_ids: HashMap<String, String>,
}

#[derive(Debug)]
pub struct ConfigError(pub String);

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "network config error: {}", self.0)
    }
}

impl std::error::Error for ConfigError {}

const KNOWN_NETWORKS: [&str; 3] = ["futurenet", "testnet", "mainnet"];

fn required(key: &str) -> Result<String, ConfigError> {
    match env::var(key) {
        Ok(v) if !v.trim().is_empty() => Ok(v),
        _ => Err(ConfigError(format!("missing required env var `{key}`"))),
    }
}

impl NetworkConfig {
    /// Load and validate the active network config from the environment.
    /// Fails fast on missing or inconsistent values.
    pub fn from_env() -> Result<Self, ConfigError> {
        let network = required("NETWORK")?.to_lowercase();
        if !KNOWN_NETWORKS.contains(&network.as_str()) {
            return Err(ConfigError(format!(
                "unknown NETWORK `{network}`; expected one of {KNOWN_NETWORKS:?}"
            )));
        }

        let prefix = network.to_uppercase();
        let rpc_url = required(&format!("{prefix}_RPC_URL"))?;
        let horizon_url = required(&format!("{prefix}_HORIZON_URL"))?;
        let network_passphrase = required(&format!("{prefix}_NETWORK_PASSPHRASE"))?;

        let contract_prefix = format!("{prefix}_CONTRACT_");
        let mut contract_ids = HashMap::new();
        for (key, value) in env::vars() {
            if let Some(name) = key.strip_prefix(&contract_prefix) {
                if value.trim().is_empty() {
                    return Err(ConfigError(format!("empty contract id in `{key}`")));
                }
                contract_ids.insert(name.to_lowercase(), value);
            }
        }
        if contract_ids.is_empty() {
            return Err(ConfigError(format!(
                "no contract IDs configured; expected at least one `{contract_prefix}<NAME>`"
            )));
        }

        let config = Self {
            network,
            rpc_url,
            horizon_url,
            network_passphrase,
            contract_ids,
        };
        config.validate()?;
        Ok(config)
    }

    /// Validate internal consistency of the loaded config.
    pub fn validate(&self) -> Result<(), ConfigError> {
        if !self.rpc_url.starts_with("http") {
            return Err(ConfigError(format!(
                "RPC URL `{}` must be an http(s) URL",
                self.rpc_url
            )));
        }
        if !self.horizon_url.starts_with("http") {
            return Err(ConfigError(format!(
                "Horizon URL `{}` must be an http(s) URL",
                self.horizon_url
            )));
        }
        if self.network_passphrase.trim().is_empty() {
            return Err(ConfigError("network passphrase must not be empty".into()));
        }
        Ok(())
    }

    /// Assert that the passphrase reported by the RPC endpoint matches the
    /// configured passphrase. Prevents e.g. Mainnet contract IDs being used
    /// against a Testnet RPC.
    pub fn assert_rpc_passphrase(&self, rpc_passphrase: &str) -> Result<(), ConfigError> {
        if rpc_passphrase != self.network_passphrase {
            return Err(ConfigError(format!(
                "RPC network passphrase mismatch for `{}`: configured `{}` but RPC reports `{}`",
                self.network, self.network_passphrase, rpc_passphrase
            )));
        }
        Ok(())
    }

    /// Log the active network prominently at startup.
    pub fn log_active(&self) {
        log::info!(
            "================ ACTIVE NETWORK: {} ================",
            self.network.to_uppercase()
        );
        log::info!("rpc_url={} horizon_url={}", self.rpc_url, self.horizon_url);
        log::info!("network_passphrase={}", self.network_passphrase);
        log::info!("contract_ids={:?}", self.contract_ids);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(network: &str, passphrase: &str) -> NetworkConfig {
        let mut contract_ids = HashMap::new();
        contract_ids.insert("ramp".to_string(), "C...".to_string());
        NetworkConfig {
            network: network.to_string(),
            rpc_url: "https://rpc.example.org".to_string(),
            horizon_url: "https://horizon.example.org".to_string(),
            network_passphrase: passphrase.to_string(),
            contract_ids,
        }
    }

    #[test]
    fn mainnet_contracts_rejected_against_testnet_rpc() {
        let cfg = sample("mainnet", "Public Global Stellar Network ; September 2015");
        let err = cfg
            .assert_rpc_passphrase("Test SDF Network ; September 2015")
            .unwrap_err();
        assert!(err.to_string().contains("mismatch"));
    }

    #[test]
    fn matching_passphrase_passes() {
        let cfg = sample("testnet", "Test SDF Network ; September 2015");
        assert!(cfg
            .assert_rpc_passphrase("Test SDF Network ; September 2015")
            .is_ok());
    }
}

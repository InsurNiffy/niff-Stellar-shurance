use soroban_sdk::{contracttype, Address, Env, String, Vec};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum VetDataKey {
    Vet(Address),
    VetSpecializations(Address),
    VetRegistry,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VetRecord {
    pub address: Address,
    pub specializations: Vec<String>,
    pub active: bool,
}

/// Register a vet with a set of specializations.
pub fn register_vet(env: &Env, vet: &Address, specializations: Vec<String>) {
    vet.require_auth();
    let record = VetRecord {
        address: vet.clone(),
        specializations: specializations.clone(),
        active: true,
    };
    env.storage()
        .persistent()
        .set(&VetDataKey::Vet(vet.clone()), &record);
    env.storage()
        .persistent()
        .set(&VetDataKey::VetSpecializations(vet.clone()), &specializations);

    let mut registry: Vec<Address> = env
        .storage()
        .persistent()
        .get(&VetDataKey::VetRegistry)
        .unwrap_or(Vec::new(env));
    if !registry.contains(vet) {
        registry.push_back(vet.clone());
        env.storage()
            .persistent()
            .set(&VetDataKey::VetRegistry, &registry);
    }
}

/// Returns the specializations stored for a vet, if registered.
pub fn vet_specializations(env: &Env, vet: &Address) -> Option<Vec<String>> {
    env.storage()
        .persistent()
        .get(&VetDataKey::VetSpecializations(vet.clone()))
}

/// Returns true if at least one active registered vet has the required specialization.
pub fn has_vet_with_specialization(env: &Env, specialization: &String) -> bool {
    let registry: Vec<Address> = env
        .storage()
        .persistent()
        .get(&VetDataKey::VetRegistry)
        .unwrap_or(Vec::new(env));
    for addr in registry.iter() {
        let record: Option<VetRecord> = env
            .storage()
            .persistent()
            .get(&VetDataKey::Vet(addr.clone()));
        if let Some(r) = record {
            if r.active && r.specializations.contains(specialization) {
                return true;
            }
        }
    }
    false
}

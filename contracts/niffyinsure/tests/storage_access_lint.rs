//! Lint-style test: only `storage.rs` may call `env.storage()` in production src.
//!
//! Closes the exclusivity acceptance criterion for the storage / TTL layer.

#![cfg(test)]

use std::fs;
use std::path::PathBuf;

#[test]
fn only_storage_rs_calls_env_storage() {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let src = manifest.join("src");
    let mut offenders = Vec::new();

    for entry in fs::read_dir(&src).expect("src dir") {
        let entry = entry.expect("dir entry");
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("rs") {
            continue;
        }
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if name == "storage.rs" {
            continue;
        }
        let contents = fs::read_to_string(&path).expect("read rust file");
        for (idx, line) in contents.lines().enumerate() {
            let trimmed = line.trim();
            if trimmed.starts_with("//") {
                continue;
            }
            if trimmed.contains("env.storage()") {
                offenders.push(format!("{}:{}: {}", name, idx + 1, trimmed));
            }
        }
    }

    assert!(
        offenders.is_empty(),
        "env.storage() must only appear in storage.rs; found:\n{}",
        offenders.join("\n")
    );
}

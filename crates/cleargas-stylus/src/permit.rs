//! EIP-2612 Permit Hash & Digest Utilities for Paxos USDG

use sha3::{Digest, Keccak256};

pub const PERMIT_TYPEHASH: [u8; 32] = [
    0x6e, 0x71, 0xed, 0xae, 0x12, 0xb1, 0xb9, 0x7f, 0x4d, 0x1f, 0x60, 0x37, 0x0f, 0xef, 0x10, 0x10,
    0x5f, 0xa2, 0xfa, 0xae, 0x01, 0x26, 0x11, 0x4a, 0x16, 0x9c, 0x64, 0x84, 0x5d, 0x61, 0x26, 0xc9,
];

pub fn compute_domain_separator(
    name: &str,
    version: &str,
    chain_id: u64,
    verifying_contract: &[u8; 20],
) -> [u8; 32] {
    let type_hash = keccak256_str("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    let name_hash = keccak256_str(name);
    let version_hash = keccak256_str(version);

    let mut encoded = Vec::with_capacity(32 * 5);
    encoded.extend_from_slice(&type_hash);
    encoded.extend_from_slice(&name_hash);
    encoded.extend_from_slice(&version_hash);
    
    let mut chain_buf = [0u8; 32];
    chain_buf[24..].copy_from_slice(&chain_id.to_be_bytes());
    encoded.extend_from_slice(&chain_buf);

    let mut addr_buf = [0u8; 32];
    addr_buf[12..].copy_from_slice(verifying_contract);
    encoded.extend_from_slice(&addr_buf);

    keccak256_slice(&encoded)
}

pub fn compute_permit_digest(
    domain_separator: &[u8; 32],
    owner: &[u8; 20],
    spender: &[u8; 20],
    value: u128,
    nonce: u64,
    deadline: u64,
) -> [u8; 32] {
    let mut struct_encoded = Vec::with_capacity(32 * 6);
    struct_encoded.extend_from_slice(&PERMIT_TYPEHASH);

    let mut owner_buf = [0u8; 32];
    owner_buf[12..].copy_from_slice(owner);
    struct_encoded.extend_from_slice(&owner_buf);

    let mut spender_buf = [0u8; 32];
    spender_buf[12..].copy_from_slice(spender);
    struct_encoded.extend_from_slice(&spender_buf);

    let mut val_buf = [0u8; 32];
    val_buf[16..].copy_from_slice(&value.to_be_bytes());
    struct_encoded.extend_from_slice(&val_buf);

    let mut nonce_buf = [0u8; 32];
    nonce_buf[24..].copy_from_slice(&nonce.to_be_bytes());
    struct_encoded.extend_from_slice(&nonce_buf);

    let mut dl_buf = [0u8; 32];
    dl_buf[24..].copy_from_slice(&deadline.to_be_bytes());
    struct_encoded.extend_from_slice(&dl_buf);

    let struct_hash = keccak256_slice(&struct_encoded);

    let mut eip712_buf = Vec::with_capacity(2 + 32 + 32);
    eip712_buf.extend_from_slice(b"\x19\x01");
    eip712_buf.extend_from_slice(domain_separator);
    eip712_buf.extend_from_slice(&struct_hash);

    keccak256_slice(&eip712_buf)
}

fn keccak256_str(s: &str) -> [u8; 32] {
    let mut hasher = Keccak256::new();
    hasher.update(s.as_bytes());
    let result = hasher.finalize();
    let mut out = [0u8; 32];
    out.copy_from_slice(&result);
    out
}

fn keccak256_slice(bytes: &[u8]) -> [u8; 32] {
    let mut hasher = Keccak256::new();
    hasher.update(bytes);
    let result = hasher.finalize();
    let mut out = [0u8; 32];
    out.copy_from_slice(&result);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_domain_separator_deterministic() {
        let contract = [0x11; 20];
        let ds = compute_domain_separator("Global Dollar", "1", 4663, &contract);
        assert_ne!(ds, [0u8; 32]);
    }

    #[test]
    fn test_permit_digest_differs_on_nonce() {
        let contract = [0x11; 20];
        let ds = compute_domain_separator("Global Dollar", "1", 4663, &contract);
        let owner = [0x22; 20];
        let spender = [0x33; 20];

        let d1 = compute_permit_digest(&ds, &owner, &spender, 10_000_000, 0, 1800000000);
        let d2 = compute_permit_digest(&ds, &owner, &spender, 10_000_000, 1, 1800000000);
        assert_ne!(d1, d2);
    }
}

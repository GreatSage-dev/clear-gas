//! High-Performance Pre-Flight Validation Engine for ERC-4337 UserOperations

use crate::error::ClearGasError;
use crate::fixed_point::{compute_spread_bps, eth_wei_to_usdg_micro};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreflightRequest {
    pub sender: [u8; 20],
    pub user_usdg_balance: u128,
    pub user_usdg_allowance: u128,
    pub paymaster_deposit_wei: u128,
    pub max_cost_wei: u128,
    pub eth_usd_price_8_dec: u128,
    pub oracle_conf: u64,
    pub oracle_publish_time: u64,
    pub current_time: u64,
    pub permit_deadline: u64,
    pub max_oracle_age_secs: u64,
    pub max_spread_bps: u32,
    pub markup_bps: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PreflightVerdict {
    Approved {
        required_usdg_micro: u128,
        stylus_gas_estimate: u64,
        solidity_gas_estimate: u64,
        auto_refill_triggered: bool,
    },
    Rejected(ClearGasError),
}

pub struct PreflightEngine;

impl PreflightEngine {
    pub const STYLUS_BASE_VALIDATION_GAS: u64 = 14_180;
    pub const SOLIDITY_BASE_VALIDATION_GAS: u64 = 268_450;
    pub const REFILL_THRESHOLD_WEI: u128 = 50_000_000_000_000_000; // 0.05 ETH

    pub fn evaluate(req: &PreflightRequest) -> PreflightVerdict {
        // 1. Oracle Freshness Check
        if req.current_time.saturating_sub(req.oracle_publish_time) > req.max_oracle_age_secs {
            return PreflightVerdict::Rejected(ClearGasError::OracleStale {
                elapsed_seconds: req.current_time.saturating_sub(req.oracle_publish_time),
                max_age_seconds: req.max_oracle_age_secs,
            });
        }

        // 2. Oracle Spread / Volatility Quarantine (Tri-State Epistemic Refusal)
        let spread_bps = compute_spread_bps(req.oracle_conf, req.eth_usd_price_8_dec as u64);
        if spread_bps > req.max_spread_bps {
            return PreflightVerdict::Rejected(ClearGasError::OracleSpreadQuarantine {
                observed_spread_bps: spread_bps,
                max_spread_bps: req.max_spread_bps,
            });
        }

        // 3. EIP-2612 Permit Deadline Check
        if req.permit_deadline > 0 && req.current_time > req.permit_deadline {
            return PreflightVerdict::Rejected(ClearGasError::PermitExpired {
                deadline: req.permit_deadline,
                current_time: req.current_time,
            });
        }

        // 4. EntryPoint Deposit Prefund Check (The AA21 Sentinel)
        if req.paymaster_deposit_wei < req.max_cost_wei {
            return PreflightVerdict::Rejected(ClearGasError::PrefundDeficit {
                needed_wei: req.max_cost_wei,
                available_wei: req.paymaster_deposit_wei,
                shortfall_wei: req.max_cost_wei - req.paymaster_deposit_wei,
            });
        }

        // 5. User Paxos USDG Prefund Check
        let required_usdg = eth_wei_to_usdg_micro(
            req.max_cost_wei,
            req.eth_usd_price_8_dec,
            req.markup_bps,
        );

        if req.user_usdg_balance < required_usdg {
            return PreflightVerdict::Rejected(ClearGasError::InsufficientUsdgBalance {
                user_balance: req.user_usdg_balance,
                required_usdg,
            });
        }

        let auto_refill_triggered = req.paymaster_deposit_wei < Self::REFILL_THRESHOLD_WEI;

        PreflightVerdict::Approved {
            required_usdg_micro: required_usdg,
            stylus_gas_estimate: Self::STYLUS_BASE_VALIDATION_GAS,
            solidity_gas_estimate: Self::SOLIDITY_BASE_VALIDATION_GAS,
            auto_refill_triggered,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_valid_request() -> PreflightRequest {
        PreflightRequest {
            sender: [0xaa; 20],
            user_usdg_balance: 50_000_000,      // $50.00 USDG
            user_usdg_allowance: 50_000_000,
            paymaster_deposit_wei: 200_000_000_000_000_000, // 0.20 ETH
            max_cost_wei: 10_000_000_000_000,  // 0.00001 ETH (~$0.025)
            eth_usd_price_8_dec: 250_000_000_000, // $2,500.00
            oracle_conf: 125_000_000,          // 5 bps spread
            oracle_publish_time: 1700000000,
            current_time: 1700000010,
            permit_deadline: 1700003600,
            max_oracle_age_secs: 60,
            max_spread_bps: 150,
            markup_bps: 150,
        }
    }

    #[test]
    fn test_valid_request_approves() {
        let req = sample_valid_request();
        match PreflightEngine::evaluate(&req) {
            PreflightVerdict::Approved { required_usdg_micro, stylus_gas_estimate, .. } => {
                assert!(required_usdg_micro > 0);
                assert_eq!(stylus_gas_estimate, 14_180);
            }
            _ => panic!("Expected Approved verdict"),
        }
    }

    #[test]
    fn test_prefund_deficit_triggers_aa21_error() {
        let mut req = sample_valid_request();
        req.paymaster_deposit_wei = 1_000; // tiny deposit
        req.max_cost_wei = 10_000_000_000_000;
        match PreflightEngine::evaluate(&req) {
            PreflightVerdict::Rejected(ClearGasError::PrefundDeficit { shortfall_wei, .. }) => {
                assert!(shortfall_wei > 0);
            }
            _ => panic!("Expected PrefundDeficit error"),
        }
    }

    #[test]
    fn test_oracle_spread_quarantine_triggers_halt() {
        let mut req = sample_valid_request();
        // 400 bps spread (exceeds 150 bps limit)
        req.oracle_conf = 10_000_000_000;
        match PreflightEngine::evaluate(&req) {
            PreflightVerdict::Rejected(ClearGasError::OracleSpreadQuarantine { observed_spread_bps, .. }) => {
                assert_eq!(observed_spread_bps, 400);
            }
            _ => panic!("Expected OracleSpreadQuarantine error"),
        }
    }
}

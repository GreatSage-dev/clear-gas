//! Structured Remediation Errors for ClearGas (Aviation Annunciation Primitive)

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClearGasError {
    /// Paymaster EntryPoint deposit is insufficient to underwrite the UserOp
    PrefundDeficit {
        needed_wei: u128,
        available_wei: u128,
        shortfall_wei: u128,
    },
    /// Oracle confidence interval exceeds allowable risk spread
    OracleSpreadQuarantine {
        observed_spread_bps: u32,
        max_spread_bps: u32,
    },
    /// Price feed is stale beyond allowable threshold
    OracleStale {
        elapsed_seconds: u64,
        max_age_seconds: u64,
    },
    /// User holds insufficient Paxos USDG to cover the prefund
    InsufficientUsdgBalance {
        user_balance: u128,
        required_usdg: u128,
    },
    /// EIP-2612 Permit has expired
    PermitExpired {
        deadline: u64,
        current_time: u64,
    },
    /// Permit signature does not match owner
    PermitSignatureMismatch,
    /// Price is negative or zero
    InvalidPrice,
}

impl std::fmt::Display for ClearGasError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ClearGasError::PrefundDeficit { needed_wei, available_wei, shortfall_wei } => {
                write!(f, "ERR_PAYMASTER_PREFUND_DEFICIT: EntryPoint deposit deficit. Needed: {} wei, Available: {} wei, Shortfall: {} wei. Action: Auto-recharge trigger activated.", needed_wei, available_wei, shortfall_wei)
            }
            ClearGasError::OracleSpreadQuarantine { observed_spread_bps, max_spread_bps } => {
                write!(f, "ERR_ORACLE_SPREAD_QUARANTINE: Market volatility spread ({} bps) exceeds maximum safety limit ({} bps). Action: Tri-State epistemic halt engaged, 100% collateral retained.", observed_spread_bps, max_spread_bps)
            }
            ClearGasError::OracleStale { elapsed_seconds, max_age_seconds } => {
                write!(f, "ERR_ORACLE_STALE: Price feed latency ({}s) exceeds max freshness ({}s). Action: Refusing to clear at unverified exchange rate.", elapsed_seconds, max_age_seconds)
            }
            ClearGasError::InsufficientUsdgBalance { user_balance, required_usdg } => {
                write!(f, "ERR_INSUFFICIENT_USDG: User USDG balance ({} micro-USDG) is below required prefund ({} micro-USDG).", user_balance, required_usdg)
            }
            ClearGasError::PermitExpired { deadline, current_time } => {
                write!(f, "ERR_PERMIT_EXPIRED: Permit deadline {} is earlier than current block time {}.", deadline, current_time)
            }
            ClearGasError::PermitSignatureMismatch => {
                write!(f, "ERR_PERMIT_SIG_MISMATCH: Recovered signer does not match token owner address.")
            }
            ClearGasError::InvalidPrice => {
                write!(f, "ERR_INVALID_PRICE: Pyth oracle returned non-positive price value.")
            }
        }
    }
}

impl std::error::Error for ClearGasError {}

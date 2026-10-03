//! Fixed-Point Gas & Currency Conversion Math for Stylus WASM Runtime

pub const BPS_DENOMINATOR: u128 = 10_000;
pub const ETH_TO_USDG_SCALE: u128 = 100_000_000_000_000_000_000; // 10^20

/// Converts native ETH gas cost in wei (18 decimals) to Paxos USDG (6 decimals)
/// Using an 8-decimal ETH/USD oracle price (e.g. 2500_00000000 = $2,500.00)
pub fn eth_wei_to_usdg_micro(
    eth_wei: u128,
    eth_usd_price_8_dec: u128,
    markup_bps: u32,
) -> u128 {
    // Formula: (eth_wei * eth_price) / 10^20 * (10_000 + markup_bps) / 10_000
    // Using u128 without overflow for realistic gas limits
    let base_usdg = (eth_wei.saturating_mul(eth_usd_price_8_dec)) / ETH_TO_USDG_SCALE;
    let with_markup = base_usdg.saturating_mul(BPS_DENOMINATOR + markup_bps as u128) / BPS_DENOMINATOR;
    
    // Ensure 0.001 USDG floor (1000 micro-USDG) so micro-trades are never rounded to zero
    if with_markup == 0 && eth_wei > 0 {
        1000
    } else {
        with_markup
    }
}

/// Converts Paxos USDG (6 decimals) to native ETH in wei (18 decimals)
pub fn usdg_micro_to_eth_wei(
    usdg_micro: u128,
    eth_usd_price_8_dec: u128,
) -> u128 {
    if eth_usd_price_8_dec == 0 {
        return 0;
    }
    (usdg_micro.saturating_mul(ETH_TO_USDG_SCALE)) / eth_usd_price_8_dec
}

/// Computes the confidence interval spread in basis points (bps)
pub fn compute_spread_bps(conf: u64, price: u64) -> u32 {
    if price == 0 {
        return 10_000; // 100% spread if zero price
    }
    ((conf as u128 * BPS_DENOMINATOR) / (price as u128)) as u32
}

/// Exponential Moving Average (EMA) for dampening sudden Robinhood Chain gas spikes
#[derive(Debug, Clone, Copy)]
pub struct VolatilityFilter {
    pub current_ema_price: u128,
    pub smoothing_weight_bps: u32, // e.g. 2000 = 20% weight to new sample
}

impl VolatilityFilter {
    pub fn new(initial_price: u128, smoothing_weight_bps: u32) -> Self {
        Self {
            current_ema_price: initial_price,
            smoothing_weight_bps,
        }
    }

    pub fn update(&mut self, new_sample: u128) -> u128 {
        let weight = self.smoothing_weight_bps as u128;
        let complement = BPS_DENOMINATOR - weight;
        self.current_ema_price = (new_sample.saturating_mul(weight) + self.current_ema_price.saturating_mul(complement)) / BPS_DENOMINATOR;
        self.current_ema_price
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_eth_to_usdg_conversion_exact() {
        // 0.001 ETH (10^15 wei) at $2,500.00 (2500_00000000) with 0 markup
        // Should equal $2.50 USDG (2_500_000 micro-USDG)
        let eth_wei = 1_000_000_000_000_000;
        let price = 250_000_000_000;
        let usdg = eth_wei_to_usdg_micro(eth_wei, price, 0);
        assert_eq!(usdg, 2_500_000);
    }

    #[test]
    fn test_gas_fee_typical_retail_swap() {
        // Typical Robinhood Chain swap: 50,000 gas at 0.1 gwei = 5,000,000,000,000 wei
        // At $2,500 ETH with 150 bps (1.5%) markup:
        // 5 * 10^12 * 2500 * 10^8 / 10^20 = 12500 micro-USDG ($0.0125)
        // With 1.5% markup = $0.012687 (12687 micro-USDG)
        let eth_wei = 5_000_000_000_000;
        let price = 250_000_000_000;
        let usdg = eth_wei_to_usdg_micro(eth_wei, price, 150);
        assert_eq!(usdg, 12_687);
    }

    #[test]
    fn test_spread_bps_calculation() {
        // Price $2,500 (2500_00000000), Conf $2.50 (250000000)
        // Spread = 10 bps
        let spread = compute_spread_bps(250_000_000, 250_000_000_000);
        assert_eq!(spread, 10);
    }
}

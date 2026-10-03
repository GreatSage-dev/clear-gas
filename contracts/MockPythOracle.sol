// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IPyth.sol";

contract MockPythOracle is IPyth {
    PythPrice private currentPrice;
    bytes32 public constant ETH_USD_FEED_ID = keccak256("ETH_USD_FEED_ROBINHOOD");

    constructor() {
        // Default: $2,500.00 per ETH (2500_00000000 with expo -8)
        // Confidence: $1.25 spread (12500000 with expo -8, ~5 bps spread)
        currentPrice = PythPrice({
            price: 250000000000,
            conf: 12500000,
            expo: -8,
            publishTime: block.timestamp
        });
    }

    function setPrice(int64 price, uint64 conf, int32 expo, uint256 publishTime) external {
        currentPrice = PythPrice({
            price: price,
            conf: conf,
            expo: expo,
            publishTime: publishTime == 0 ? block.timestamp : publishTime
        });
    }

    function simulateSpreadDivergence(uint64 wideConf) external {
        currentPrice.conf = wideConf;
        currentPrice.publishTime = block.timestamp;
    }

    function simulateStalePrice(uint256 secondsAgo) external {
        currentPrice.publishTime = block.timestamp - secondsAgo;
    }

    function getPrice(bytes32 /* id */) external view override returns (PythPrice memory) {
        return currentPrice;
    }

    function getPriceNoOlderThan(bytes32 /* id */, uint256 age) external view override returns (PythPrice memory) {
        require(block.timestamp - currentPrice.publishTime <= age, "Pyth: price is stale");
        return currentPrice;
    }
}

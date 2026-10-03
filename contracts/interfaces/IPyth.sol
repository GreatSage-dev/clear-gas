// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

struct PythPrice {
    int64 price;
    uint64 conf;
    int32 expo;
    uint256 publishTime;
}

interface IPyth {
    function getPrice(bytes32 id) external view returns (PythPrice memory price);
    function getPriceNoOlderThan(bytes32 id, uint256 age) external view returns (PythPrice memory price);
}

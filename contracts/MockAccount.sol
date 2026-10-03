// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MockAccount
 * @notice Standard ERC-4337 / EIP-7702 account execution logic.
 * Allows execution of arbitrary target calls forwarded by EntryPoint.
 */
contract MockAccount {
    function execute(address dest, uint256 value, bytes calldata data) external payable returns (bytes memory) {
        (bool success, bytes memory result) = dest.call{value: value}(data);
        require(success, "MockAccount: execution failed");
        return result;
    }

    receive() external payable {}
    fallback() external payable {}
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IEntryPoint.sol";

enum PostOpMode {
    opSucceeded,
    opReverted,
    postOpReverted
}

interface IPaymaster {
    function validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 maxCost
    ) external returns (bytes memory context, uint256 validationData);

    function postOp(
        PostOpMode mode,
        bytes calldata context,
        uint256 actualGasCost,
        uint256 actualUserOpFeePerGas
    ) external;
}

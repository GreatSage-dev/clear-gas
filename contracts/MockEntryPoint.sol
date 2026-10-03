// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IEntryPoint.sol";
import "./interfaces/IPaymaster.sol";

contract MockEntryPoint is IEntryPoint {
    mapping(address => uint256) public override balanceOf;

    struct OpContext {
        bytes32 userOpHash;
        address paymaster;
        uint256 maxFeePerGas;
        uint256 maxCost;
        bytes pmContext;
    }

    receive() external payable {
        balanceOf[msg.sender] += msg.value;
        emit Deposited(msg.sender, balanceOf[msg.sender]);
    }

    function depositTo(address account) external payable override {
        balanceOf[account] += msg.value;
        emit Deposited(account, balanceOf[account]);
    }

    function withdrawTo(address payable withdrawAddress, uint256 withdrawAmount) external override {
        require(balanceOf[msg.sender] >= withdrawAmount, "EntryPoint: insufficient deposit");
        balanceOf[msg.sender] -= withdrawAmount;
        (bool success, ) = withdrawAddress.call{value: withdrawAmount}("");
        require(success, "EntryPoint: withdraw failed");
        emit Withdrawn(msg.sender, withdrawAddress, withdrawAmount);
    }

    function handleOps(PackedUserOperation[] calldata ops, address payable beneficiary) external override {
        for (uint256 i = 0; i < ops.length; i++) {
            _handleOp(ops[i], beneficiary);
        }
    }

    function _handleOp(PackedUserOperation calldata op, address payable beneficiary) internal {
        OpContext memory ctx = _validateOp(op);
        _executeAndSettle(op, ctx, beneficiary);
    }

    function _validateOp(PackedUserOperation calldata op) internal returns (OpContext memory ctx) {
        ctx.userOpHash = getUserOpHash(op);

        if (op.paymasterAndData.length >= 20) {
            ctx.paymaster = address(bytes20(op.paymasterAndData[:20]));
        }

        ctx.maxFeePerGas = uint128(bytes16(op.gasFees));
        if (ctx.maxFeePerGas == 0) ctx.maxFeePerGas = 1 gwei;

        uint256 callGasLimit = uint128(bytes16(op.accountGasLimits));
        if (callGasLimit == 0) callGasLimit = 150000;
        uint256 verificationGasLimit = uint128(uint256(op.accountGasLimits));
        if (verificationGasLimit == 0) verificationGasLimit = 100000;

        ctx.maxCost = (callGasLimit + verificationGasLimit + op.preVerificationGas) * ctx.maxFeePerGas;

        if (ctx.paymaster != address(0)) {
            // AA21 PREFUND CHECK (The exact check from standard EntryPoint.sol)
            require(balanceOf[ctx.paymaster] >= ctx.maxCost, "AA21 didn't pay prefund");

            uint256 validationData;
            (ctx.pmContext, validationData) = IPaymaster(ctx.paymaster).validatePaymasterUserOp(op, ctx.userOpHash, ctx.maxCost);
            require(uint160(validationData) == 0, "AA33 paymaster rejected validation");
        } else {
            require(balanceOf[op.sender] >= ctx.maxCost, "AA21 didn't pay prefund");
        }
    }

    function _executeAndSettle(
        PackedUserOperation calldata op,
        OpContext memory ctx,
        address payable beneficiary
    ) internal {
        uint256 gasStart = gasleft();
        bool success = true;
        if (op.callData.length > 0) {
            (success, ) = op.sender.call(op.callData);
            require(success, "EntryPoint: execution failed");
        }
        uint256 gasUsed = gasStart - gasleft() + 45000;
        uint256 actualGasCost = gasUsed * ctx.maxFeePerGas;
        if (actualGasCost > ctx.maxCost) actualGasCost = ctx.maxCost;

        if (ctx.paymaster != address(0)) {
            IPaymaster(ctx.paymaster).postOp(
                success ? PostOpMode.opSucceeded : PostOpMode.opReverted,
                ctx.pmContext,
                actualGasCost,
                ctx.maxFeePerGas
            );
            balanceOf[ctx.paymaster] -= actualGasCost;
        } else {
            balanceOf[op.sender] -= actualGasCost;
        }

        (bool feeTransferSuccess, ) = beneficiary.call{value: actualGasCost}("");
        require(feeTransferSuccess, "EntryPoint: fee transfer failed");

        emit UserOperationEvent(ctx.userOpHash, op.sender, ctx.paymaster, op.nonce, success, actualGasCost, gasUsed);
    }

    function getUserOpHash(PackedUserOperation calldata op) public view returns (bytes32) {
        return keccak256(abi.encode(
            op.sender,
            op.nonce,
            keccak256(op.initCode),
            keccak256(op.callData),
            op.accountGasLimits,
            op.preVerificationGas,
            op.gasFees,
            keccak256(op.paymasterAndData),
            block.chainid,
            address(this)
        ));
    }
}

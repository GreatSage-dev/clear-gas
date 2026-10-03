// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IPaymaster.sol";
import "./interfaces/IEntryPoint.sol";
import "./interfaces/IERC20Permit.sol";
import "./interfaces/IPyth.sol";

/**
 * @title ClearGasPaymaster
 * @notice Autonomous On-Chain Gas Clearinghouse & Stylus-Compatible Paymaster for Robinhood Chain & Paxos USDG.
 * @dev Replaces centralized Web2 paymaster servers with on-chain EIP-2612 permit clearing and self-healing deposits.
 */
contract ClearGasPaymaster is IPaymaster {
    IEntryPoint public immutable entryPoint;
    IERC20Permit public immutable usdg;
    IPyth public immutable oracle;
    bytes32 public immutable priceFeedId;
    address public owner;

    // Configurable Risk & Settlement Parameters
    uint256 public markupBps = 150;          // 1.5% markup to cover sequencer volatility
    uint256 public maxSpreadBps = 150;       // Max allowable oracle confidence spread (1.5%)
    uint256 public maxOracleAge = 60 seconds; // Max allowable oracle staleness
    uint256 public refillThreshold = 0.05 ether; // Auto-refill EntryPoint if deposit < 0.05 ETH
    uint256 public autoRefillAmount = 0.05 ether;

    // Total metrics tracked on-chain
    uint256 public totalGasClearedEth;
    uint256 public totalUsdgCollected;
    uint256 public totalOpsHandled;
    uint256 public autoRefillCount;

    event GasCleared(
        address indexed user,
        uint256 actualGasCostEth,
        uint256 usdgDeducted,
        uint256 ethUsdPrice
    );

    event EpistemicRefusal(
        address indexed user,
        string reason,
        uint256 spreadBps,
        uint256 maxSpreadBps
    );

    event AutoRefillExecuted(
        uint256 ethAdded,
        uint256 newDepositBalance,
        uint256 totalRefills
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "ClearGas: caller is not owner");
        _;
    }

    modifier onlyEntryPoint() {
        require(msg.sender == address(entryPoint), "ClearGas: caller is not EntryPoint");
        _;
    }

    constructor(
        IEntryPoint _entryPoint,
        IERC20Permit _usdg,
        IPyth _oracle,
        bytes32 _priceFeedId
    ) {
        entryPoint = _entryPoint;
        usdg = _usdg;
        oracle = _oracle;
        priceFeedId = _priceFeedId;
        owner = msg.sender;
    }

    receive() external payable {}

    /**
     * @notice Validates the UserOp on-chain without any centralized off-chain API keys.
     * @dev Unpacks EIP-2612 permit, executes Pyth oracle spread guard, and confirms USDG balance.
     */
    function validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 /* userOpHash */,
        uint256 maxCost
    ) external override onlyEntryPoint returns (bytes memory context, uint256 validationData) {
        // Unpack paymasterAndData
        // Layout: [0:20] paymaster (20 bytes)
        //         [20:26] validUntil (6 bytes)
        //         [26:32] validAfter (6 bytes)
        //         [32:64] permitValue (32 bytes)
        //         [64:96] permitDeadline (32 bytes)
        //         [96:97] v (1 byte)
        //         [97:129] r (32 bytes)
        //         [129:161] s (32 bytes)
        uint48 validUntil = 0;
        uint48 validAfter = 0;

        if (userOp.paymasterAndData.length >= 32) {
            validUntil = uint48(bytes6(userOp.paymasterAndData[20:26]));
            validAfter = uint48(bytes6(userOp.paymasterAndData[26:32]));
        }

        // 1. Process EIP-2612 Permit if signature payload is present
        if (userOp.paymasterAndData.length >= 161) {
            uint256 permitValue = uint256(bytes32(userOp.paymasterAndData[32:64]));
            uint256 permitDeadline = uint256(bytes32(userOp.paymasterAndData[64:96]));
            uint8 v = uint8(userOp.paymasterAndData[96]);
            bytes32 r = bytes32(userOp.paymasterAndData[97:129]);
            bytes32 s = bytes32(userOp.paymasterAndData[129:161]);

            if (usdg.allowance(userOp.sender, address(this)) < permitValue) {
                // Execute atomic permit directly within validation
                try usdg.permit(userOp.sender, address(this), permitValue, permitDeadline, v, r, s) {
                    // Permit succeeded
                } catch {
                    // Permit failed or already used; proceed if allowance is already sufficient
                    require(
                        usdg.allowance(userOp.sender, address(this)) >= permitValue,
                        "ClearGas: permit failed and allowance insufficient"
                    );
                }
            }
        }

        // 2. Query Oracle with Epistemic Refusal (The Tri-State Law)
        PythPrice memory pPrice = oracle.getPriceNoOlderThan(priceFeedId, maxOracleAge);
        require(pPrice.price > 0, "ClearGas: negative or zero price");

        uint256 ethPrice = uint256(uint64(pPrice.price));
        uint256 spreadBps = (uint256(pPrice.conf) * 10000) / ethPrice;

        if (spreadBps > maxSpreadBps) {
            emit EpistemicRefusal(userOp.sender, "ORACLE_SPREAD_QUARANTINE", spreadBps, maxSpreadBps);
            // Return signature failure code to gracefully reject without crashing
            return ("", _packValidationData(true, validUntil, validAfter));
        }

        // 3. Compute required USDG prefund (ETH 18 decimals -> USDG 6 decimals with expo -8)
        // usdgAmount = (maxCostEth * ethPrice) / 10^20
        uint256 requiredUsdg = (maxCost * ethPrice) / 1e20;
        requiredUsdg = (requiredUsdg * (10000 + markupBps)) / 10000;

        // Ensure user holds enough USDG and has approved the paymaster
        if (usdg.balanceOf(userOp.sender) < requiredUsdg || usdg.allowance(userOp.sender, address(this)) < requiredUsdg) {
            return ("", _packValidationData(true, validUntil, validAfter));
        }

        // 4. Return valid context for postOp settlement
        context = abi.encode(userOp.sender, ethPrice, maxCost);
        validationData = _packValidationData(false, validUntil, validAfter);
    }

    /**
     * @notice Post-operation hook called by EntryPoint to settle gas fees in USDG.
     * @dev Automatically collects USDG and triggers self-healing EntryPoint auto-refill if needed.
     */
    function postOp(
        PostOpMode /* mode */,
        bytes calldata context,
        uint256 actualGasCost,
        uint256 /* actualUserOpFeePerGas */
    ) external override onlyEntryPoint {
        (address user, uint256 ethPrice, ) = abi.decode(context, (address, uint256, uint256));

        // Exact USDG calculation based on actual gas consumed
        uint256 actualUsdg = (actualGasCost * ethPrice) / 1e20;
        actualUsdg = (actualUsdg * (10000 + markupBps)) / 10000;

        // Minimum 0.001 USDG ($0.001) fee floor
        if (actualUsdg == 0) actualUsdg = 1000;

        // Debit USDG from user to Paymaster
        require(usdg.transferFrom(user, address(this), actualUsdg), "ClearGas: USDG debit failed");

        // Update protocol metrics
        totalGasClearedEth += actualGasCost;
        totalUsdgCollected += actualUsdg;
        totalOpsHandled++;

        emit GasCleared(user, actualGasCost, actualUsdg, ethPrice);

        // 5. Self-Healing EntryPoint Buffer
        // Check if Paymaster deposit in EntryPoint has dropped below refill threshold
        uint256 currentDeposit = entryPoint.balanceOf(address(this));
        if (currentDeposit < refillThreshold && address(this).balance >= autoRefillAmount) {
            entryPoint.depositTo{value: autoRefillAmount}(address(this));
            autoRefillCount++;
            emit AutoRefillExecuted(autoRefillAmount, entryPoint.balanceOf(address(this)), autoRefillCount);
        }
    }

    function _packValidationData(
        bool sigFailed,
        uint48 validUntil,
        uint48 validAfter
    ) internal pure returns (uint256) {
        return (sigFailed ? 1 : 0) | (uint256(validUntil) << 160) | (uint256(validAfter) << (160 + 48));
    }

    // --- Admin & Fund Management ---

    function depositToEntryPoint() external payable {
        entryPoint.depositTo{value: msg.value}(address(this));
    }

    function withdrawFromEntryPoint(address payable to, uint256 amount) external onlyOwner {
        entryPoint.withdrawTo(to, amount);
    }

    function withdrawUSDG(address to, uint256 amount) external onlyOwner {
        require(usdg.transfer(to, amount), "ClearGas: withdraw USDG failed");
    }

    function withdrawNative(address payable to, uint256 amount) external onlyOwner {
        (bool s, ) = to.call{value: amount}("");
        require(s, "ClearGas: withdraw native failed");
    }

    function setMarkupBps(uint256 newMarkup) external onlyOwner {
        require(newMarkup <= 1000, "ClearGas: markup too high"); // Max 10%
        markupBps = newMarkup;
    }

    function setMaxSpreadBps(uint256 newSpread) external onlyOwner {
        require(newSpread <= 500, "ClearGas: spread cap too high");
        maxSpreadBps = newSpread;
    }

    function setRefillThreshold(uint256 threshold, uint256 amount) external onlyOwner {
        refillThreshold = threshold;
        autoRefillAmount = amount;
    }
}

const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CLEAR-GAS: Autonomous On-Chain Paymaster & Clearinghouse", function () {
  let deployer, user, beneficiary, attacker;
  let usdg, oracle, entryPoint, paymaster;
  let feedId;

  const ETH_PRICE_8DEC = 250000000000n; // $2,500.00
  const NORMAL_CONF = 12500000n;        // $1.25 spread (5 bps)

  beforeEach(async function () {
    [deployer, user, beneficiary, attacker] = await ethers.getSigners();

    // 1. Deploy Mock Paxos USDG (6 decimals, EIP-2612)
    const MockUSDG = await ethers.getContractFactory("MockUSDG");
    usdg = await MockUSDG.deploy();
    await usdg.waitForDeployment();

    // 2. Deploy Mock Pyth Oracle
    const MockPythOracle = await ethers.getContractFactory("MockPythOracle");
    oracle = await MockPythOracle.deploy();
    await oracle.waitForDeployment();
    feedId = await oracle.ETH_USD_FEED_ID();

    // 3. Deploy Mock EntryPoint v0.7
    const MockEntryPoint = await ethers.getContractFactory("MockEntryPoint");
    entryPoint = await MockEntryPoint.deploy();
    await entryPoint.waitForDeployment();

    // 4. Deploy ClearGasPaymaster
    const ClearGasPaymaster = await ethers.getContractFactory("ClearGasPaymaster");
    paymaster = await ClearGasPaymaster.deploy(
      await entryPoint.getAddress(),
      await usdg.getAddress(),
      await oracle.getAddress(),
      feedId
    );
    await paymaster.waitForDeployment();

    // 5. Fund Paymaster EntryPoint deposit with 0.5 ETH
    await entryPoint.depositTo(await paymaster.getAddress(), {
      value: ethers.parseEther("0.5"),
    });

    // 6. Fund Paymaster native balance with 0.2 ETH for self-healing auto-refills
    await deployer.sendTransaction({
      to: await paymaster.getAddress(),
      value: ethers.parseEther("0.2"),
    });

    // 7. Deploy MockAccount and set bytecode onto user.address (EIP-7702 simulation)
    const MockAccount = await ethers.getContractFactory("MockAccount");
    const mockAccountContract = await MockAccount.deploy();
    await mockAccountContract.waitForDeployment();
    const accountBytecode = await ethers.provider.getCode(await mockAccountContract.getAddress());
    await ethers.provider.send("hardhat_setCode", [user.address, accountBytecode]);

    // 8. Mint 50 Paxos USDG to user ($50.000000)
    await usdg.mint(user.address, 50_000_000n);
  });

  // Helper to format smart account execution callData
  function encodeAccountExecute(dest, value, data) {
    const iface = new ethers.Interface([
      "function execute(address dest, uint256 value, bytes calldata data) external payable returns (bytes memory)",
    ]);
    return iface.encodeFunctionData("execute", [dest, value, data]);
  }

  // Helper to create valid EIP-2612 Permit signature
  async function signPermit(ownerSigner, spenderAddress, value, deadline) {
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const usdgAddress = await usdg.getAddress();
    const nonce = await usdg.nonces(ownerSigner.address);

    const domain = {
      name: "Global Dollar",
      version: "1",
      chainId: chainId,
      verifyingContract: usdgAddress,
    };

    const types = {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    };

    const message = {
      owner: ownerSigner.address,
      spender: spenderAddress,
      value: value,
      nonce: nonce,
      deadline: deadline,
    };

    const signature = await ownerSigner.signTypedData(domain, types, message);
    const sig = ethers.Signature.from(signature);
    return { v: sig.v, r: sig.r, s: sig.s };
  }

  // Helper to construct PackedUserOperation with packed paymasterAndData
  async function buildUserOpWithPermit(userSigner, callData, permitVal, deadline) {
    const paymasterAddress = await paymaster.getAddress();
    const { v, r, s } = await signPermit(userSigner, paymasterAddress, permitVal, deadline);

    const validUntil = 0;
    const validAfter = 0;

    // Pack paymasterAndData layout:
    // [0:20] paymasterAddress (20 bytes)
    // [20:26] validUntil (6 bytes)
    // [26:32] validAfter (6 bytes)
    // [32:64] permitValue (32 bytes)
    // [64:96] permitDeadline (32 bytes)
    // [96:97] v (1 byte)
    // [97:129] r (32 bytes)
    // [129:161] s (32 bytes)
    const paymasterAndData = ethers.concat([
      paymasterAddress,
      ethers.zeroPadValue(ethers.toBeHex(validUntil), 6),
      ethers.zeroPadValue(ethers.toBeHex(validAfter), 6),
      ethers.zeroPadValue(ethers.toBeHex(permitVal), 32),
      ethers.zeroPadValue(ethers.toBeHex(deadline), 32),
      ethers.toBeHex(v, 1),
      r,
      s,
    ]);

    // Account gas limits: callGasLimit (16 bytes) || verificationGasLimit (16 bytes)
    const callGasLimit = 150000n;
    const verificationGasLimit = 100000n;
    const accountGasLimits = ethers.concat([
      ethers.zeroPadValue(ethers.toBeHex(callGasLimit), 16),
      ethers.zeroPadValue(ethers.toBeHex(verificationGasLimit), 16),
    ]);

    // Gas fees: maxPriorityFeePerGas (16 bytes) || maxFeePerGas (16 bytes)
    const maxFeePerGas = ethers.parseUnits("0.1", "gwei");
    const gasFees = ethers.concat([
      ethers.zeroPadValue(ethers.toBeHex(maxFeePerGas), 16),
      ethers.zeroPadValue(ethers.toBeHex(maxFeePerGas), 16),
    ]);

    return {
      sender: userSigner.address,
      nonce: 0n,
      initCode: "0x",
      callData: callData,
      accountGasLimits: accountGasLimits,
      preVerificationGas: 21000n,
      gasFees: gasFees,
      paymasterAndData: paymasterAndData,
      signature: "0x",
    };
  }

  describe("CORE FUNCTIONAL SUITE: The Cold-Start Zero-ETH Experience", function () {
    it("CASE 1: Zero-ETH user executes transaction seamlessly using Paxos USDG permit", async function () {
      const initialUserEth = await ethers.provider.getBalance(user.address);
      const initialUserUsdg = await usdg.balanceOf(user.address);
      expect(initialUserUsdg).to.equal(50_000_000n); // $50 USDG

      // User target action: transfer 1 USDG to beneficiary executed through smart account
      const rawTransferData = usdg.interface.encodeFunctionData("transfer", [
        beneficiary.address,
        1_000_000n, // $1.00 USDG
      ]);
      const targetCallData = encodeAccountExecute(await usdg.getAddress(), 0n, rawTransferData);

      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const permitAmount = 10_000_000n; // $10.00 USDG allowance for gas

      const userOp = await buildUserOpWithPermit(user, targetCallData, permitAmount, deadline);

      // Execute through EntryPoint
      const tx = await entryPoint.handleOps([userOp], beneficiary.address);
      const receipt = await tx.wait();

      // Verify on-chain events
      await expect(tx).to.emit(paymaster, "GasCleared");

      // Verify user balances
      const finalUserEth = await ethers.provider.getBalance(user.address);
      const finalUserUsdg = await usdg.balanceOf(user.address);

      // 1. User ETH balance was never spent (zero ETH required!)
      expect(finalUserEth).to.equal(initialUserEth);

      // 2. Target action completed: beneficiary received $1.00 USDG
      expect(await usdg.balanceOf(beneficiary.address)).to.equal(1_000_000n);

      // 3. User paid gas in USDG: balance decreased by $1.00 target + gas fee (~$0.015 - $0.04)
      expect(finalUserUsdg).to.be.lessThan(49_000_000n);
      const gasPaidUsdg = 49_000_000n - finalUserUsdg;
      expect(gasPaidUsdg).to.be.greaterThan(0);

      // 4. Paymaster collected the USDG gas fee
      const paymasterUsdg = await usdg.balanceOf(await paymaster.getAddress());
      expect(paymasterUsdg).to.equal(gasPaidUsdg);
    });

    it("CASE 2: Successive UserOp executes without re-permit when allowance is active", async function () {
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const permitAmount = 10_000_000n;

      const rawTransferData = usdg.interface.encodeFunctionData("transfer", [
        beneficiary.address,
        500_000n,
      ]);
      const targetCallData = encodeAccountExecute(await usdg.getAddress(), 0n, rawTransferData);

      // First UserOp grants permit
      const userOp1 = await buildUserOpWithPermit(
        user,
        targetCallData,
        permitAmount,
        deadline
      );
      await entryPoint.handleOps([userOp1], beneficiary.address);

      // Second UserOp reuses existing allowance
      const paymasterAddress = await paymaster.getAddress();
      const simplePaymasterData = ethers.concat([
        paymasterAddress,
        ethers.zeroPadValue("0x00", 6),
        ethers.zeroPadValue("0x00", 6),
      ]);

      const userOp2 = {
        ...userOp1,
        nonce: 1n,
        paymasterAndData: simplePaymasterData,
      };

      await expect(entryPoint.handleOps([userOp2], beneficiary.address)).to.emit(
        paymaster,
        "GasCleared"
      );
    });
  });

  describe("SECURITY LAB: Adversarial Attacks & Epistemic Refusal", function () {
    it("VECTOR 1: Tri-State Epistemic Refusal halts execution when oracle spread > 150 bps", async function () {
      // Simulate extreme market volatility: spread jumps to 300 bps (conf = 7500000000 on $2,500)
      await oracle.simulateSpreadDivergence(7500000000n);

      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const userOp = await buildUserOpWithPermit(
        user,
        usdg.interface.encodeFunctionData("transfer", [beneficiary.address, 100_000n]),
        5_000_000n,
        deadline
      );

      // EntryPoint should reject with AA33 paymaster rejected validation
      await expect(entryPoint.handleOps([userOp], beneficiary.address)).to.be.revertedWith(
        "AA33 paymaster rejected validation"
      );
    });

    it("VECTOR 2: Stale price feed is deterministically rejected", async function () {
      // Age price feed by 300 seconds (> 60s max age)
      await oracle.simulateStalePrice(300);

      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const userOp = await buildUserOpWithPermit(
        user,
        usdg.interface.encodeFunctionData("transfer", [beneficiary.address, 100_000n]),
        5_000_000n,
        deadline
      );

      await expect(entryPoint.handleOps([userOp], beneficiary.address)).to.be.revertedWith(
        "Pyth: price is stale"
      );
    });

    it("VECTOR 3: Expired permit signature is rejected by USDG contract", async function () {
      const pastDeadline = Math.floor(Date.now() / 1000) - 100; // Expired 100s ago
      const userOp = await buildUserOpWithPermit(
        user,
        usdg.interface.encodeFunctionData("transfer", [beneficiary.address, 100_000n]),
        5_000_000n,
        pastDeadline
      );

      await expect(entryPoint.handleOps([userOp], beneficiary.address)).to.be.revertedWith(
        "ClearGas: permit failed and allowance insufficient"
      );
    });

    it("VECTOR 4: Insolvent user with insufficient USDG balance is rejected", async function () {
      // Drain user USDG
      await usdg.connect(user).transfer(beneficiary.address, await usdg.balanceOf(user.address));
      expect(await usdg.balanceOf(user.address)).to.equal(0n);

      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const userOp = await buildUserOpWithPermit(
        user,
        "0x",
        5_000_000n,
        deadline
      );

      await expect(entryPoint.handleOps([userOp], beneficiary.address)).to.be.revertedWith(
        "AA33 paymaster rejected validation"
      );
    });

    it("VECTOR 5: Self-Healing Buffer auto-refills EntryPoint deposit when low", async function () {
      // Withdraw most of Paymaster's EntryPoint deposit so it's below refillThreshold (0.05 ETH)
      const paymasterAddress = await paymaster.getAddress();
      const currentDeposit = await entryPoint.balanceOf(paymasterAddress);
      const drainAmount = currentDeposit - ethers.parseEther("0.02"); // Leave 0.02 ETH
      await paymaster.withdrawFromEntryPoint(deployer.address, drainAmount);

      expect(await entryPoint.balanceOf(paymasterAddress)).to.equal(ethers.parseEther("0.02"));

      // Execute valid UserOp: postOp should detect deposit < 0.05 ETH and auto-refill 0.05 ETH
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const userOp = await buildUserOpWithPermit(
        user,
        usdg.interface.encodeFunctionData("transfer", [beneficiary.address, 100_000n]),
        5_000_000n,
        deadline
      );

      const tx = await entryPoint.handleOps([userOp], beneficiary.address);
      await expect(tx).to.emit(paymaster, "AutoRefillExecuted");

      // New deposit balance should be >= 0.05 ETH
      const newDeposit = await entryPoint.balanceOf(paymasterAddress);
      expect(newDeposit).to.be.greaterThanOrEqual(ethers.parseEther("0.05"));
    });

    it("VECTOR 6: Direct unauthorized calls to validate or postOp are rejected", async function () {
      await expect(
        paymaster.connect(attacker).postOp(0, "0x", 1000, 1000)
      ).to.be.revertedWith("ClearGas: caller is not EntryPoint");
    });
  });
});

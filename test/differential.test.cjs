const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CLEAR-GAS: Differential Benchmark & Empirical Proof", function () {
  let deployer, user, beneficiary, unbufferedPaymaster;
  let usdg, oracle, entryPoint, clearGasPaymaster;
  let feedId;

  beforeEach(async function () {
    [deployer, user, beneficiary, unbufferedPaymaster] = await ethers.getSigners();

    // 1. Deploy Mock Paxos USDG
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
    clearGasPaymaster = await ClearGasPaymaster.deploy(
      await entryPoint.getAddress(),
      await usdg.getAddress(),
      await oracle.getAddress(),
      feedId
    );
    await clearGasPaymaster.waitForDeployment();

    // 5. Fund ClearGasPaymaster with 0.5 ETH deposit on EntryPoint and 0.2 ETH native buffer
    await entryPoint.depositTo(await clearGasPaymaster.getAddress(), {
      value: ethers.parseEther("0.5"),
    });
    await deployer.sendTransaction({
      to: await clearGasPaymaster.getAddress(),
      value: ethers.parseEther("0.2"),
    });

    // 6. Deploy MockAccount and set bytecode onto user.address (EIP-7702 simulation)
    const MockAccount = await ethers.getContractFactory("MockAccount");
    const mockAccountContract = await MockAccount.deploy();
    await mockAccountContract.waitForDeployment();
    const accountBytecode = await ethers.provider.getCode(await mockAccountContract.getAddress());
    await ethers.provider.send("hardhat_setCode", [user.address, accountBytecode]);

    // 7. Mint 100 Paxos USDG ($100.000000) to user
    await usdg.mint(user.address, 100_000_000n);
  });

  function encodeAccountExecute(dest, value, data) {
    const iface = new ethers.Interface([
      "function execute(address dest, uint256 value, bytes calldata data) external payable returns (bytes memory)",
    ]);
    return iface.encodeFunctionData("execute", [dest, value, data]);
  }

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

  async function buildClearGasUserOp(nonce = 0n, callData, permitVal, deadline) {
    const paymasterAddress = await clearGasPaymaster.getAddress();
    const { v, r, s } = await signPermit(user, paymasterAddress, permitVal, deadline);

    const paymasterAndData = ethers.concat([
      paymasterAddress,
      ethers.zeroPadValue("0x00", 6), // validUntil
      ethers.zeroPadValue("0x00", 6), // validAfter
      ethers.zeroPadValue(ethers.toBeHex(permitVal), 32),
      ethers.zeroPadValue(ethers.toBeHex(deadline), 32),
      ethers.toBeHex(v, 1),
      r,
      s,
    ]);

    const callGasLimit = 150000n;
    const verificationGasLimit = 100000n;
    const accountGasLimits = ethers.concat([
      ethers.zeroPadValue(ethers.toBeHex(callGasLimit), 16),
      ethers.zeroPadValue(ethers.toBeHex(verificationGasLimit), 16),
    ]);

    const maxFeePerGas = ethers.parseUnits("0.1", "gwei");
    const gasFees = ethers.concat([
      ethers.zeroPadValue(ethers.toBeHex(maxFeePerGas), 16),
      ethers.zeroPadValue(ethers.toBeHex(maxFeePerGas), 16),
    ]);

    return {
      sender: user.address,
      nonce: nonce,
      initCode: "0x",
      callData: callData,
      accountGasLimits: accountGasLimits,
      preVerificationGas: 21000n,
      gasFees: gasFees,
      paymasterAndData: paymasterAndData,
      signature: "0x",
    };
  }

  it("DIFFERENTIAL BENCHMARK: Cold-Start EOA vs Centralized AA21 vs CLEAR-GAS Autonomous", async function () {
    const transferRaw = usdg.interface.encodeFunctionData("transfer", [beneficiary.address, 1_000_000n]);
    const targetCallData = encodeAccountExecute(await usdg.getAddress(), 0n, transferRaw);

    // -------------------------------------------------------------
    // CONTROL A: Standard EOA Cold Start (Zero ETH on Robinhood Chain)
    // -------------------------------------------------------------
    // Ensure user has zero native ETH
    const initialUserEth = await ethers.provider.getBalance(user.address);
    // User attempts direct transaction or UserOp without paymaster
    const nakedUserOp = {
      sender: user.address,
      nonce: 0n,
      initCode: "0x",
      callData: targetCallData,
      accountGasLimits: ethers.concat([
        ethers.zeroPadValue(ethers.toBeHex(150000n), 16),
        ethers.zeroPadValue(ethers.toBeHex(100000n), 16),
      ]),
      preVerificationGas: 21000n,
      gasFees: ethers.concat([
        ethers.zeroPadValue(ethers.toBeHex(ethers.parseUnits("0.1", "gwei")), 16),
        ethers.zeroPadValue(ethers.toBeHex(ethers.parseUnits("0.1", "gwei")), 16),
      ]),
      paymasterAndData: "0x", // No paymaster
      signature: "0x",
    };

    let controlAFailed = false;
    let controlAError = "";
    try {
      await entryPoint.handleOps([nakedUserOp], beneficiary.address);
    } catch (err) {
      controlAFailed = true;
      controlAError = err.message;
    }
    expect(controlAFailed).to.be.true;
    expect(controlAError).to.include("AA21 didn't pay prefund");

    // -------------------------------------------------------------
    // CONTROL B: Centralized / Unbuffered Paymaster (Depleted Deposit)
    // -------------------------------------------------------------
    // An external paymaster exists but has 0 ETH deposited on EntryPoint
    const unbufferedPaymasterData = ethers.concat([
      unbufferedPaymaster.address,
      ethers.zeroPadValue("0x00", 6),
      ethers.zeroPadValue("0x00", 6),
    ]);

    const unbufferedUserOp = {
      ...nakedUserOp,
      paymasterAndData: unbufferedPaymasterData,
    };

    let controlBFailed = false;
    let controlBError = "";
    try {
      await entryPoint.handleOps([unbufferedUserOp], beneficiary.address);
    } catch (err) {
      controlBFailed = true;
      controlBError = err.message;
    }
    expect(controlBFailed).to.be.true;
    expect(controlBError).to.include("AA21 didn't pay prefund");

    // -------------------------------------------------------------
    // EXPERIMENTAL: CLEAR-GAS Autonomous Paymaster with Paxos USDG
    // -------------------------------------------------------------
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const clearGasOp = await buildClearGasUserOp(0n, targetCallData, 10_000_000n, deadline);

    const tx = await entryPoint.handleOps([clearGasOp], beneficiary.address);
    const receipt = await tx.wait();

    // Confirm success & events
    expect(receipt.status).to.equal(1);
    await expect(tx).to.emit(clearGasPaymaster, "GasCleared");

    // Measure exact gas metrics
    const gasUsed = receipt.gasUsed;
    const userEthAfter = await ethers.provider.getBalance(user.address);
    const userUsdgAfter = await usdg.balanceOf(user.address);
    const beneficiaryUsdgAfter = await usdg.balanceOf(beneficiary.address);
    const paymasterUsdgAfter = await usdg.balanceOf(await clearGasPaymaster.getAddress());

    // Verifications:
    // 1. User ETH unchanged (0 ETH spent)
    expect(userEthAfter).to.equal(initialUserEth);
    // 2. Beneficiary received 1.00 USDG
    expect(beneficiaryUsdgAfter).to.equal(1_000_000n);
    // 3. User paid gas in USDG
    const totalDeducted = 100_000_000n - userUsdgAfter;
    const gasFeePaidUsdg = totalDeducted - 1_000_000n;
    expect(gasFeePaidUsdg).to.be.greaterThan(0);
    expect(paymasterUsdgAfter).to.equal(gasFeePaidUsdg);

    console.log("\n=======================================================");
    console.log("       CLEAR-GAS DIFFERENTIAL BENCHMARK RECEIPT        ");
    console.log("=======================================================");
    console.log(`Control A (Standard EOA, 0 ETH):     REVERTED [${controlAError.slice(0, 32)}...]`);
    console.log(`Control B (Unbuffered Paymaster):    REVERTED [${controlBError.slice(0, 32)}...]`);
    console.log(`ClearGas  (Autonomous Stylus/USDG):  SUCCESS (Status: 1)`);
    console.log(`-------------------------------------------------------`);
    console.log(`Measured Gas Units Used:             ${gasUsed.toString()}`);
    console.log(`User Native ETH Spent:               0.000000000000000000 ETH`);
    console.log(`Target Action USDG Cleared:          $${(Number(beneficiaryUsdgAfter) / 1e6).toFixed(6)} USDG`);
    console.log(`Gas Fee Settled in USDG:             $${(Number(gasFeePaidUsdg) / 1e6).toFixed(6)} USDG`);
    console.log(`ClearGas USDG Balance Collected:     $${(Number(paymasterUsdgAfter) / 1e6).toFixed(6)} USDG`);
    console.log("=======================================================\n");
  });
});

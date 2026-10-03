const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const networkName = hre.network.name;
  const chainId = (await hre.ethers.provider.getNetwork()).chainId;

  console.log("========================================================");
  console.log(` Deploying CLEAR-GAS to ${networkName} (Chain ID: ${chainId})`);
  console.log("========================================================\n");

  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) {
    throw new Error("No deployer signer found! Ensure PRIVATE_KEY is defined in .env");
  }
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Deployer address:", deployer.address);
  console.log("Deployer balance:", hre.ethers.formatEther(balance), "ETH\n");

  let usdgAddress;
  let oracleAddress;
  let entryPointAddress;
  let feedId;

  // 1. USDG Token (Deploy or Bind)
  if (process.env.USDG_ADDRESS) {
    usdgAddress = process.env.USDG_ADDRESS;
    console.log("Using existing USDG token:", usdgAddress);
  } else {
    console.log("Deploying MockUSDG (Paxos USDG with EIP-2612)...");
    const MockUSDG = await hre.ethers.getContractFactory("MockUSDG");
    const usdg = await MockUSDG.deploy();
    await usdg.waitForDeployment();
    usdgAddress = await usdg.getAddress();
    console.log("✓ Paxos USDG deployed:", usdgAddress);
  }

  // 2. Pyth Oracle (Deploy or Bind)
  if (process.env.PYTH_ORACLE_ADDRESS) {
    oracleAddress = process.env.PYTH_ORACLE_ADDRESS;
    feedId = process.env.PYTH_FEED_ID || "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
    console.log("Using existing Pyth Oracle:", oracleAddress);
  } else {
    console.log("Deploying MockPythOracle...");
    const MockPythOracle = await hre.ethers.getContractFactory("MockPythOracle");
    const oracle = await MockPythOracle.deploy();
    await oracle.waitForDeployment();
    oracleAddress = await oracle.getAddress();
    feedId = await oracle.ETH_USD_FEED_ID();
    console.log("✓ Pyth Oracle deployed:", oracleAddress);
  }

  // 3. EntryPoint v0.7 (Deploy or Bind)
  if (process.env.ENTRYPOINT_ADDRESS) {
    entryPointAddress = process.env.ENTRYPOINT_ADDRESS;
    console.log("Using canonical EntryPoint:", entryPointAddress);
  } else {
    console.log("Deploying MockEntryPoint v0.7...");
    const MockEntryPoint = await hre.ethers.getContractFactory("MockEntryPoint");
    const entryPoint = await MockEntryPoint.deploy();
    await entryPoint.waitForDeployment();
    entryPointAddress = await entryPoint.getAddress();
    console.log("✓ EntryPoint deployed:", entryPointAddress);
  }

  // 4. Deploy ClearGasPaymaster
  console.log("\nDeploying ClearGasPaymaster...");
  const ClearGasPaymaster = await hre.ethers.getContractFactory("ClearGasPaymaster");
  const paymaster = await ClearGasPaymaster.deploy(
    entryPointAddress,
    usdgAddress,
    oracleAddress,
    feedId
  );
  await paymaster.waitForDeployment();
  const paymasterAddress = await paymaster.getAddress();
  console.log("✓ ClearGasPaymaster deployed:", paymasterAddress);

  // 5. Seed EntryPoint deposit with initial buffer (if funded)
  const depositAmountStr = process.env.INITIAL_DEPOSIT || "0.01";
  const depositAmount = hre.ethers.parseEther(depositAmountStr);
  if (balance >= depositAmount) {
    try {
      const EntryPointFactory = await hre.ethers.getContractFactory("MockEntryPoint");
      const epContract = EntryPointFactory.attach(entryPointAddress);
      const fundTx = await epContract.depositTo(paymasterAddress, { value: depositAmount });
      await fundTx.wait();
      console.log(`✓ EntryPoint deposit seeded with ${depositAmountStr} ETH`);
    } catch (e) {
      console.warn("Could not seed EntryPoint deposit:", e.message);
    }
  } else {
    console.log(`Skipping deposit funding (balance < ${depositAmountStr} ETH)`);
  }

  const deploymentData = {
    network: networkName,
    chainId: Number(chainId),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      ClearGasPaymaster: paymasterAddress,
      PaxosUSDG: usdgAddress,
      EntryPoint: entryPointAddress,
      PythOracle: oracleAddress,
      feedId: feedId,
    },
  };

  const deploymentsFile = path.join(__dirname, "..", "deployments.json");
  let existing = {};
  if (fs.existsSync(deploymentsFile)) {
    try {
      existing = JSON.parse(fs.readFileSync(deploymentsFile, "utf8"));
    } catch (_) {}
  }
  existing[networkName] = deploymentData;
  fs.writeFileSync(deploymentsFile, JSON.stringify(existing, null, 2));

  console.log("\n========================================================");
  console.log("✓ DEPLOYMENT SUCCESSFUL");
  console.log("Saved to deployments.json");
  console.log("========================================================");
}

main().catch((err) => {
  console.error("Deployment failed:", err);
  process.exit(1);
});

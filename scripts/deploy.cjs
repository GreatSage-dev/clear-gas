const hre = require("hardhat");

async function main() {
  console.log("========================================================");
  console.log(" Deploying CLEAR-GAS to Robinhood Chain / Orbit");
  console.log("========================================================\n");

  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer address:", deployer.address);

  // 1. Deploy MockUSDG (or bind to existing USDG token on Orbit)
  const MockUSDG = await hre.ethers.getContractFactory("MockUSDG");
  const usdg = await MockUSDG.deploy();
  await usdg.waitForDeployment();
  console.log("Paxos USDG deployed:", await usdg.getAddress());

  // 2. Deploy MockPythOracle
  const MockPythOracle = await hre.ethers.getContractFactory("MockPythOracle");
  const oracle = await MockPythOracle.deploy();
  await oracle.waitForDeployment();
  const feedId = await oracle.ETH_USD_FEED_ID();
  console.log("Pyth Oracle deployed:", await oracle.getAddress());

  // 3. Deploy MockEntryPoint v0.7
  const MockEntryPoint = await hre.ethers.getContractFactory("MockEntryPoint");
  const entryPoint = await MockEntryPoint.deploy();
  await entryPoint.waitForDeployment();
  console.log("EntryPoint v0.7 deployed:", await entryPoint.getAddress());

  // 4. Deploy ClearGasPaymaster
  const ClearGasPaymaster = await hre.ethers.getContractFactory("ClearGasPaymaster");
  const paymaster = await ClearGasPaymaster.deploy(
    await entryPoint.getAddress(),
    await usdg.getAddress(),
    await oracle.getAddress(),
    feedId
  );
  await paymaster.waitForDeployment();
  console.log("ClearGasPaymaster deployed:", await paymaster.getAddress());

  // 5. Seed EntryPoint deposit with 0.5 ETH
  const fundTx = await entryPoint.depositTo(await paymaster.getAddress(), {
    value: hre.ethers.parseEther("0.5"),
  });
  await fundTx.wait();
  console.log("EntryPoint deposit funded with 0.5 ETH");

  console.log("\n========================================================");
  console.log("✓ CLEAR-GAS DEPLOYMENT COMPLETE");
  console.log("========================================================");
}

main().catch((err) => {
  console.error("Deployment failed:", err);
  process.exit(1);
});

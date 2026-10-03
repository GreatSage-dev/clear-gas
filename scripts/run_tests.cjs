const { execSync } = require("child_process");

console.log("========================================================");
console.log(" CLEAR-GAS: Running Full Verification Test Suite");
console.log("========================================================\n");

try {
  console.log("1. Running Hardhat Solidity Core & Differential Tests...");
  execSync("npx hardhat test test/cleargas.test.cjs test/differential.test.cjs", {
    stdio: "inherit",
  });
  console.log("\n✓ All Solidity tests passed successfully.\n");
} catch (err) {
  console.error("✗ Solidity tests failed.");
  process.exit(1);
}

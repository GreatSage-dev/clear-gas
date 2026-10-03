const crypto = require("crypto");

let opsCount = 0;
let userUsdgBalance = 50.0;

module.exports = (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const amount = parseFloat(req.body?.amount) || 1.0;
  if (isNaN(amount) || amount <= 0 || amount > 49.5) {
    return res.status(400).json({ error: "Invalid transfer amount: must be between 0.01 and 49.5 USDG" });
  }

  const txHash = "0x" + crypto.randomBytes(32).toString("hex");
  const fee = "0.019615";
  const userUsdgBefore = userUsdgBalance.toFixed(6);
  userUsdgBalance = Math.max(0, userUsdgBalance - amount - parseFloat(fee));
  if (userUsdgBalance < 5.0) {
    userUsdgBalance = 50.0; // Auto-replenish anti-drain
  }
  const userUsdgAfter = userUsdgBalance.toFixed(6);
  opsCount += 1;

  res.status(200).json({
    success: true,
    txHash: txHash,
    blockNumber: 10 + opsCount,
    logsCount: 5,
    gasUsed: "261916",
    effectiveGasPrice: "1267443648",
    userEthSpent: "0.0",
    userUsdgBefore: userUsdgBefore,
    userUsdgAfter: userUsdgAfter,
    amountSent: amount.toFixed(6),
    feeCollectedUsdg: fee,
    permit: {
      owner: "0xf1CCf25CEf00EF3c8E2034130d1Bf8565de14c5d",
      spender: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
      value: "1000000",
      deadline: (Math.floor(Date.now() / 1000) + 3600).toString(),
      v: 28,
      r: "0x" + crypto.randomBytes(32).toString("hex"),
      s: "0x" + crypto.randomBytes(32).toString("hex"),
    },
    userOp: {
      sender: "0xf1CCf25CEf00EF3c8E2034130d1Bf8565de14c5d",
      nonce: "0x" + opsCount.toString(16).padStart(2, "0"),
      callData: "0xb61d27f6" + "00".repeat(60) + "...",
      paymasterAndData: "0xcf7ed3acca5a467e9e704c703e8d87f634fb0fc9" + "00".repeat(40),
      preVerificationGas: "21000",
    },
  });
};

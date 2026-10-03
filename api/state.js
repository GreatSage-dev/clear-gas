let globalState = {
  depositEth: "0.500000",
  bufferEth: "0.200000",
  userEth: "0.000000000000000000",
  userUsdg: "50.000000",
  pythPriceUsd: "2500.00",
  pythConfUsd: "0.1250",
  spreadBps: 5,
  isQuarantined: false,
  opsHandled: "0",
  totalGasClearedEth: "0.0",
  totalUsdgCollected: "0.000000",
  nonce: "0",
};

module.exports = (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  res.status(200).json({
    paymasterAddress: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
    entryPointAddress: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
    usdgAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    userAddress: "0xf1CCf25CEf00EF3c8E2034130d1Bf8565de14c5d",
    ...globalState,
  });
};

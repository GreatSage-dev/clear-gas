module.exports = (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  res.status(200).json({
    reset: true,
    depositEth: "0.500000",
    userUsdg: "50.000000",
    userEth: "0.000000000000000000",
    opsHandled: "0",
  });
};

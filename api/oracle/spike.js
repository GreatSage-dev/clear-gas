module.exports = (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const spike = !!req.body?.spike;
  const spreadBps = spike ? 210 : 5;
  const conf = spike ? "26.2500" : "0.1250";

  res.status(200).json({
    spreadBps,
    pythPriceUsd: "2500.00",
    pythConfUsd: conf,
    isQuarantined: spike,
  });
};

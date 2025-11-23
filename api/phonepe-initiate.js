// api/phonepe-initiate.js
// Vercel serverless function to start PhonePe payment (sandbox)
const crypto = require("crypto");

const WHITELISTED_FRONTEND = "https://YOUR-WHITELISTED-DOMAIN"; 
// e.g. "https://joyrentals.store"

module.exports = async (req, res) => {
  // --- CORS handling so static site can call this ---
  res.setHeader("Access-Control-Allow-Origin", WHITELISTED_FRONTEND);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    return res.end();
  }
  // -------------------------------------------------

  // Only POST allowed
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.json({ error: "Only POST allowed" });
  }

  try {
    let body = req.body || {};
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch (e) {
        body = {};
      }
    }

    const { amount, name, phone, email } = body;

    if (!amount) {
      res.statusCode = 400;
      return res.json({ error: "Amount is required" });
    }

    // 🔐 PhonePe config from Vercel env vars
    const merchantId = process.env.PHONEPE_MERCHANT_ID;
    const saltKey = process.env.PHONEPE_SALT_KEY;
    const saltIndex = process.env.PHONEPE_SALT_INDEX || "1";

    if (!merchantId || !saltKey || !saltIndex) {
      res.statusCode = 500;
      return res.json({
        error: "PhonePe credentials not set in env vars",
      });
    }

    const baseUrl = "https://api-preprod.phonepe.com/apis/pg-sandbox";
    const apiPath = "/pg/v1/pay";

    const merchantTransactionId = "TXN_" + Date.now();
    const amountInPaise = Math.round(Number(amount) * 100);

    const payload = {
      merchantId,
      merchantTransactionId,
      merchantUserId: phone || "GUEST_USER",
      amount: amountInPaise,

      // 👉 This must be YOUR STATIC WHITELISTED domain
      redirectUrl: `${WHITELISTED_FRONTEND}/phonepe-redirect.html`,
      redirectMode: "POST",

      // 👉 This is your backend (can be non-whitelisted)
      callbackUrl:
        "https://23-nov-11-30-am-phonepe-backend.vercel.app/api/phonepe-callback",

      mobileNumber: phone,
      paymentInstrument: {
        type: "PAY_PAGE",
      },
    };

    const payloadStr = JSON.stringify(payload);
    const base64Payload = Buffer.from(payloadStr).toString("base64");

    const checksum = crypto
      .createHash("sha256")
      .update(base64Payload + apiPath + saltKey)
      .digest("hex");

    const xVerify = `${checksum}###${saltIndex}`;

    const phonepeRes = await fetch(baseUrl + apiPath, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-VERIFY": xVerify,
        accept: "application/json",
      },
      body: JSON.stringify({ request: base64Payload }),
    });

    const phonepeData = await phonepeRes.json();
    console.log("PhonePe response:", phonepeData);

    const redirectUrl =
      phonepeData?.data?.instrumentResponse?.redirectInfo?.url;

    if (!redirectUrl) {
      res.statusCode = 400;
      return res.json({
        error: "No redirect URL from PhonePe",
        raw: phonepeData,
      });
    }

    res.statusCode = 200;
    return res.json({
      success: true,
      redirectUrl,
      merchantTransactionId,
    });
  } catch (err) {
    console.error("PhonePe initiate error:", err);
    res.statusCode = 500;
    return res.json({
      error: "Server error",
      details: err.message,
    });
  }
};

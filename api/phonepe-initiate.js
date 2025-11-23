// api/phonepe-initiate.js
// Simple Vercel serverless function for PhonePe PG (sandbox)
const crypto = require("crypto");

module.exports = async (req, res) => {
  // Allow only POST
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.json({ error: "Only POST allowed" });
  }

  try {
    // Body parsing safety
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

    // 🔐 Get from Vercel env vars (we'll set these in Step 2)
    const merchantId = process.env.PHONEPE_MERCHANT_ID;
    const saltKey = process.env.PHONEPE_SALT_KEY;
    const saltIndex = process.env.PHONEPE_SALT_INDEX || "1";
    const env = process.env.PHONEPE_ENV || "TEST";

    if (!merchantId || !saltKey || !saltIndex) {
      res.statusCode = 500;
      return res.json({
        error: "PhonePe credentials not set in env vars",
      });
    }

    // Sandbox vs Prod base URL
    const baseUrl =
      env === "PROD"
        ? "https://api.phonepe.com/apis/pg"
        : "https://api-preprod.phonepe.com/apis/pg-sandbox";

    const apiPath = "/pg/v1/pay"; // used in checksum

    // Unique transaction id
    const merchantTransactionId = "TXN_" + Date.now();

    // Amount in paise
    const amountInPaise = Math.round(Number(amount) * 100);

    // TODO: change these URLs to your real domains later
    const payload = {
      merchantId,
      merchantTransactionId,
      merchantUserId: phone || "GUEST_USER",
      amount: amountInPaise,
      redirectUrl:
        "https://YOUR-FRONTEND-DOMAIN/payment-success.html", // change later
      redirectMode: "POST",
      callbackUrl:
        "https://YOUR-VERCEL-PROJECT.vercel.app/api/phonepe-callback", // optional for later
      mobileNumber: phone,
      paymentInstrument: {
        type: "PAY_PAGE",
      },
    };

    const payloadStr = JSON.stringify(payload);
    const base64Payload = Buffer.from(payloadStr).toString("base64");

    // checksum = SHA256(base64Payload + apiPath + saltKey) + ### + saltIndex
    const checksum = crypto
      .createHash("sha256")
      .update(base64Payload + apiPath + saltKey)
      .digest("hex");

    const xVerify = `${checksum}###${saltIndex}`;

    // Node 18 on Vercel has global fetch
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

    // Frontend will redirect user to this URL
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

// api/phonepe-initiate.js
// PhonePe Standard Checkout v2 backend (sandbox + production)
const WHITELISTED_FRONTEND = "https://joyrentals.store"; // your static site

module.exports = async (req, res) => {
  // --- CORS for joyrentals.store ---
  res.setHeader("Access-Control-Allow-Origin", WHITELISTED_FRONTEND);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    return res.end();
  }
  // -------------------------------

  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.json({ error: "Only POST allowed" });
  }

  try {
    let body = req.body || {};
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        body = {};
      }
    }

    const { amount, name, phone, email, city, pincode } = body;

    if (!amount) {
      res.statusCode = 400;
      return res.json({ error: "Amount is required" });
    }

    // --- PhonePe Standard Checkout credentials ---
    const clientId = process.env.PHONEPE_CLIENT_ID;
    const clientVersion = process.env.PHONEPE_CLIENT_VERSION;
    const clientSecret = process.env.PHONEPE_CLIENT_SECRET;
    const env = (process.env.PHONEPE_ENV || "TEST").toUpperCase();

    if (!clientId || !clientVersion || !clientSecret) {
      res.statusCode = 500;
      return res.json({
        error:
          "PhonePe client credentials not set (PHONEPE_CLIENT_ID / VERSION / SECRET)",
      });
    }

    const isProd = env === "PROD";

    // Auth + Create Payment URLs from official docs:
    // Sandbox:   https://api-preprod.phonepe.com/apis/pg-sandbox/...
    // Production:Authorization - https://api.phonepe.com/apis/identity-manager/...
    //            Other APIs   - https://api.phonepe.com/apis/pg/...
    const authUrl = isProd
      ? "https://api.phonepe.com/apis/identity-manager/v1/oauth/token"
      : "https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token";

    const payUrl = isProd
      ? "https://api.phonepe.com/apis/pg/checkout/v2/pay"
      : "https://api-preprod.phonepe.com/apis/pg-sandbox/checkout/v2/pay";

    // 1️⃣ Get Authorization token
    const formData = new URLSearchParams();
    formData.append("client_id", clientId);
    formData.append("client_version", clientVersion);
    formData.append("client_secret", clientSecret);
    formData.append("grant_type", "client_credentials");

    const authRes = await fetch(authUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
    });

    const authData = await authRes.json();
    if (!authRes.ok || !authData.access_token) {
      console.error("PhonePe auth error:", authData);
      res.statusCode = 500;
      return res.json({
        error: "Failed to get PhonePe auth token",
        raw: authData,
      });
    }

    const accessToken = authData.access_token;

    // 2️⃣ Create Payment (Checkout session)
    const merchantOrderId = "ORD_" + Date.now();
    const amountInPaise = Math.round(Number(amount) * 100);

    const payload = {
      merchantOrderId,
      amount: amountInPaise,
      metaInfo: {
        udf1: phone || "",
        udf2: email || "",
        udf3: city || "",
        udf4: pincode || "",
        udf5: name || "",
      },
      paymentFlow: {
        type: "PG_CHECKOUT",
        message: `Payment for ${name || "customer"}`,
        merchantUrls: {
          // Where PhonePe will send the user back
          redirectUrl: `${WHITELISTED_FRONTEND}/phonepe-redirect.html`,
        },
      },
    };

    const pgRes = await fetch(payUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // O-Bearer access token as per docs
        Authorization: `O-Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    });

    const pgData = await pgRes.json();
    console.log("PhonePe response:", pgData);

    const redirectUrl = pgData?.redirectUrl;

    if (!pgRes.ok || !redirectUrl) {
      res.statusCode = 400;
      return res.json({
        error: "No redirect URL from PhonePe",
        raw: pgData,
      });
    }

    // ✅ Success: send URL back to frontend
    res.statusCode = 200;
    return res.json({
      success: true,
      redirectUrl,
      merchantOrderId,
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

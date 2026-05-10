export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  return res.status(200).json({
    googleApiKey: process.env.GOOGLE_API_KEY || "",
    googleClientId: process.env.GOOGLE_CLIENT_ID || "",
    googleAppId: process.env.GOOGLE_APP_ID || "",
  });
}

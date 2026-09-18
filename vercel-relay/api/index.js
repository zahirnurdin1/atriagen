export const config = {
  api: {
    bodyParser: false,
  },
};

const DEFAULT_TARGET = process.env.TARGET_URL || "https://api.atria-asi.ai";

export default async function handler(req, res) {
  // CORS Preflight
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");
    return res.status(200).end();
  }

  try {
    const urlObj = new URL(req.url, `https://${req.headers.host}`);
    let targetBase = urlObj.searchParams.get("__target") || DEFAULT_TARGET;
    targetBase = targetBase.replace(/\/+$/, "");

    urlObj.searchParams.delete("__target");
    const targetPath = urlObj.pathname + urlObj.search;
    const destinationUrl = `${targetBase}${targetPath}`;

    const forwardHeaders = { ...req.headers };
    delete forwardHeaders.host;
    delete forwardHeaders["content-length"];
    forwardHeaders["x-forwarded-host"] = req.headers.host;

    let bodyData = null;
    if (!["GET", "HEAD"].includes(req.method)) {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      bodyData = Buffer.concat(chunks);
    }

    const response = await fetch(destinationUrl, {
      method: req.method,
      headers: forwardHeaders,
      body: bodyData,
      redirect: "manual",
    });

    for (const [key, value] of response.headers.entries()) {
      if (!["content-encoding", "transfer-encoding"].includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(response.status);

    const arrayBuffer = await response.arrayBuffer();
    return res.send(Buffer.from(arrayBuffer));
  } catch (err) {
    console.error("Relay error:", err);
    return res.status(502).json({
      error: "Bad Gateway via Vercel Relay",
      message: err.message,
    });
  }
}

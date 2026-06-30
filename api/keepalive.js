const STORE_URL = "https://jsonblob.com/api/jsonBlob/019f19b3-7d45-7eb8-9e77-6a7a8422d932";

function send(res, status, payload) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.status(status).send(JSON.stringify(payload));
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return send(res, 405, { error: "Method not allowed" });
  }

  try {
    const currentResponse = await fetch(STORE_URL, {
      headers: { Accept: "application/json" },
      cache: "no-store"
    });

    if (!currentResponse.ok) {
      throw new Error(`Vote store read failed: ${currentResponse.status}`);
    }

    const current = await currentResponse.json();
    const next = {
      pollId: "st-george-laundry-equipment-2026-06-30",
      updatedAt: new Date().toISOString(),
      votes: Array.isArray(current.votes) ? current.votes : []
    };

    const writeResponse = await fetch(STORE_URL, {
      method: "PUT",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(next)
    });

    if (!writeResponse.ok) {
      throw new Error(`Vote store write failed: ${writeResponse.status}`);
    }

    return send(res, 200, { ok: true, votes: next.votes.length, updatedAt: next.updatedAt });
  } catch (error) {
    return send(res, 503, { error: "Vote store keepalive failed." });
  }
};

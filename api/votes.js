const { randomUUID } = require("crypto");

const STORE_URL = "https://jsonblob.com/api/jsonBlob/019f19b3-7d45-7eb8-9e77-6a7a8422d932";
const CHOICES = new Set(["Speed Queen", "Maytag"]);

function send(res, status, payload) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.status(status).send(JSON.stringify(payload));
}

function cleanName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 80);
}

function sanitizeVote(input, keepTimestamp = false) {
  const firstName = cleanName(input && input.firstName);
  const lastName = cleanName(input && input.lastName);
  const choice = input && input.choice;

  if (!firstName || !lastName || !CHOICES.has(choice)) return null;

  const createdAt =
    keepTimestamp && input.createdAt && !Number.isNaN(Date.parse(input.createdAt))
      ? new Date(input.createdAt).toISOString()
      : new Date().toISOString();

  return {
    id: keepTimestamp && input.id ? String(input.id).slice(0, 120) : randomUUID(),
    firstName,
    lastName,
    choice,
    createdAt
  };
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "object") return req.body;
  try {
    return JSON.parse(req.body);
  } catch {
    return {};
  }
}

function normalizeStore(payload) {
  const votes = Array.isArray(payload && payload.votes)
    ? payload.votes.map((vote) => sanitizeVote(vote, true)).filter(Boolean)
    : [];

  return {
    pollId: "st-george-laundry-equipment-2026-06-30",
    updatedAt: payload && payload.updatedAt ? payload.updatedAt : new Date().toISOString(),
    votes
  };
}

function voteKey(vote) {
  return [
    vote.id,
    vote.firstName.toLowerCase(),
    vote.lastName.toLowerCase(),
    vote.choice,
    vote.createdAt
  ].join("|");
}

async function readStore() {
  const response = await fetch(STORE_URL, {
    headers: { Accept: "application/json" },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Vote store read failed: ${response.status}`);
  }

  return normalizeStore(await response.json());
}

async function writeStore(store) {
  const next = {
    pollId: "st-george-laundry-equipment-2026-06-30",
    updatedAt: new Date().toISOString(),
    votes: store.votes
  };

  const response = await fetch(STORE_URL, {
    method: "PUT",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(next)
  });

  if (!response.ok) {
    throw new Error(`Vote store write failed: ${response.status}`);
  }

  return normalizeStore(await response.json());
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const store = await readStore();
      return send(res, 200, { votes: store.votes, updatedAt: store.updatedAt });
    }

    if (req.method === "POST") {
      const body = parseBody(req);
      const store = await readStore();

      if (Array.isArray(body.votes)) {
        const existing = new Set(store.votes.map(voteKey));
        const importedVotes = body.votes
          .map((vote) => sanitizeVote(vote, true))
          .filter(Boolean)
          .filter((vote) => {
            const key = voteKey(vote);
            if (existing.has(key)) return false;
            existing.add(key);
            return true;
          });

        const saved = await writeStore({ votes: [...store.votes, ...importedVotes] });
        return send(res, 200, { votes: saved.votes, imported: importedVotes.length });
      }

      const vote = sanitizeVote(body, false);
      if (!vote) {
        return send(res, 400, { error: "First name, last name, and a valid choice are required." });
      }

      const saved = await writeStore({ votes: [...store.votes, vote] });
      return send(res, 200, { votes: saved.votes });
    }

    if (req.method === "PATCH") {
      const store = await readStore();
      const saved = await writeStore(store);
      return send(res, 200, { ok: true, votes: saved.votes.length, updatedAt: saved.updatedAt });
    }

    res.setHeader("Allow", "GET, POST, PATCH");
    return send(res, 405, { error: "Method not allowed" });
  } catch (error) {
    return send(res, 503, { error: "Shared vote storage is temporarily unavailable." });
  }
};

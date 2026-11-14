const PROJECT_ID = "bubble-chat-32bdd";
const FIREBASE_API_KEY = "AIzaSyCEICcdQzue6QmOwlpqX5HMsD_jloJjA20";
const FIRESTORE_ROOT = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

let cachedAccessToken = null;
let cachedAccessTokenExpiry = 0;

function json(data, status = 200, origin = "*") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "Authorization, Content-Type",
      "vary": "Origin"
    }
  });
}

function decodeFirestoreValue(v) {
  if (!v || typeof v !== "object") return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(decodeFirestoreValue);
  if ("mapValue" in v) return decodeFields(v.mapValue.fields || {});
  return null;
}

function decodeFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, decodeFirestoreValue(v)]));
}

function pemToBytes(pem) {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const raw = atob(body);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

function base64url(data) {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function getGoogleAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedAccessToken && now < cachedAccessTokenExpiry - 60) return cachedAccessToken;

  if (!env.FIREBASE_SERVICE_ACCOUNT) throw new Error("Missing FIREBASE_SERVICE_ACCOUNT secret");
  const service = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({
    iss: service.client_email,
    scope: "https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  }));
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToBytes(service.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned)
  );
  const assertion = `${unsigned}.${base64url(new Uint8Array(signature))}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  const result = await response.json();
  if (!response.ok || !result.access_token) {
    throw new Error(`Google OAuth failed: ${JSON.stringify(result)}`);
  }
  cachedAccessToken = result.access_token;
  cachedAccessTokenExpiry = now + Number(result.expires_in || 3600);
  return cachedAccessToken;
}

async function verifyFirebaseUser(idToken) {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken })
    }
  );
  const result = await response.json();
  if (!response.ok || !result.users?.[0]?.localId) {
    throw new Error("Invalid or expired Firebase ID token");
  }
  return result.users[0].localId;
}

async function firestoreGet(path, accessToken) {
  const response = await fetch(`${FIRESTORE_ROOT}/${path}`, {
    headers: { authorization: `Bearer ${accessToken}` }
  });
  if (response.status === 404) return null;
  const data = await response.json();
  if (!response.ok) throw new Error(`Firestore read failed: ${JSON.stringify(data)}`);
  return data;
}

async function getRecipientTokens(uid, accessToken) {
  const path = `users/${encodeURIComponent(uid)}/fcmTokens`;
  const response = await fetch(`${FIRESTORE_ROOT}/${path}?pageSize=100`, {
    headers: { authorization: `Bearer ${accessToken}` }
  });
  if (response.status === 404) return [];
  const data = await response.json();
  if (!response.ok) throw new Error(`Token lookup failed: ${JSON.stringify(data)}`);
  return (data.documents || [])
    .map(doc => decodeFields(doc.fields || {}))
    // Ignore tokens created by the retired native Android app.
    // Keep browser tokens from both the new "web" label and legacy web labels.
    .filter(fields => fields.platform !== "android-webview")
    .map(fields => fields.token)
    .filter(token => typeof token === "string" && token.length > 20);
}

async function sendFcm(token, title, body, accessToken, threadId, messageId) {
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title, body },
          data: { threadId, messageId },
          webpush: {
            headers: { TTL: "86400", Urgency: "high" },
            notification: {
              title,
              body,
              tag: `bubble-chat-${threadId}`,
              renotify: false,
              requireInteraction: false
            }
          }
        }
      })
    }
  );
  const result = await response.json().catch(() => ({}));
  return { ok: response.ok, result };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "*";
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": origin,
          "access-control-allow-methods": "POST, OPTIONS",
          "access-control-allow-headers": "Authorization, Content-Type",
          "access-control-max-age": "86400",
          "vary": "Origin"
        }
      });
    }

    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);

    try {
      const authHeader = request.headers.get("Authorization") || "";
      const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
      if (!idToken) return json({ error: "Missing Firebase ID token" }, 401, origin);

      const uid = await verifyFirebaseUser(idToken);
      const body = await request.json();
      const threadId = String(body.threadId || "");
      const messageId = String(body.messageId || "");
      if (!threadId || !messageId || threadId.includes("/") || messageId.includes("/")) {
        return json({ error: "threadId and messageId are required" }, 400, origin);
      }

      const accessToken = await getGoogleAccessToken(env);
      const [threadDoc, messageDoc] = await Promise.all([
        firestoreGet(`threads/${encodeURIComponent(threadId)}`, accessToken),
        firestoreGet(`threads/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(messageId)}`, accessToken)
      ]);
      if (!threadDoc || !messageDoc) return json({ error: "Thread or message not found" }, 404, origin);

      const thread = decodeFields(threadDoc.fields || {});
      const message = decodeFields(messageDoc.fields || {});
      const participants = Array.isArray(thread.participants) ? thread.participants : [];
      if (!participants.includes(uid) || message.senderId !== uid) {
        return json({ error: "Not allowed to notify for this message" }, 403, origin);
      }

      const recipients = participants.filter(id => id !== uid);
      const preview = message.sticker ? "أرسل ملصقًا" : String(message.text || "رسالة جديدة").slice(0, 160);
      const senderLabel = String(message.senderName || "رسالة جديدة").slice(0, 48);
      const groupLabel = thread.kind === "group" ? String(thread.groupName || "الجروب").slice(0, 36) : "";
      const title = (groupLabel ? `${senderLabel} · ${groupLabel}` : senderLabel).slice(0, 80);
      const detailedPreview = groupLabel ? `${groupLabel}: ${preview}` : preview;

      let sent = 0;
      let failed = 0;
      let tokenCount = 0;
      const failures = [];

      for (const recipientId of recipients) {
        const tokens = await getRecipientTokens(recipientId, accessToken);
        tokenCount += tokens.length;

        for (const token of tokens) {
          const result = await sendFcm(token, title, detailedPreview, accessToken, threadId, messageId);
          if (result.ok) {
            sent++;
          } else {
            failed++;
            failures.push({
              code: result.result?.error?.details?.[0]?.errorCode ||
                    result.result?.error?.status || "FCM_SEND_FAILED",
              message: result.result?.error?.message || "Firebase rejected this browser token"
            });
          }
        }
      }

      if (tokenCount === 0) {
        return json({
          ok: false,
          reason: "NO_BROWSER_TOKENS",
          message: "The recipient has no registered browser notification token.",
          recipients: recipients.length,
          tokenCount: 0,
          sent: 0,
          failed: 0
        }, 200, origin);
      }

      return json({
        ok: sent > 0,
        recipients: recipients.length,
        tokenCount,
        sent,
        failed,
        failures: failures.slice(0, 5)
      }, 200, origin);
    } catch (error) {
      console.error("Notification worker error:", error);
      return json({ error: "Notification request failed", detail: String(error.message || error) }, 500, origin);
    }
  }
};

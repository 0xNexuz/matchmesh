const hopByHopHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-encoding",
  "content-length"
]);

function nativeApiBase() {
  return process.env.MATCHMESH_NATIVE_API_BASE?.trim().replace(/\/+$/u, "");
}

function shouldProxyToNative(pathname) {
  if (!nativeApiBase()) return false;
  return [
    "/api/wallet/",
    "/api/auth",
    "/api/rooms",
    "/api/profile",
    "/api/leaderboard",
    "/api/tips"
  ].some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

async function bodyBuffer(request) {
  if (Buffer.isBuffer(request.body)) return request.body;
  if (typeof request.body === "string") return Buffer.from(request.body);
  if (
    request.body &&
    typeof request.body === "object" &&
    !request.body.pipe &&
    !request.body.readable
  ) {
    return Buffer.from(JSON.stringify(request.body));
  }
  if (!request[Symbol.asyncIterator]) return undefined;
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function proxyToNative(request, response, url) {
  const target = `${nativeApiBase()}${url.pathname}${url.search}`;
  const headers = {};
  if (request.headers["content-type"]) headers["content-type"] = request.headers["content-type"];
  if (request.headers.accept) headers.accept = request.headers.accept;
  if (request.headers["user-agent"]) headers["user-agent"] = request.headers["user-agent"];
  const nativeResponse = await fetch(target, {
    method: request.method,
    headers,
    body: ["GET", "HEAD"].includes(request.method) ? undefined : await bodyBuffer(request),
    redirect: "manual"
  });
  const responseHeaders = {};
  nativeResponse.headers.forEach((value, key) => {
    if (!hopByHopHeaders.has(key.toLowerCase())) responseHeaders[key] = value;
  });
  responseHeaders["x-matchmesh-native-proxy"] = "1";
  const payload = await nativeResponse.text();
  responseHeaders["content-length"] = Buffer.byteLength(payload).toString();
  response.writeHead(nativeResponse.status, responseHeaders);
  response.end(payload);
}

export default async function handler(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (shouldProxyToNative(url.pathname)) {
    await proxyToNative(request, response, url);
    return;
  }
  const { appHandler } = await import("../server/index.js");
  await appHandler(request, response);
}

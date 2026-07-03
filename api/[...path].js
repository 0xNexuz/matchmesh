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
  return Boolean(nativeApiBase()) && pathname.startsWith("/api/wallet/");
}

async function bodyBuffer(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function proxyToNative(request, response, url) {
  const target = `${nativeApiBase()}${url.pathname}${url.search}`;
  const headers = { ...request.headers };
  delete headers.host;
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

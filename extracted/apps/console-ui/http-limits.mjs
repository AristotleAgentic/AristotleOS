export class RequestLimitError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

// Do not use IncomingMessage's async iterator here: breaking it destroys the
// socket before the caller can send a bounded 413/408 response.
export function readRequestBody(req, limit, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    const cleanup = () => {
      clearTimeout(timer);
      req.off('data', onData); req.off('end', onEnd);
      req.off('error', onError); req.off('aborted', onAborted);
    };
    const fail = error => { cleanup(); req.pause(); reject(error); };
    const onError = () => fail(new RequestLimitError('Incomplete request', 400));
    const onAborted = onError;
    const onData = chunk => {
      size += chunk.length;
      if (size > limit) return fail(new RequestLimitError('Request too large', 413));
      chunks.push(Buffer.from(chunk));
    };
    const onEnd = () => { cleanup(); resolve(Buffer.concat(chunks, size)); };
    const timer = setTimeout(() => fail(new RequestLimitError('Request timed out', 408)), timeoutMs);
    const declared = req.headers['content-length'];
    if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
      fail(new RequestLimitError('Request too large', 413)); return;
    }
    req.on('data', onData); req.once('end', onEnd);
    req.once('error', onError); req.once('aborted', onAborted);
  });
}

export async function readResponseBody(response, limit) {
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw new Error('Upstream response too large');
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('Upstream response too large');
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, size);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

// A bounded global bucket avoids attacker-controlled forwarded-IP identities
// and unbounded per-client maps. At most 60 login attempts per process/minute.
export function createLoginLimiter(now = Date.now) {
  let tokens = 60;
  let last = now();
  return () => {
    const current = now();
    tokens = Math.min(60, tokens + Math.max(0, current - last) / 1000);
    last = current;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

export function nowIso() {
  return new Date().toISOString();
}

export function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseToolText(result) {
  const content = Array.isArray(result?.content) ? result.content : [];
  const text = content.find((part) => part?.type === "text")?.text;
  if (!text) return { raw: result };
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

export function textResult(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

export function toolErrorResult(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], isError: true };
}

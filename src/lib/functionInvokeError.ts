// Utility helpers for surfacing useful error messages from backend function invocations
// (Supabase JS wraps non-2xx responses as a FunctionsHttpError with `context`.)

export async function extractFunctionInvokeErrorBodyAsync(err: unknown): Promise<unknown> {
  const anyErr = err as any;
  
  // Try context.json() first (FunctionsHttpError in newer Supabase JS)
  if (typeof anyErr?.context?.json === 'function') {
    try {
      return await anyErr.context.json();
    } catch {
      // Fall through
    }
  }
  
  // Try context.text() 
  if (typeof anyErr?.context?.text === 'function') {
    try {
      const text = await anyErr.context.text();
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    } catch {
      // Fall through
    }
  }

  // Try context.body (older format)
  const body = anyErr?.context?.body;
  if (body) {
    if (typeof body === "string") {
      try {
        return JSON.parse(body);
      } catch {
        return body;
      }
    }
    return body;
  }

  return undefined;
}

export function extractFunctionInvokeErrorBody(err: unknown): unknown {
  const anyErr = err as any;
  const body = anyErr?.context?.body;

  if (!body) return undefined;

  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  }

  return body;
}

export async function formatFunctionInvokeErrorAsync(err: unknown): Promise<string> {
  if (!err) return "Unknown error";

  const anyErr = err as any;
  const status = anyErr?.context?.status;
  const body = await extractFunctionInvokeErrorBodyAsync(err);

  let detail = "";
  if (typeof body === "string") {
    detail = body;
  } else if (body && typeof body === "object") {
    const bodyObj = body as any;
    detail = bodyObj.error || bodyObj.message || "";
    if (!detail) {
      try {
        detail = JSON.stringify(bodyObj);
      } catch {
        detail = "";
      }
    }
  }

  const baseMessage = (detail || anyErr?.message || "Request failed").trim();
  const statusSuffix = typeof status === "number" ? ` (status ${status})` : "";

  return `${baseMessage}${statusSuffix}`;
}

export function formatFunctionInvokeError(err: unknown): string {
  if (!err) return "Unknown error";

  const anyErr = err as any;
  const status = anyErr?.context?.status;
  const body = extractFunctionInvokeErrorBody(err);

  let detail = "";
  if (typeof body === "string") {
    detail = body;
  } else if (body && typeof body === "object") {
    const bodyObj = body as any;
    detail = bodyObj.error || bodyObj.message || "";
    if (!detail) {
      try {
        detail = JSON.stringify(bodyObj);
      } catch {
        detail = "";
      }
    }
  }

  const baseMessage = (detail || anyErr?.message || "Request failed").trim();
  const statusSuffix = typeof status === "number" ? ` (status ${status})` : "";

  return `${baseMessage}${statusSuffix}`;
}

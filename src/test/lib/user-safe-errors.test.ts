import { describe, it, expect } from "vitest";
import { redactProviderLeak } from "@/lib/user-safe-errors";

const SAFE_MSG = "The AI service is at capacity right now. Please try again in a moment.";

describe("redactProviderLeak — PROD-T provenance signatures", () => {
  it("redacts the exact PROD-T leaked signature (OPENAI_API_KEY + quota)", () => {
    const observed = "OPENAI_API_KEY stream error: You exceeded your current quota for openai.com/v1/chat/completions";
    expect(redactProviderLeak(observed)).toBe(SAFE_MSG);
  });

  it("redacts bare provider env var names", () => {
    expect(redactProviderLeak("Error: GEMINI_API_KEY not configured")).toBe(SAFE_MSG);
    expect(redactProviderLeak("ANTHROPIC_API_KEY missing")).toBe(SAFE_MSG);
  });

  it("redacts API key prefixes", () => {
    expect(redactProviderLeak("got sk-ant-abc123 in response")).toBe(SAFE_MSG);
    expect(redactProviderLeak("key=sk-proj-xyz")).toBe(SAFE_MSG);
    expect(redactProviderLeak("AIzaSyAbCdEfGhIjKl_MnOpQrStUvWxYz")).toBe(SAFE_MSG);
  });

  it("redacts quota and rate-limit signatures", () => {
    expect(redactProviderLeak("Error: 429 Too Many Requests")).toBe(SAFE_MSG);
    expect(redactProviderLeak("rate limit hit")).toBe(SAFE_MSG);
    expect(redactProviderLeak("rate-limit exceeded")).toBe(SAFE_MSG);
    expect(redactProviderLeak("insufficient_quota")).toBe(SAFE_MSG);
    expect(redactProviderLeak("spending cap reached")).toBe(SAFE_MSG);
    expect(redactProviderLeak("spending_cap reached")).toBe(SAFE_MSG);
    expect(redactProviderLeak("billing_hard_limit reached")).toBe(SAFE_MSG);
    expect(redactProviderLeak("context_length_exceeded")).toBe(SAFE_MSG);
    expect(redactProviderLeak("model overloaded")).toBe(SAFE_MSG);
    expect(redactProviderLeak("too many requests")).toBe(SAFE_MSG);
  });

  it("redacts provider error envelope tags", () => {
    expect(redactProviderLeak("RESOURCE_EXHAUSTED")).toBe(SAFE_MSG);
    expect(redactProviderLeak('"type": "anthropic_error"')).toBe(SAFE_MSG);
    expect(redactProviderLeak("invalid_request_error from openai")).toBe(SAFE_MSG);
  });

  it("redacts provider hostnames", () => {
    expect(redactProviderLeak("fetch failed for openai.com/v1")).toBe(SAFE_MSG);
    expect(redactProviderLeak("api.anthropic.com timeout")).toBe(SAFE_MSG);
    expect(redactProviderLeak("generativelanguage.googleapis.com unreachable")).toBe(SAFE_MSG);
  });
});

describe("redactProviderLeak — passes through legitimate non-provider errors", () => {
  it("passes through validation errors unchanged", () => {
    expect(redactProviderLeak("Name is required")).toBe("Name is required");
    expect(redactProviderLeak("Email is invalid")).toBe("Email is invalid");
    expect(redactProviderLeak("Password must be at least 8 characters")).toBe("Password must be at least 8 characters");
  });

  it("passes through business / permission errors unchanged", () => {
    expect(redactProviderLeak("Tenant not found")).toBe("Tenant not found");
    expect(redactProviderLeak("Permission denied")).toBe("Permission denied");
    expect(redactProviderLeak("Signal does not exist")).toBe("Signal does not exist");
    expect(redactProviderLeak("Entity already exists")).toBe("Entity already exists");
  });

  it("passes through generic JS errors unchanged", () => {
    expect(redactProviderLeak("Cannot read property 'id' of undefined")).toBe("Cannot read property 'id' of undefined");
    expect(redactProviderLeak("Network request failed")).toBe("Network request failed");
  });

  it("does NOT false-positive on words containing 'sk-' (word-boundary)", () => {
    expect(redactProviderLeak("Please click the ask-question button")).toBe("Please click the ask-question button");
    expect(redactProviderLeak("Open the task-list panel")).toBe("Open the task-list panel");
  });

  it("does NOT false-positive on words containing 'AIza' substring", () => {
    // No real "AIza..." substring in normal English; sanity check trivial words
    expect(redactProviderLeak("plaza area")).toBe("plaza area");
  });

  it("handles empty and falsy input gracefully", () => {
    expect(redactProviderLeak("")).toBe("");
  });
});

// Input Validation Utilities for Edge Functions
// Prevents oversized payloads, missing fields, and malformed input

/**
 * Maximum allowed length for a single chat message content string.
 * 20,000 chars ≈ ~5,000 tokens — generous for long prompts but prevents abuse.
 */
export const MAX_MESSAGE_CONTENT_LENGTH = 20_000;

/**
 * Maximum number of messages in a conversation history array.
 */
export const MAX_CONVERSATION_HISTORY = 100;

/**
 * Maximum allowed length for a text field (titles, descriptions, etc.)
 */
export const MAX_TEXT_FIELD_LENGTH = 5_000;

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate that a value is a non-empty string within length limits.
 */
export function validateString(
  value: unknown,
  fieldName: string,
  opts: { required?: boolean; maxLength?: number } = {}
): ValidationResult {
  const { required = false, maxLength = MAX_TEXT_FIELD_LENGTH } = opts;

  if (value === undefined || value === null || value === '') {
    if (required) return { valid: false, error: `${fieldName} is required` };
    return { valid: true };
  }

  if (typeof value !== 'string') {
    return { valid: false, error: `${fieldName} must be a string` };
  }

  if (value.length > maxLength) {
    return { valid: false, error: `${fieldName} exceeds maximum length of ${maxLength} characters` };
  }

  return { valid: true };
}

/**
 * Validate a UUID string format.
 */
export function validateUUID(value: unknown, fieldName: string, required = false): ValidationResult {
  if (value === undefined || value === null || value === '') {
    if (required) return { valid: false, error: `${fieldName} is required` };
    return { valid: true };
  }

  if (typeof value !== 'string') {
    return { valid: false, error: `${fieldName} must be a string` };
  }

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(value)) {
    return { valid: false, error: `${fieldName} must be a valid UUID` };
  }

  return { valid: true };
}

/**
 * Validate an array of chat messages (OpenAI-style { role, content }).
 * Trims oversized content and limits array length.
 */
export function validateMessages(
  messages: unknown,
  fieldName = 'messages',
  opts: { required?: boolean; maxMessages?: number; maxContentLength?: number } = {}
): ValidationResult {
  const { required = false, maxMessages = MAX_CONVERSATION_HISTORY, maxContentLength = MAX_MESSAGE_CONTENT_LENGTH } = opts;

  if (messages === undefined || messages === null) {
    if (required) return { valid: false, error: `${fieldName} is required` };
    return { valid: true };
  }

  if (!Array.isArray(messages)) {
    return { valid: false, error: `${fieldName} must be an array` };
  }

  if (messages.length > maxMessages) {
    return { valid: false, error: `${fieldName} exceeds maximum of ${maxMessages} messages` };
  }

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg || typeof msg !== 'object') {
      return { valid: false, error: `${fieldName}[${i}] must be an object` };
    }
    if (typeof msg.role !== 'string' || !['user', 'assistant', 'system'].includes(msg.role)) {
      return { valid: false, error: `${fieldName}[${i}].role must be 'user', 'assistant', or 'system'` };
    }
    if (typeof msg.content === 'string' && msg.content.length > maxContentLength) {
      return { valid: false, error: `${fieldName}[${i}].content exceeds maximum length of ${maxContentLength}` };
    }
  }

  return { valid: true };
}

/**
 * Validate an enum value against allowed options.
 */
export function validateEnum(
  value: unknown,
  fieldName: string,
  allowedValues: string[],
  required = false
): ValidationResult {
  if (value === undefined || value === null || value === '') {
    if (required) return { valid: false, error: `${fieldName} is required` };
    return { valid: true };
  }

  if (typeof value !== 'string') {
    return { valid: false, error: `${fieldName} must be a string` };
  }

  if (!allowedValues.includes(value)) {
    return { valid: false, error: `${fieldName} must be one of: ${allowedValues.join(', ')}` };
  }

  return { valid: true };
}

/**
 * Run multiple validations and return first error, or { valid: true }.
 */
export function validateAll(...results: ValidationResult[]): ValidationResult {
  for (const result of results) {
    if (!result.valid) return result;
  }
  return { valid: true };
}

-- Remove signals where normalized_text or title contains AI refusal boilerplate.
-- These were created when the AI model returned a refusal message instead of
-- real intelligence content, and that text was stored verbatim in the DB.

DELETE FROM signals
WHERE
  normalized_text ~* 'i cannot (fulfill|provide|complete|generate)'
  OR normalized_text ~* 'i(''m| am) unable to'
  OR normalized_text ~* 'i (don''t|do not) have (access|information|enough)'
  OR normalized_text ~* 'not able to provide'
  OR normalized_text ~* 'cannot (search|access|retrieve|browse)'
  OR normalized_text ~* 'based on (the |my )?(search results|information provided)'
  OR normalized_text ~* 'no (information|data|results) (is )?available'
  OR title ~* 'i cannot (fulfill|provide|complete|generate)'
  OR title ~* 'i(''m| am) unable to'
  OR title ~* 'based on (the |my )?(search results|information provided)';

# Groq rate-limit and token-usage improvements

This update reduces unnecessary Groq input-token usage and makes rate-limit responses actionable.

## Backend

- Keeps the most recent 8 conversation messages and caps each message at 1,200 characters.
- Sends visible page text only when the user's request asks to read, explain, summarize, or describe page/document content.
- Sends the visible-controls inventory only when the request involves clicking, selecting, filling, submitting, uploading, or activating a control.
- Caps one assistant request at 3 model passes and reduces the requested completion size to 500 tokens.
- Parses Groq's `Retry-After` header and returns rate-limit metadata from the `x-ratelimit-*` headers.
- Returns HTTP 429 with a classified error code rather than disguising the provider response as HTTP 503.

## Frontend

- Shows a visible cooldown countdown when Groq supplies a retry time.
- Prevents repeated assistant API calls during that cooldown.
- Keeps local navigation and browser-side actions available; they do not need to call Groq when handled locally.
- Does not automatically retry a 429, which could create another burst of rejected requests.

## Important

These changes reduce avoidable usage; they cannot increase Groq's free-tier quota or bypass its limits. If the account reaches a daily quota, the user must wait for the provider's reset. The exact limits and reset values are organization-specific and should be checked in Groq Console.

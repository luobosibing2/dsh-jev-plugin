# Delta specification

- Enforce a 2,000,000-byte cap for each HTTP response after decompression, including chunked responses. Cancel the body when it crosses the limit.
- Return `INVALID_RESPONSE` for an oversized body and retain the HTTP status and response-header request ID, if present. Do not store or parse a partial body or adopt a business answer from it.
- Accept bodies at the limit and preserve the existing UTF-8 decoding, cancellation, network failure and complete response handling within that limit.
- Verify an oversized open response and an accepted boundary response using a local deterministic Host fixture; regenerate the tracked runtime.

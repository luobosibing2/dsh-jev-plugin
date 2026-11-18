# Decision and delivery

On upstream `c115bf4`, a localhost server sent 2.1 MB of UTF-8 data over a chunked response and kept it open. The judgment reached its deadline and was recorded as `TIMEOUT` because the adapter checked size only after reading the entire body.

Read the decoded HTTP body incrementally, measuring bytes before appending each chunk to the UTF-8 decoder. Cancel the reader on overflow and keep the existing invalid-response classification without a partial body. A Content-Length check alone cannot enforce this limit on chunked or compressed responses.

The Host regression now verifies rejection and server cancellation before the stream completes, with HTTP metadata retained. A response at exactly 2,000,000 bytes still succeeds and retains the exact text. The 89 focused Host and wire tests passed with localhost fixtures. [PR #68](https://github.com/luobosibing2/dsh-jev-plugin/pull/68) merged into `main` as `496c8b2be18fd29b3cff4a77c3923a6dc49f2b21` on 2026-11-18 and closed [Issue #67](https://github.com/luobosibing2/dsh-jev-plugin/issues/67).

The [PR checks](https://github.com/luobosibing2/dsh-jev-plugin/actions/runs/44239389832) passed. A clean build of the combined #68 and #72 tree matched all 92 committed runtime files. The interjection and stage navigation entries both loaded.

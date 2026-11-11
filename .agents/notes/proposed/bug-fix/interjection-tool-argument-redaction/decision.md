# Decision and verification

Status: proposed; no confirmed merge. Fixes [issue #61](https://github.com/luobosibing2/dsh-jev-plugin/issues/61).

On main `c115bf4`, a local AgentLoop and HTTP fixture received a synthetic nested API-key field and a quoted shell assignment with a backslash verbatim. The existing stage-navigation redaction did not apply to this routing field. Reuse the stage JSON masking rules in the routing projection so a cropped prefix or a new checkpoint cannot retain raw recognizable tool credentials. Limit decoding to one million raw characters to bound processing; withhold anything larger with a marker. The stage consumer retains its existing configured-secret masking and redaction version.

The routing fix is limited to recognizable patterns in tool arguments. It does not inspect user credentials or sanitize other routing text. Existing decision records and original Session data remain unchanged. The deterministic regression checks the decision packet, ledger input, and Session; it does not establish a new supported Host release or evaluate model quality.

Verification: the localhost regression failed on the original source and passed with the fix. Frozen offline dependency install, Host/Client typecheck, production build, both generated Host entry imports, and 70 focused routing and stage tests passed. Coverage includes clipping, malformed and oversized input, and replay of a pre-redaction checkpoint.

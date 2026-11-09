# Portable archive extraction requirements

## MODIFIED

- Compatibility smoke must unpack its formal tarball using both GNU tar and Windows' bundled BSD tar. It must avoid drive-letter remote parsing without requiring GNU-only options.
- Command records retain the extraction working directory, arguments and exit status. Existing manifest and runtime comparisons still run after extraction.

## ADDED

- A deterministic runner regression reaches real extraction with an artifact directory containing spaces and shell punctuation. It verifies extracted content and successful unpack, then checks that an intentionally mismatched manifest still fails validation. No actual DSH installation, build, profile or model service is needed.

## REMOVED

None.

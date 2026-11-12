# Requirements

- Apply the relevance threshold, stable ordering and configured limit before comparing selected summaries with the latest visible native or Jev catalog entry for each name.
- Publish selected summaries for new names and changed descriptions. Suppress exact repeats and leave their slots empty. When a name appears again, tell the model to use its latest summary.
- Use the current Session surface so compaction and replay determine which summaries are visible. Preserve empty-selection receipts, the complete catalog tool and the native skill loader.
- Verify that a directory-scoped skill republishes its changed description after a native directory switch, suppresses the repeat and republishes the original description when switching back.

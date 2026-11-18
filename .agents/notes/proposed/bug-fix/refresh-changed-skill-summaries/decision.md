# Decision and delivery

Use the latest visible description for each skill name as the comparison value. A name-only check discarded the current summary after a native directory change. Comparing against every historical version would suppress a legitimate return to an earlier description.

The directory-scoped fixture reproduced the missing catalog on upstream `c115bf4`. The fix uses the existing selection pre-step hook and recorded catalog entries. Delivery is proposed under [issue #63](https://github.com/luobosibing2/dsh-jev-plugin/issues/63).

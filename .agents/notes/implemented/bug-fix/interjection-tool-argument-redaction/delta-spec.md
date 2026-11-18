# Delta specification

- Mask recognizable credential fields and text patterns in decoded recent tool arguments before the routing projection retains them and before the request applies its text budget. Keep ordinary argument values.
- Mark undecodable and oversized tool arguments as withheld. Keep the existing shared routing budget.
- Invalidate routing checkpoints made before this change and rebuild from original Session events. Preserve prior ledger entries.
- Verify that synthetic credentials are absent from the wire request and new attempt record, ordinary arguments survive, and the original Session retains its recorded arguments. Cover clipping, withheld arguments, and checkpoint replay.

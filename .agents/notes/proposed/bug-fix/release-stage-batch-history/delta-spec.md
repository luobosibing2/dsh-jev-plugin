# Stage batch lifetime

- While classification is running, the Host keeps the working Session snapshot and prepared inputs. Existing duplicate-start handling, cancellation and unload continue to operate on that work.
- After success, failure or cancellation, release the working history, requests and batch execution objects. Empty batches do not enter the active registry.
- Keep the latest progress status per Session and the claimed step IDs needed to display failure when an outcome could not be saved. Keep existing saved classifications and earlier results readable.
- Regression: run ten refresh batches in one Session and verify zero active entries after settlement, a latest summary without history or request objects, and all saved outcomes still present. Verify that an empty batch retains only its summary and that both initial and final record-write failures still show as failures.

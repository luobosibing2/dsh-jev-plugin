# Delta: stage cancellation before dispatch

- If the batch is cancelled while a claimed step prepares its request, save one cancelled record using the fingerprint captured for that step when the batch was created.
- Count the step as cancelled, without a spurious recording failure or any model request.
- Keep preparation errors without cancellation and real record write failures visible. Preserve previously completed classifications.

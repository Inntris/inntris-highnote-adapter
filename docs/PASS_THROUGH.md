# Pass-through composition

A customer may already use Highnote's single active Collaborative Authorization endpoint. The adapter can forward the exact received body and original Highnote signature to a customer endpoint after Highnote authenticity and schema checks.

Composition rules:

| Inntris            | Customer endpoint  | Result        |
| ------------------ | ------------------ | ------------- |
| allow              | allow              | allow         |
| block              | allow              | block         |
| allow              | block              | block         |
| block              | block              | block         |
| allow with ceiling | allow with ceiling | lower ceiling |

The downstream transaction ID and currency must match the original request. Malformed or mismatched responses are failures.

The default failure policy is `deny`. It makes Inntris and the customer endpoint enforcement controls, but an endpoint outage can produce card declines.

`allow_inntris` ignores a failed customer endpoint if Inntris allows. That makes the customer endpoint advisory during failure and weakens the combined control. It must be an explicit customer risk decision.

Highnote also applies its card product stand-in settings when this adapter times out or returns a non-2xx response. That Highnote configuration sits outside this repository and must be confirmed during Test and Live planning.

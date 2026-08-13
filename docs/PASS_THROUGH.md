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

The downstream transaction ID and currency must match the original request.

Two different downstream problems are handled differently:

| Class              | Examples                                                                                                         | Handling                                  |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Availability       | timeout, connection error, non-2xx status, unreadable stream                                                     | follows `DOWNSTREAM_FAILURE_POLICY`       |
| Protocol violation | unparseable body, schema violation, transaction ID mismatch, `PARTIAL_AMOUNT_APPROVED` with no authorised amount | always denies, under every failure policy |

The default failure policy is `deny`. It makes Inntris and the customer endpoint enforcement controls, but an endpoint outage can produce card declines.

`allow_inntris` ignores an unavailable customer endpoint if Inntris allows. That makes the customer endpoint advisory during an outage and weakens the combined control. It must be an explicit customer risk decision. It does not make a malformed answer advisory: an endpoint that replies with something the adapter cannot read as an authorisation still denies, so a broken endpoint cannot silently become an approval.

Highnote also applies its card product stand-in settings when this adapter times out or returns a non-2xx response. That Highnote configuration sits outside this repository and must be confirmed during Test and Live planning.

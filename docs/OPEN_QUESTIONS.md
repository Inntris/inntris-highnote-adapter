# Open questions for Highnote

Ask these before representing the adapter as Highnote Test validated.

1. What exact encoding does `highnote-signature` use: lowercase hex, Base64, or Base64url?
2. Does Highnote require or recommend a maximum age and future clock skew for `extensions.signatureTimestamp`?
3. During signing key rotation, can multiple keys be valid, and is a key identifier sent with each request?
4. Are retries always byte identical, or is only `collaborativeAuthorizationRequest.id` guaranteed to remain stable?
5. Which merchant and category identity fields are present in real Test requests versus simulator requests?
6. Can card, account or product custom metadata be projected into the Collaborative Authorization payload?
7. Is there a documented way to distinguish a simulator request from a network originated Test request?
8. Which decline response code does Highnote recommend when an external organisational approval is required?
9. How should a customer configure stand-in behaviour when Inntris is an enforcement control?
10. Which decline response code does Highnote recommend when the adapter itself fails on an authenticated request, so the failure does not have to reach the stand-in setting as a non-2xx response?
11. What endpoint availability, regional placement, TLS, IP filtering and capacity expectations apply before Live enablement?
12. What is the recommended cutover process when a customer already has the single active Collaborative Authorization endpoint?
13. Can Highnote provide a Test payload corpus for Visa, Mastercard, cross-border, partial approval and missing optional field cases?

Until answered, the reference defaults to explicit configuration, strict schema validation and fail closed handling.

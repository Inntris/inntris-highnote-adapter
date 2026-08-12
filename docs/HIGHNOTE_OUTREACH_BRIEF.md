# Highnote outreach brief

## Accurate one sentence description

Inntris has built an open reference adapter for Highnote Collaborative Authorization in the Highnote Test environment that adds independently signed organisation scoped authority decisions and portable evidence while leaving Highnote native controls and execution unchanged.

## What is ready to show

- deterministic ALLOW, BLOCK and REQUIRE_APPROVAL paths
- exact Highnote request binding on the existing Inntris card rail
- deny preserving pass-through for a customer that already uses Collaborative Authorization
- constant time request authentication, freshness and retry handling
- one verifier contract accepting both x402 and Highnote card decisions
- a portable evidence pack that verifies without Highnote or Inntris API access
- explicit labels separating Inntris assertions from Highnote reported facts

## What not to claim

- no partnership or endorsement
- no Highnote Live deployment
- no production availability or latency commitment
- no independent proof of Visa, Mastercard, Highnote execution or settlement
- no completed Highnote Test exercise until the live checklist is recorded

## Suggested ten minute agenda

1. Explain the boundary: Highnote retains card controls and execution; Inntris adds organisation scoped authority.
2. Show the local ALLOW and policy BLOCK in under two minutes.
3. Show offline verification and one tamper failure.
4. Explain the single endpoint pass-through design and deny wins rule.
5. Confirm the protocol questions in `OPEN_QUESTIONS.md`.
6. Agree a Highnote Test session using dummy data.

## Specific ask

Request a technical review of the Collaborative Authorization request signature, Test simulator payload differences, stand-in posture and recommended path to a jointly observed Highnote Test ALLOW and BLOCK exercise.

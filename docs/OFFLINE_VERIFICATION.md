# Offline verification

The committed pack can be verified without Highnote credentials, an Inntris API or network access after the verifier has been obtained.

## Adapter verifier

```shell
npm ci
npm run verify:evidence
```

To verify a tampered fixture and observe a failing exit code:

```shell
npm run verify:evidence -- fixtures/tamper/changed-amount.json
```

## Pinned Inntris verifier

Obtain `Inntris/inntris-verify`, check out commit `f3e85242f8170fe96ca89d53b0442bcb37a5d92c`, disconnect the verifier machine if required, then run:

```shell
python verify_pack.py /path/to/inntris-highnote-adapter/fixtures/allow/evidence-pack.zip --pubkey "$(cat /path/to/inntris-highnote-adapter/fixtures/allow/public-key.txt)"
```

PowerShell:

```powershell
$publicKey = (Get-Content fixtures/allow/public-key.txt -Raw).Trim()
python C:\path\to\inntris-verify\verify_pack.py fixtures/allow/evidence-pack.zip --pubkey $publicKey
```

The fixture pack is expected to pass manifest hash, pinned key, Ed25519 signature and complete file inventory checks. It intentionally contains no MTP receipt, Merkle proof or chain anchor. The upstream verifier therefore warns that there are no receipt entries and skips on-chain verification.

`RESULT: all attempted checks passed` means only the checks actually attempted passed. For this fixture it does not prove a Highnote transaction, Visa or Mastercard fact, settlement, a receipt, or an on-chain anchor.

## Trust result

The pack cryptographically verifies:

- the Inntris organisational authority decision
- the exact action binding used by that decision
- captured evidence integrity
- the pack inventory and manifest signature

The pack preserves, but does not independently prove, the Highnote request and transaction references reported to the adapter.

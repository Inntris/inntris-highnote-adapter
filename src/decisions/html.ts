import type { DecisionDetail, DecisionSummary } from "./model.js";

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function page(title: string, content: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; background: #0b1020; color: #eef2ff; }
    main { max-width: 1180px; margin: 0 auto; padding: 40px 24px 64px; }
    h1 { margin: 0 0 8px; font-size: 30px; }
    .lede { color: #aab4cf; margin: 0 0 28px; }
    .panel { background: #11182b; border: 1px solid #27314a; border-radius: 14px; overflow: hidden; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 13px 14px; border-bottom: 1px solid #27314a; text-align: left; vertical-align: top; }
    th { color: #9ba8c8; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; }
    td { font-size: 14px; }
    tr:last-child td { border-bottom: 0; }
    tr:hover td { background: #17213a; }
    .row-target { display: block; color: inherit; text-decoration: none; min-height: 20px; }
    .verdict { display: inline-block; border-radius: 999px; padding: 4px 9px; font-weight: 800; font-size: 12px; }
    .verdict-allow { color: #78f0ad; background: #123524; }
    .verdict-block { color: #ff9eaa; background: #421b24; }
    .verdict-require-approval { color: #ffd37a; background: #433314; }
    .verified { color: #78f0ad; font-weight: 800; }
    .invalid { color: #ff9eaa; font-weight: 800; }
    .empty { padding: 32px; color: #aab4cf; }
    dl { display: grid; grid-template-columns: minmax(180px, 260px) 1fr; margin: 0; }
    dt, dd { margin: 0; padding: 13px 16px; border-bottom: 1px solid #27314a; overflow-wrap: anywhere; }
    dt { color: #9ba8c8; font-weight: 700; }
    dd { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
    dl > :nth-last-child(-n + 2) { border-bottom: 0; }
    .back { display: inline-block; margin-bottom: 22px; color: #9fc4ff; }
    .trust { margin-top: 22px; color: #9ba8c8; font-size: 13px; }
    @media (max-width: 800px) { .panel { overflow-x: auto; } dl { grid-template-columns: 1fr; } dt { padding-bottom: 2px; border-bottom: 0; } }
  </style>
</head>
<body><main>${content}</main></body>
</html>`;
}

function linkedCell(href: string, value: string): string {
  return `<td><a class="row-target" href="${escapeHtml(href)}">${value}</a></td>`;
}

export function renderDecisionListPage(decisions: DecisionSummary[]): string {
  const rows = decisions
    .map((decision) => {
      const href = `/inntris/decisions/${encodeURIComponent(decision.decision_id)}`;
      const verdictClass = decision.verdict.toLowerCase().replaceAll("_", "-");
      return `<tr>
        ${linkedCell(href, escapeHtml(decision.created_at))}
        ${linkedCell(href, `<span class="verdict verdict-${verdictClass}">${escapeHtml(decision.verdict)}</span>`)}
        ${linkedCell(href, `${escapeHtml(decision.amount)} ${escapeHtml(decision.currency)}`)}
        ${linkedCell(href, escapeHtml(decision.merchant))}
        ${linkedCell(href, escapeHtml(decision.merchant_category))}
        ${linkedCell(href, escapeHtml(decision.reason_codes.join(", ")))}
        ${linkedCell(href, escapeHtml(decision.highnote_response_code))}
        ${linkedCell(href, escapeHtml(decision.decision_id))}
        ${linkedCell(href, "Open")}
      </tr>`;
    })
    .join("");
  const body =
    rows.length === 0
      ? '<div class="empty">No Inntris decisions are available in the current evidence repository.</div>'
      : `<div class="panel"><table>
          <thead><tr><th>Time</th><th>Verdict</th><th>Amount</th><th>Merchant</th><th>Category</th><th>Reason</th><th>Highnote response</th><th>Decision ID</th><th>Evidence</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>`;
  return page(
    "Inntris Decisions",
    `<h1>Inntris Decisions</h1>
     <p class="lede">Organisation scoped authority decisions and independently verifiable evidence from the Highnote Test adapter.</p>
     ${body}
     <p class="trust">Highnote transaction facts are reported by Highnote. Inntris verifies its own signed organisational decision and captured evidence integrity.</p>`,
  );
}

function detailRow(label: string, value: unknown, className = ""): string {
  return `<dt>${escapeHtml(label)}</dt><dd class="${escapeHtml(className)}">${escapeHtml(value)}</dd>`;
}

export function renderDecisionDetailPage(detail: DecisionDetail): string {
  const integrityClass = detail.evidence_integrity === "VERIFIED" ? "verified" : "invalid";
  return page(
    `Inntris Decision ${detail.decision_id}`,
    `<a class="back" href="/inntris/decisions">Back to decisions</a>
     <h1>Inntris Decision</h1>
     <p class="lede">Signed organisational authority evidence captured by the Inntris Highnote Test adapter.</p>
     <div class="panel"><dl>
       ${detailRow("Verdict", detail.verdict)}
       ${detailRow("Reason codes", detail.reason_codes.join(", "))}
       ${detailRow("Amount / currency", `${detail.amount} ${detail.currency}`)}
       ${detailRow("Merchant", detail.merchant)}
       ${detailRow("Merchant category", detail.merchant_category)}
       ${detailRow("Mandate", detail.mandate_id)}
       ${detailRow("Policy version", detail.policy_version)}
       ${detailRow("Decision ID", detail.decision_id)}
       ${detailRow("Action hash", detail.action_hash)}
       ${detailRow("Highnote request ID", detail.highnote_request_id)}
       ${detailRow("Highnote transaction ID", detail.highnote_transaction_id)}
       ${detailRow("Highnote response code", detail.highnote_response_code)}
       ${detailRow("Signature verification state", detail.signature_verified ? "VERIFIED" : "INVALID")}
       ${detailRow("Freshness verification state", detail.freshness_verified ? "VERIFIED" : "INVALID")}
       ${detailRow("Evidence integrity", detail.evidence_integrity, integrityClass)}
       ${detailRow("Evidence bundle ID", detail.evidence_bundle_id)}
     </dl></div>
     <p class="trust">Evidence integrity is calculated from the stored signed bundle. Highnote transaction facts remain reported facts and are not independently proven by Inntris.</p>`,
  );
}

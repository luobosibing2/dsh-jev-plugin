"""Two fixed repository investigations with separate skill and source evidence."""

from __future__ import annotations

import hashlib
import io
import json
import subprocess
import tarfile
from dataclasses import dataclass
from pathlib import Path


CASE_ORDER = ("research-one", "research-two")
SKILL_ROOT = "/tmp/jev-followup/skills"
REPO_DIR = "study"


@dataclass(frozen=True)
class Skill:
    name: str
    description: str
    body: str


@dataclass(frozen=True)
class Case:
    question: str
    source_files: dict[str, str]
    skills: tuple[Skill, ...]
    relevant: tuple[str, ...]
    required: tuple[str, ...]
    oracle_program: str
    fact_hints: tuple[str, ...]
    source_citations: tuple[str, ...]


def _skill(name: str, description: str, body: str) -> Skill:
    return Skill(name, description, body)


def _distractors(definitions: tuple[tuple[str, str], ...]) -> tuple[Skill, ...]:
    return tuple(_skill(name, description,
                        f"Use this guide only for {description[:1].lower() + description[1:].rstrip('.')}. "
                        "Check the current repository source before reporting any result.")
                 for name, description in definitions)


SESSION_NEAR = (
    ("session-signin-guide", "Trace sign-in prompts and credential handoff."),
    ("session-cookie-format", "Review cookie serialization and browser attributes."),
    ("session-revocation-audit", "Inspect revoked-session audit records."),
    ("session-ttl-copy", "Edit user-facing session-expiry wording."),
    ("session-recovery-faq", "Answer account recovery questions after sign-out."),
    ("session-expiry-dashboard", "Describe the session-expiry operations dashboard."),
    ("session-renewal-docs", "Maintain prose documentation about session lifecycle concepts."),
)
SESSION_CROSS = (
    ("invoice-export", "Export invoice rows to a finance report."),
    ("ledger-posting", "Post settled payment rows into a ledger."),
    ("privacy-notice", "Draft a privacy notice for account settings."),
    ("search-index", "Inspect document search indexing."),
    ("image-alt-text", "Write accessible descriptions for images."),
    ("garden-watering", "Choose irrigation timing for plants."),
    ("music-cadence", "Classify cadences in a musical score."),
    ("travel-packing", "Pack supplies for a walking trip."),
    ("test-reporting", "Summarize automated test reports."),
    ("release-notes", "Draft release notes for customers."),
    ("database-backup", "Check database backup rotation."),
    ("network-diagnostics", "Trace transport connectivity failures."),
    ("api-pagination", "Explain API pagination parameters."),
    ("email-template", "Edit notification email templates."),
    ("cache-eviction", "Review cache eviction metrics."),
    ("file-encoding", "Detect text file encoding errors."),
)

BILLING_NEAR = (
    ("billing-invoice-format", "Format an invoice after its balance is determined."),
    ("billing-refund-guide", "Trace refunds after a settled payment."),
    ("billing-cross-account-faq", "Answer common questions about cross-account billing."),
    ("privacy-notice-style", "Edit a privacy notice for clarity."),
    ("privacy-consent-copy", "Review consent wording and labels."),
    ("privacy-audit-dashboard", "Explain the audit dashboard display."),
    ("payment-receipt-format", "Format a payment receipt after settlement."),
    ("retention-legal-faq", "Explain general retention-policy terminology."),
)
BILLING_CROSS = (
    ("session-signin-guide", "Trace sign-in prompts and credential handoff."),
    ("session-cookie-format", "Review cookie serialization and browser attributes."),
    ("search-index", "Inspect document search indexing."),
    ("image-alt-text", "Write accessible descriptions for images."),
    ("garden-watering", "Choose irrigation timing for plants."),
    ("music-cadence", "Classify cadences in a musical score."),
    ("travel-packing", "Pack supplies for a walking trip."),
    ("test-reporting", "Summarize automated test reports."),
    ("release-notes", "Draft release notes for customers."),
    ("network-diagnostics", "Trace transport connectivity failures."),
    ("api-pagination", "Explain API pagination parameters."),
    ("email-template", "Edit notification email templates."),
    ("cache-eviction", "Review cache eviction metrics."),
    ("file-encoding", "Detect text file encoding errors."),
)


SESSION_SOURCE = {
    "study/session/settings.mjs": """const minute = 60_000;

export const sessionSettings = Object.freeze({
  idleLimitMs: 14 * minute,
  renewWithinMs: 6 * minute,
  lifetimeMs: 45 * minute,
});
""",
    "study/session/policy.mjs": """export function shouldRenew(session, now, settings) {
  if (session.revokedAt !== null) return false;
  if (now - session.lastSeenAt > settings.idleLimitMs) return false;
  return session.expiresAt - now <= settings.renewWithinMs;
}

export function renewedExpiry(now, settings) {
  return now + settings.lifetimeMs;
}
""",
    "study/session/request.mjs": """import { sessionSettings } from './settings.mjs';
import { renewedExpiry, shouldRenew } from './policy.mjs';

export async function handleAuthenticatedRequest(session, now, store, settings = sessionSettings) {
  if (!shouldRenew(session, now, settings)) return { renewed: false, expiresAt: session.expiresAt };
  const expiresAt = renewedExpiry(now, settings);
  await store.extendSession(session.id, expiresAt);
  return { renewed: true, expiresAt };
}
""",
    "study/session/routes.mjs": """import { handleAuthenticatedRequest } from './request.mjs';

export async function dispatchAuthenticatedRequest({ session, now, store }) {
  return await handleAuthenticatedRequest(session, now, store);
}
""",
    "study/session/cookie.mjs": """export function cookieAttributes() {
  return { sameSite: 'Lax', httpOnly: true, secure: true };
}
""",
    "study/session/revoke.mjs": """export async function revokeSession(store, id, now) {
  await store.markRevoked(id, now);
}
""",
}

BILLING_SOURCE = {
    "study/billing/allocate.mjs": """export function allocateAcrossInvoices(invoices, paymentMinor) {
  let unappliedMinor = paymentMinor;
  const ordered = [...invoices].sort((a, b) => a.dueAt - b.dueAt || a.id.localeCompare(b.id));
  const allocations = [];
  const remaining = {};
  for (const invoice of ordered) {
    const appliedMinor = Math.min(invoice.balanceMinor, unappliedMinor);
    allocations.push({ invoiceId: invoice.id, appliedMinor });
    remaining[invoice.id] = invoice.balanceMinor - appliedMinor;
    unappliedMinor -= appliedMinor;
  }
  return { allocations, remaining, unappliedMinor };
}
""",
    "study/billing/settlement.mjs": """import { allocateAcrossInvoices } from './allocate.mjs';
import { privacySettings } from '../privacy/settings.mjs';

export async function settlePayment(input, auditStore) {
  const distribution = allocateAcrossInvoices(input.invoices, input.paymentMinor);
  const audit = {
    id: input.paymentId,
    processedAt: input.now,
    allocations: distribution.allocations,
    remaining: distribution.remaining,
    payerEmail: input.payerEmail,
    paymentToken: input.paymentToken,
  };
  await auditStore.save(audit);
  await auditStore.scheduleScrub(audit.id, input.now + privacySettings.scrubAfterDays * 86_400_000);
  return { distribution, audit };
}
""",
    "study/billing/entry.mjs": """import { settlePayment } from './settlement.mjs';

export async function processIncomingPayment(request, auditStore) {
  return await settlePayment(request, auditStore);
}
""",
    "study/privacy/settings.mjs": """export const privacySettings = Object.freeze({
  scrubAfterDays: 21,
  auditKeepDays: 365,
});
""",
    "study/privacy/cleanup.mjs": """import { privacySettings } from './settings.mjs';

export function scrubAudit(audit, now, settings = privacySettings) {
  if (now < audit.processedAt + settings.scrubAfterDays * 86_400_000) return audit;
  const { id, processedAt, allocations, remaining } = audit;
  return { id, processedAt, allocations, remaining, scrubbedAt: now };
}
""",
    "study/privacy/notice.mjs": """export function privacyNoticeTitle() {
  return 'Payment record privacy notice';
}
""",
}

SESSION_ORACLE = """import { dispatchAuthenticatedRequest } from './repo-source/study/session/routes.mjs';
import { sessionSettings } from './repo-source/study/session/settings.mjs';
const now = Date.UTC(2026, 0, 2, 12, 0, 0);
const session = { id: 'session-example', revokedAt: null,
  lastSeenAt: now - 7 * 60_000, expiresAt: now + 4 * 60_000 };
const extensions = [];
const result = await dispatchAuthenticatedRequest({ session, now,
  store: { async extendSession(id, expiresAt) { extensions.push({ id, expiresAt }); } } });
console.log(JSON.stringify({ renewed: result.renewed,
  expiresAfterMinutes: (result.expiresAt - now) / 60_000,
  extensionCount: extensions.length,
  idleLimitMinutes: sessionSettings.idleLimitMs / 60_000,
  renewWithinMinutes: sessionSettings.renewWithinMs / 60_000,
  revokedWouldRenew: (await dispatchAuthenticatedRequest({ session: { ...session, revokedAt: now }, now,
    store: { async extendSession() {} } })).renewed }));
"""

BILLING_ORACLE = """import { processIncomingPayment } from './repo-source/study/billing/entry.mjs';
import { scrubAudit } from './repo-source/study/privacy/cleanup.mjs';
const day = 86_400_000;
const now = Date.UTC(2026, 0, 2, 12, 0, 0);
const scheduled = [];
const request = { paymentId: 'payment-example', paymentMinor: 170, now,
  payerEmail: 'payer@example.invalid', paymentToken: 'fixture-token',
  invoices: [{ id: 'A', balanceMinor: 100, dueAt: now - 2 * day },
             { id: 'B', balanceMinor: 90, dueAt: now - day }] };
const result = await processIncomingPayment(request, {
  async save() {}, async scheduleScrub(id, at) { scheduled.push({ id, at }); },
});
const cleaned = scrubAudit(result.audit, now + 22 * day);
console.log(JSON.stringify({ allocations: result.distribution.allocations,
  remaining: result.distribution.remaining,
  unappliedMinor: result.distribution.unappliedMinor,
  scrubScheduledAfterDays: (scheduled[0].at - now) / day,
  retainedFields: Object.keys(cleaned).sort(),
  removedFields: ['payerEmail', 'paymentToken'].filter(key => !(key in cleaned)),
  auditKeepDays: (await import('./repo-source/study/privacy/settings.mjs')).privacySettings.auditKeepDays }));
"""

SESSION_SKILL = _skill(
    "session-renewal-trace", "Trace authenticated-request session renewal through policy, configuration, and store effects.",
    "Start at the authenticated request route under study/session. Follow its imports into the request handler, "
    "then inspect the renewal predicate and settings. Compare the task's timestamps with the source checks and "
    "verify whether the store extension path runs. Cite source files; derive values from the code rather than this guide.",
)
BILLING_SKILL = _skill(
    "invoice-allocation-trace", "Trace one payment applied across invoices, including order, allocations, and remaining balances.",
    "Start at the payment entry under study/billing, follow the settlement call into allocation, and calculate "
    "the task's payment against the source ordering and balance updates. Check the returned distribution and cite "
    "source files; this guide does not contain the result.",
)
PRIVACY_SKILL = _skill(
    "audit-retention-trace", "Trace payment audit cleanup timing and surviving fields from privacy policy and code.",
    "Follow the payment settlement's audit creation and cleanup scheduling into study/privacy. Inspect the "
    "policy and cleanup function, then apply the task's elapsed time to the actual condition. List only fields "
    "preserved by source and cite files; this guide does not contain the result.",
)

CASES = {
    "research-one": Case(
        question=("Investigate the sample service under `study/` without changing files. An active session was "
                  "last seen seven minutes ago and expires four minutes from now. When its next authenticated "
                  "request arrives, does the service extend it? Explain the call path, the relevant configured "
                  "checks and values, and the new expiry relative to now. Cite the source files you used."),
        source_files=SESSION_SOURCE,
        skills=(SESSION_SKILL,) + _distractors(SESSION_NEAR + SESSION_CROSS),
        relevant=(SESSION_SKILL.name,), required=(SESSION_SKILL.name,),
        oracle_program=SESSION_ORACLE,
        fact_hints=("renewed", "expiresAfterMinutes", "idleLimitMinutes", "renewWithinMinutes", "extensionCount"),
        source_citations=("study/session/routes.mjs", "study/session/request.mjs",
                          "study/session/policy.mjs", "study/session/settings.mjs"),
    ),
    "research-two": Case(
        question=("Investigate the sample service under `study/` without changing files. A payment of 170 minor "
                  "units is applied to invoice A (100 still due, earlier due date) and invoice B (90 still due). "
                  "Trace how the payment is split and what each invoice still owes. The payment audit is checked "
                  "22 days after processing: state when sensitive cleanup was scheduled, which fields remain, "
                  "and which sensitive fields are removed. Cite the relevant source files."),
        source_files=BILLING_SOURCE,
        skills=(BILLING_SKILL, PRIVACY_SKILL) + _distractors(BILLING_NEAR + BILLING_CROSS),
        relevant=(BILLING_SKILL.name, PRIVACY_SKILL.name),
        required=(BILLING_SKILL.name, PRIVACY_SKILL.name),
        oracle_program=BILLING_ORACLE,
        fact_hints=("allocations", "remaining", "scrubScheduledAfterDays", "retainedFields", "removedFields"),
        source_citations=("study/billing/entry.mjs", "study/billing/settlement.mjs",
                          "study/billing/allocate.mjs", "study/privacy/settings.mjs", "study/privacy/cleanup.mjs"),
    ),
}


def _json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")


def skill_text(skill: Skill) -> str:
    return (f"---\nname: {skill.name}\n"
            f"description: {json.dumps(skill.description, ensure_ascii=False)}\n"
            "disable-model-invocation: false\nuser-invocable: true\n---\n\n"
            f"# {skill.name}\n\n{skill.body}\n")


def _archive(path: Path, files: dict[str, bytes]) -> None:
    with tarfile.open(path, "w") as archive:
        for name, body in sorted(files.items()):
            info = tarfile.TarInfo(name)
            info.size = len(body)
            info.mode = 0o644
            info.mtime = 0
            archive.addfile(info, io.BytesIO(body))


def prepare_case(case_id: str, root: Path, image: str) -> None:
    """Write source, skill, oracle, and Pier inputs once under this suite."""
    root = Path(root).resolve()
    if case_id not in CASES or root.exists() or root.parent.name != "cases":
        raise ValueError("unknown or existing follow-up case directory")
    case = CASES[case_id]
    if len(case.skills) != 24 or len({skill.name for skill in case.skills}) != 24:
        raise ValueError("each follow-up case requires exactly 24 unique skills")
    if not set(case.required) <= set(case.relevant) <= {skill.name for skill in case.skills}:
        raise ValueError("invalid independent skill labels")
    if not image.startswith("public.ecr.aws/d3j8x8q7/swe-bench-202605@sha256:") or '"' in image:
        raise ValueError("unexpected fixed Docker image")
    task = root / "task"
    (task / "environment").mkdir(parents=True)
    opaque_id = f"r{CASE_ORDER.index(case_id) + 1:02d}"
    (task / "task.toml").write_text(
        'schema_version = "1.3"\n'
        f'[task]\nname = "local/skill-study-{opaque_id}"\n'
        'description = "Read-only repository investigation"\n'
        f'[metadata]\ntask_id = "skill-study-{opaque_id}"\n'
        '[agent]\nnetwork_mode = "no-network"\ntimeout_sec = 240.0\n'
        '[verifier]\nnetwork_mode = "no-network"\n'
        f'[environment]\ndocker_image = "{image}"\n'
        'os = "linux"\ncpus = 2\nmemory_mb = 8192\nstorage_mb = 20480\n'
        'gpus = 0\nmcp_servers = []\n', encoding="utf-8")
    (task / "environment" / "Dockerfile").write_text(f"FROM {image}\n", encoding="utf-8")
    (task / "instruction.md").write_text(case.question + "\n", encoding="utf-8")
    repo_files = {name: content.encode("utf-8") for name, content in case.source_files.items()}
    for name, content in sorted(repo_files.items()):
        path = root / "repo-source" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    _archive(root / "repo-fixture.tar", repo_files)
    oracle_path = root / "oracle-eval.mjs"
    oracle_path.write_text(case.oracle_program, encoding="utf-8")
    completed = subprocess.run(["node", str(oracle_path)], cwd=root,
                               capture_output=True, text=True, check=False)
    if completed.returncode != 0:
        raise RuntimeError("independent source oracle failed")
    oracle = json.loads(completed.stdout)
    skill_files = {f"{skill.name}/SKILL.md": skill_text(skill).encode("utf-8") for skill in case.skills}
    _archive(root / "skill-fixture.tar", skill_files)
    body_hashes = {skill.name: hashlib.sha256(f"# {skill.name}\n\n{skill.body}".encode()).hexdigest()
                   for skill in case.skills}
    _json(root / "fixture-expected.json", {
        "repo": {name: hashlib.sha256(body).hexdigest() for name, body in repo_files.items()},
        "skills": {name: hashlib.sha256(body).hexdigest() for name, body in skill_files.items()},
    })
    _json(root / "truth.json", {
        "case_id": case_id, "candidate_names": sorted(skill.name for skill in case.skills),
        "candidate_descriptions": {skill.name: skill.description for skill in case.skills},
        "relevant_names": sorted(case.relevant), "required_names": sorted(case.required),
        "body_sha256": body_hashes, "source_files": sorted(repo_files),
        "source_citations": list(case.source_citations), "fact_hints": list(case.fact_hints),
        "oracle": oracle, "oracle_source": "direct Node execution of frozen repo-source; no Jev or main-model output",
    })
    _json(root / "mock-jev-spec.json", {
        "model": "jev-1.13.0-local-fixture",
        "noulByQuestionId": {f"candidate-{index}": 0.9 if name in case.relevant else 0.1
                             for index, name in enumerate(sorted(skill.name for skill in case.skills))},
        "defaultNoul": 0.1, "choiceByQuestionId": {}, "defaultChoice": "unknown",
        "usage": {"input_tokens": 4, "output_tokens": 2},
        "purpose": "keyless transport only",
    })

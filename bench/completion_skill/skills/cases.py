"""Frozen inputs for six native filesystem-skill selection cases."""

from __future__ import annotations

import hashlib
import io
import json
import tarfile
from dataclasses import dataclass
from pathlib import Path


CASE_ORDER = (
    "empty-directory",
    "single-relevant",
    "dense-relevance",
    "two-required-near-names",
    "all-irrelevant",
    "catalog-recovery",
)

# The runtime provider sees only this root, which exists even for the empty case.
CONTAINER_SKILL_ROOT = "/tmp/jev-deepswe/eval-skills"


@dataclass(frozen=True)
class Skill:
    name: str
    description: str
    body: str


@dataclass(frozen=True)
class Case:
    question: str
    skills: tuple[Skill, ...]
    relevant: tuple[str, ...]
    required: tuple[str, ...]
    answer_tokens: tuple[str, ...]
    require_catalog: bool = False
    forbid_irrelevant_load: bool = False


def _skill(name: str, description: str, instruction: str) -> Skill:
    return Skill(name, description, instruction)


CASES = {
    "empty-directory": Case(
        question=("Answer this simple handoff question in one sentence: what is 19 + 23? "
                  "Use a relevant local skill if one is available; otherwise answer directly."),
        skills=(), relevant=(), required=(), answer_tokens=("42",),
    ),
    "single-relevant": Case(
        question=("An incident report says checkout requests intermittently time out, while purchase records remain intact. "
                  "Consult the applicable local skill and report its triage code and first action."),
        skills=(
            _skill("incident-triage", "Classify a checkout incident and state its first response action.",
                   "For intermittent checkout timeouts with intact purchase records, report triage code `AMBER-17` and first action `inspect payment gateway latency`. Do not invent another code."),
        ),
        relevant=("incident-triage",), required=("incident-triage",),
        answer_tokens=("AMBER-17", "inspect payment gateway latency"),
    ),
    "dense-relevance": Case(
        question=("Prepare a compact release-readiness packet for a service launch. Give the rollout gate, support route, "
                  "QA checkpoint, rollback trigger, and stakeholder status phrase from the applicable local skills. "
                  "Consult each applicable skill before answering."),
        skills=(
            _skill("launch-rollout", "Release rollout gating and staged launch decisions.",
                   "For a service launch, the rollout gate is `ORBIT-GATE`. Include this literal gate in the packet."),
            _skill("launch-support", "Support escalation and customer response route for launches.",
                   "For a service launch, the support route is `HARBOR-QUEUE`. Include this literal route in the packet."),
            _skill("launch-quality", "QA checkpoint for a service launch and release readiness.",
                   "For a service launch, the QA checkpoint is `QUARTZ-CHECK`. Include this literal checkpoint in the packet."),
            _skill("launch-rollback", "Rollback trigger for staged service launches.",
                   "For a service launch, the rollback trigger is `EMBER-TRIGGER`. Include this literal trigger in the packet."),
            _skill("launch-stakeholders", "Stakeholder status phrase for a service launch.",
                   "For a service launch, the stakeholder status phrase is `MINT-STATUS`. Include this literal phrase in the packet."),
            _skill("garden-irrigation", "Select watering schedules for greenhouse crops.",
                   "For greenhouse basil, the watering cue is `SOIL-MOIST`."),
            _skill("music-harmony", "Identify cadence patterns in a musical score.",
                   "A perfect cadence resolves from dominant to tonic."),
            _skill("travel-packing", "Pack lightweight luggage for a walking trip.",
                   "For a walking trip, pack one rain layer."),
            _skill("astronomy-lenses", "Choose lenses for amateur telescope viewing.",
                   "For lunar viewing, use a low-power eyepiece first."),
        ),
        relevant=("launch-rollout", "launch-support", "launch-quality", "launch-rollback", "launch-stakeholders"),
        required=("launch-rollout", "launch-support", "launch-quality", "launch-rollback", "launch-stakeholders"),
        answer_tokens=("ORBIT-GATE", "HARBOR-QUEUE", "QUARTZ-CHECK", "EMBER-TRIGGER", "MINT-STATUS"),
    ),
    "two-required-near-names": Case(
        question=("A finance team is closing an invoice reconciliation and a privacy team is closing retention review. "
                  "Use the two applicable local procedures and report the exact ledger code and retention code. "
                  "Do not substitute formatting or FAQ guidance for either procedure."),
        skills=(
            _skill("invoice-reconcile", "Reconcile invoice ledger entries and assign the ledger close code.",
                   "For the invoice ledger close, report exact ledger code `LEDGER-742`."),
            _skill("invoice-reconcile-style", "Format the prose of an already completed invoice reconciliation.",
                   "Use a table only after the ledger is closed. This skill does not assign a ledger code."),
            _skill("invoice-reconciliation-faq", "Explain common invoice reconciliation questions to readers.",
                   "Explain terms in plain language. This skill does not assign a ledger code."),
            _skill("privacy-retention", "Decide the retention review code for a privacy closeout.",
                   "For a privacy retention closeout, report exact retention code `RETENTION-308`."),
            _skill("privacy-retention-style", "Edit an already completed privacy retention notice for style.",
                   "Prefer short sentences. This skill does not assign a retention code."),
            _skill("privacy-retention-faq", "Explain general privacy retention questions without a closeout decision.",
                   "Explain why a retention policy exists. This skill does not assign a retention code."),
        ),
        relevant=("invoice-reconcile", "privacy-retention"),
        required=("invoice-reconcile", "privacy-retention"),
        answer_tokens=("LEDGER-742", "RETENTION-308"),
    ),
    "all-irrelevant": Case(
        question=("Answer in one short sentence: what is 19 + 23? Consult a local skill only if its instructions "
                  "actually help solve this arithmetic question."),
        skills=(
            _skill("baking-bread", "Bake crusty sourdough bread at home.", "Proof the dough until doubled."),
            _skill("bird-watching", "Identify birds on a nature walk.", "Observe beak shape and habitat."),
            _skill("calligraphy-ink", "Choose ink and paper for calligraphy.", "Test ink on a scrap page."),
            _skill("garden-pruning", "Prune trees in a home garden.", "Remove dead branches first."),
            _skill("guitar-strings", "Replace strings on an acoustic guitar.", "Change one string at a time."),
            _skill("map-reading", "Read topographic hiking maps.", "Check the contour interval."),
            _skill("photography-light", "Set light for portrait photography.", "Use a diffuser in harsh sun."),
            _skill("telescope-care", "Clean and store a telescope.", "Keep caps on during storage."),
        ),
        relevant=(), required=(), answer_tokens=("42",),
        forbid_irrelevant_load=True,
    ),
    "catalog-recovery": Case(
        question=("Call `skill_catalog` to recover the complete local directory, and list all returned skill names. "
                  "Then call the native `skill` tool with name `zenith-codebook` and report its exact dispatch code. "
                  "The catalog list and loaded instructions are separate evidence; do both steps."),
        skills=(
            _skill("archive-index", "Index archival boxes and document folders.", "Index boxes by date."),
            _skill("bird-migration", "Track seasonal bird migration routes.", "Record waypoint dates."),
            _skill("cafe-menu", "Revise a cafe menu for a new season.", "Use short menu names."),
            _skill("garden-layout", "Plan beds in a vegetable garden.", "Give tall plants northern beds."),
            _skill("music-tempo", "Annotate tempo in a score.", "Use beats per minute."),
            _skill("photo-catalog", "Catalog photograph metadata.", "Keep capture dates."),
            _skill("travel-route", "Choose a walking tour route.", "Allow rest stops."),
            _skill("zenith-codebook", "Look up dispatch codes for Zenith operations.",
                   "For a Zenith dispatch request, report exact dispatch code `ZENITH-419`."),
        ),
        relevant=("zenith-codebook",), required=("zenith-codebook",),
        answer_tokens=("ZENITH-419",), require_catalog=True,
    ),
}


def skill_text(skill: Skill) -> str:
    """Use canonical filesystem-provider frontmatter and a body loaded on demand."""
    description = json.dumps(skill.description, ensure_ascii=False)
    return (f"---\nname: {skill.name}\ndescription: {description}\n"
            "disable-model-invocation: false\nuser-invocable: true\n---\n\n"
            f"# {skill.name}\n\n{skill.body}\n")


def _json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")


def prepare_case(case_id: str, root: Path, image: str) -> None:
    """Generate one immutable case source under ``skills/cases/<case_id>``."""
    if case_id not in CASES:
        raise ValueError(f"unknown skill case: {case_id}")
    if root.exists():
        raise FileExistsError(f"skill case already exists: {root}")
    if root.parent.name != "cases" or root.parent.parent.name != "skills":
        raise ValueError("skill cases must be generated inside skills/cases")
    if not image.startswith("public.ecr.aws/d3j8x8q7/swe-bench-202605@sha256:") or '"' in image:
        raise ValueError("unexpected Docker image identity")
    case = CASES[case_id]
    opaque_id = f"s{CASE_ORDER.index(case_id) + 1:02d}"
    names = [skill.name for skill in case.skills]
    if len(set(names)) != len(names) or not set(case.required) <= set(case.relevant) <= set(names):
        raise ValueError("invalid frozen skill labels")
    task = root / "task"
    (task / "environment").mkdir(parents=True)
    (task / "task.toml").write_text(
        'schema_version = "1.3"\n'
        f'[task]\nname = "local/jev-skill-{opaque_id}"\n'
        'description = "Native filesystem skill task"\n'
        f'[metadata]\ntask_id = "jev-skill-{opaque_id}"\n'
        '[agent]\nnetwork_mode = "no-network"\ntimeout_sec = 120.0\n'
        '[verifier]\nnetwork_mode = "no-network"\n'
        f'[environment]\ndocker_image = "{image}"\n'
        'os = "linux"\ncpus = 2\nmemory_mb = 8192\nstorage_mb = 20480\n'
        'gpus = 0\nmcp_servers = []\n', encoding="utf-8")
    (task / "environment" / "Dockerfile").write_text(f"FROM {image}\n", encoding="utf-8")
    (task / "instruction.md").write_text(case.question + "\n", encoding="utf-8")
    expected = {}
    bodies = {}
    with tarfile.open(root / "fixture.tar", "w") as archive:
        for skill in sorted(case.skills, key=lambda item: item.name):
            name = f"{skill.name}/SKILL.md"
            content = skill_text(skill).encode("utf-8")
            digest = hashlib.sha256(content).hexdigest()
            expected[name] = digest
            parsed_body = f"# {skill.name}\n\n{skill.body}"
            bodies[skill.name] = {
                "file_sha256": digest,
                "body_sha256": hashlib.sha256(parsed_body.encode("utf-8")).hexdigest(),
            }
            info = tarfile.TarInfo(name)
            info.size = len(content)
            info.mode = 0o644
            info.mtime = 0
            archive.addfile(info, io.BytesIO(content))
    _json(root / "fixture-expected.json", expected)
    _json(root / "truth.json", {
        "case_id": case_id,
        "candidate_names": sorted(names),
        "relevant_names": sorted(case.relevant),
        "required_names": sorted(case.required),
        "answer_tokens": list(case.answer_tokens),
        "require_catalog": case.require_catalog,
        "forbid_irrelevant_load": case.forbid_irrelevant_load,
        "candidate_descriptions": {skill.name: skill.description for skill in case.skills},
        "body_hashes": bodies,
        "oracle_source": "fixture author; independent of Jev scores and model output",
    })
    _json(root / "mock-jev-spec.json", {
        "model": "jev-1.13.0-local-fixture",
        "noulByQuestionId": {f"candidate-{index}": 0.9 if name in case.relevant else 0.1
                             for index, name in enumerate(sorted(names))},
        "defaultNoul": 0.1,
        "choiceByQuestionId": {},
        "defaultChoice": "unknown",
        "usage": {"input_tokens": 4, "output_tokens": 2},
        "purpose": "Local transport and adoption check only; scores are not Jev judgments",
    })


def patch_skill_rows(rows: list[dict], case_id: str, arm: str, plan: dict) -> list[dict]:
    """Enable the same native skill seam in both arms and flip one Jev feature."""
    if case_id not in CASES or arm not in ("baseline", "skill_selection"):
        raise ValueError("unknown skill case or arm")
    if plan.get("conditions", {}).get("toolset") != "dsh-headless-no-web-tools":
        raise ValueError("skill profile requires the frozen no-web toolset")
    from copy import deepcopy
    updated = deepcopy(rows)
    jev_rows = [row for row in updated if row.get("id") == "jev"]
    selection_rows = [row for row in updated if row.get("id") == "jev-selection"]
    if len(jev_rows) != 1 or len(selection_rows) != 1:
        raise ValueError("expected one Jev and one Jev selection row")
    features = jev_rows[0]["config"]["features"]
    features.update({name: name == "skill-selection" and arm == "skill_selection" for name in features})
    if "skill-selection" not in features or "file-ranking" not in features:
        raise ValueError("Jev selection switches are absent")
    selection_rows[0].pop("disabled", None)
    updated.append({"id": "skill-filesystem", "config": {
        "includeDefaultRoots": False,
        "customSkillDirs": [CONTAINER_SKILL_ROOT],
        "watch": False,
    }})
    return updated

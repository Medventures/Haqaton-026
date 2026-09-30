from __future__ import annotations

from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field

CONTRACT_VERSION = "v4"
QUESTIONNAIRE_VERSION = "demo-intake-v1"
CATALOGUE_VERSION = "demo-catalogue-v1"
RULES_VERSION = "demo-rules-v1"
CONTENT_VERSION = "demo-content-v1"


class AnswerState(str, Enum):
    yes = "yes"
    no = "no"
    unknown = "unknown"
    declined = "declined"
    not_applicable = "not_applicable"
    not_asked = "not_asked"


class WorkflowClass(str, Enum):
    standard_preview = "standard_preview"
    needs_clinician_review = "needs_clinician_review"
    pregnancy_review = "pregnancy_review"
    adult_scope_excluded = "adult_scope_excluded"
    safety_stop = "safety_stop"
    catalogue_only = "catalogue_only"


class AppointmentStatus(str, Enum):
    demo_confirmed = "demo_confirmed"
    clinic_request_pending = "clinic_request_pending"
    clinic_confirmed = "clinic_confirmed"
    cancelled = "cancelled"


class Eligibility(str, Enum):
    eligible = "eligible"
    needs_review = "needs_review"
    ineligible = "ineligible"


class ConsentReceipt(BaseModel):
    granted: bool
    text_version: str


class QuestionnaireSubmission(BaseModel):
    contract_version: Literal["v4"] = "v4"
    revision_id: str
    questionnaire_version: str
    processing_consent: ConsentReceipt
    answers: dict[str, Any]
    doctor_note: str | None = None


class CreateCaseBody(QuestionnaireSubmission):
    clinic_transfer: ConsentReceipt
    contact_name: str
    phone: str
    selected_package_id: str | None = None
    consultation_reason: str | None = None
    preferred_date: str | None = None
    analytics_session_id: str | None = None
    reminder_opt_in: bool = False


class ActiveAnswers(BaseModel):
    answers: dict[str, Any]
    active_fields: list[str]
    doctor_note: str | None = None
    questionnaire_version: str
    revision_id: str


class Reason(BaseModel):
    code: str
    input_refs: list[str]
    template_id: str
    source_refs: list[str] = Field(default_factory=list)
    rule_id: str | None = None
    rule_version: str | None = None
    text_ru: str | None = None
    text_kz: str | None = None


class PackageCandidate(BaseModel):
    package_id: str
    name: str
    composition_status: Literal["complete", "incomplete", "unknown"]
    known_services: list[str]
    missing_positions: list[str] = Field(default_factory=list)
    unknown_positions: list[str] = Field(default_factory=list)
    price_minor: int | None = None
    currency: str | None = None
    reasons: list[Reason]
    eligibility: Eligibility
    review_flags: list[str] = Field(default_factory=list)


class Explanation(BaseModel):
    id: str
    title_ru: str
    text_ru: str
    title_kz: str | None = None
    text_kz: str | None = None
    blocks: list[str] = Field(default_factory=list)
    tier: Literal["optimal", "maximum"] | None = None


class OfferTier(BaseModel):
    slot: Literal["optimal", "maximum"]
    package_id: str
    name: str
    name_kz: str | None = None
    variant: Literal["standard", "adapted"] = "standard"
    block_ids: list[str]
    extra_block_ids: list[str] = Field(default_factory=list)
    price_minor: int | None = None
    currency: str | None = None
    source_url: str | None = None
    note_ru: str | None = None
    note_kz: str | None = None
    adaptation_ru: list[str] = Field(default_factory=list)
    adaptation_kz: list[str] = Field(default_factory=list)
    # Full composition from the clinic page, one line per block (for "Подробнее о составе").
    details: list[dict[str, str | None]] = Field(default_factory=list)
    # Previous price only if the clinic publishes a real promo; never computed.
    price_old_minor: int | None = None


class ComparisonRow(BaseModel):
    block_id: str
    label_ru: str
    label_kz: str
    optimal: bool
    maximum: bool


class TierGroup(BaseModel):
    sex: Literal["female", "male"]
    optimal: OfferTier
    maximum: OfferTier
    comparison: list[ComparisonRow]


class Offer(BaseModel):
    groups: list[TierGroup]
    recommended: Literal["optimal", "maximum"] | None = None
    recommendation_ru: str
    recommendation_kz: str
    cta: Literal["book", "discuss"]
    explanations: list[Explanation] = Field(default_factory=list)
    factors: list[str] = Field(default_factory=list)
    rules_version: str = "demo"


class Preview(BaseModel):
    contract_version: str = CONTRACT_VERSION
    revision_id: str
    mode: Literal["anonymous", "saved"]
    workflow_class: WorkflowClass
    candidates: list[PackageCandidate]
    offer: Offer | None = None
    explanations: list[Explanation] = Field(default_factory=list)
    review_flags: list[str] = Field(default_factory=list)
    questions_for_doctor: list[str] = Field(default_factory=list)
    is_demo: bool = True
    questionnaire_version: str
    catalogue_version: str
    rules_version: str
    state: str


class SelectionBody(BaseModel):
    revision_id: str
    package_id: str
    consultation_reason: str
    requested_services: list[str] = Field(default_factory=list)
    requested_changes: list[str] = Field(default_factory=list)
    preferred_date: str | None = None


class AppointmentBody(BaseModel):
    slot_id: str
    revision_id: str
    consultation_reason: str


class StaffCasePatch(BaseModel):
    notes: str | None = None
    owner_id: str | None = None
    preferred_date: str | None = None


class PlanBody(BaseModel):
    revision_id: str
    template_id: str


class ReviewBody(BaseModel):
    revision_id: str


class TaskPatch(BaseModel):
    status: Literal["active", "completed", "superseded"]


class AnalyticsEventIn(BaseModel):
    event_id: str
    analytics_session_id: str
    name: str
    occurred_at: str
    props: dict[str, Any] = Field(default_factory=dict)


class AnalyticsBatch(BaseModel):
    events: list[AnalyticsEventIn]


class DemoSessionBody(BaseModel):
    role: Literal["patient", "coordinator", "doctor", "admin"]
    patient_id: str | None = None

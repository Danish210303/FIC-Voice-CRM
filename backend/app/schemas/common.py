from enum import Enum
from typing import Optional, Any
# pyright: ignore[reportMissingImports]
from pydantic import BaseModel, EmailStr, Field, field_validator
from datetime import datetime


class Role(str, Enum):
    ADMIN = "admin"
    TEAM_LEADER = "team_leader"
    AGENT = "agent"


class PoolName(str, Enum):
    RECRUITMENT = "recruitment"
    CREDIT_CARD_SALES = "credit_card_sales"
    CUSTOMER_SUPPORT = "customer_support"


class LeadStatus(str, Enum):
    NEW = "new"
    IN_PROGRESS = "in_progress"
    FOLLOW_UP = "follow_up"
    QUALIFIED = "qualified"
    NOT_INTERESTED = "not_interested"
    CLOSED = "closed"


class CallDirection(str, Enum):
    INBOUND = "inbound"
    OUTBOUND = "outbound"


class CallOutcome(str, Enum):
    ANSWERED = "answered"
    MISSED = "missed"
    BUSY = "busy"
    NO_ANSWER = "no_answer"
    TRANSFERRED = "transferred"
    VOICEMAIL = "voicemail"
    NOT_INTERESTED = "not_interested"
    QUALIFIED = "qualified"
    FOLLOW_UP_REQUIRED = "follow_up_required"
    WRONG_NUMBER = "wrong_number"
    INTERESTED = "interested"
    CALL_BACK = "call_back"
    CALLBACK = "callback"
    CALLBACK_SCHEDULED = "callback_scheduled"
    CONVERTED = "converted"
    DNC = "dnc"
    DO_NOT_CALL = "do_not_call"
    INVALID_NUMBER = "invalid_number"
    RESOLVED = "resolved"
    CLOSED = "closed"
    PENDING = "pending"
    COMPLETED = "completed"
    OTHER = "other"


class MonitorAction(str, Enum):
    LISTEN = "listen"
    WHISPER = "whisper"
    BARGE = "barge"
    TRANSFER = "transfer"
    END = "end"


class MonitorActionPayload(BaseModel):
    action: MonitorAction


class UserCreate(BaseModel):
    name: str
    email: EmailStr
    password: str
    role: Role
    phone: Optional[str] = None
    employee_id: Optional[str] = None
    pool_id: Optional[str] = None
    supervisor_id: Optional[str] = None
    department: Optional[str] = None
    status: Optional[str] = "active"
    language: Optional[str] = "English"
    shift: Optional[str] = None
    skills: Optional[list[str]] = Field(default_factory=list)
    voice_model: Optional[str] = None
    ai_configuration: Optional[dict] = Field(default_factory=dict)
    is_active: Optional[bool] = True
    send_credentials: Optional[bool] = False
    require_password_change: Optional[bool] = False
    permissions: Optional[dict] = Field(default_factory=dict)

    @field_validator("phone", "employee_id", "pool_id", "supervisor_id", "department", "shift", mode="before")
    @classmethod
    def empty_str_to_none(cls, v):
        if isinstance(v, str) and not v.strip():
            return None
        return v
class UserUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    password: Optional[str] = None
    role: Optional[Role] = None
    phone: Optional[str] = None
    employee_id: Optional[str] = None
    pool_id: Optional[str] = None
    supervisor_id: Optional[str] = None
    department: Optional[str] = None
    shift: Optional[str] = None
    language: Optional[str] = None
    is_active: Optional[bool] = None

    @field_validator("phone", "employee_id", "pool_id", "supervisor_id", "department", "shift", mode="before")
    @classmethod
    def empty_str_to_none(cls, v):
        if isinstance(v, str) and not v.strip():
            return None
        return v



class UserLogin(BaseModel):
    email: str
    password: str


class UserOut(BaseModel):
    id: str
    employee_id: str
    name: str
    email: EmailStr
    role: Role
    pool_id: Optional[str] = None
    supervisor_id: Optional[str] = None
    is_active: bool = True
    department: Optional[str] = None
    status: Optional[str] = "active"
    language: Optional[str] = "English"
    shift: Optional[str] = None
    skills: Optional[list[str]] = None
    voice_model: Optional[str] = None
    ai_configuration: Optional[dict] = None
    send_credentials: Optional[bool] = False
    require_password_change: Optional[bool] = False
    permissions: Optional[dict] = None


class PoolCreate(BaseModel):
    name: PoolName
    description: Optional[str] = None


class CampaignCreate(BaseModel):
    name: str
    pool_id: str
    description: Optional[str] = None
    industry: Optional[str] = "banking"  # banking, insurance, bpo, general
    workflow_category: Optional[str] = "credit_cards"  # cards, loans, accounts, policy, claims, sales, support
    dialer_mode: Optional[str] = "progressive"  # progressive, predictive, power, inbound_ivr, manual
    routing_strategy: Optional[str] = "longest_idle"  # longest_idle, skill_matched, priority, round_robin
    required_skills: Optional[list[str]] = Field(default_factory=list)
    dnd_check_enabled: Optional[bool] = True
    calling_hours_start: Optional[str] = "09:00"
    calling_hours_end: Optional[str] = "20:00"
    pacing_ratio: Optional[float] = 1.5
    inbound_queue_priority: Optional[int] = 5
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    campaign_type: Optional[str] = "outbound"
    languages: Optional[list[str]] = Field(default_factory=list)
    supervisor_id: Optional[str] = None
    agent_ids: Optional[list[str]] = Field(default_factory=list)
    ai_voice: Optional[str] = None
    calling_hours: Optional[str] = "9 AM - 6 PM"
    max_retry: Optional[int] = 3
    retry_interval: Optional[int] = 30
    status: Optional[str] = "active"


class LeadCreate(BaseModel):
    name: str
    phone: str
    email: Optional[EmailStr] = None
    pool_id: str
    campaign_id: Optional[str] = None
    assigned_agent_id: Optional[str] = None
    status: Optional[str] = "new"
    source: Optional[str] = "manual"
    extra: Optional[dict] = Field(default_factory=dict)

    @field_validator("email", "campaign_id", "assigned_agent_id", mode="before")
    @classmethod
    def empty_str_to_none(cls, v):
        if isinstance(v, str) and not v.strip():
            return None
        return v


class LeadAssign(BaseModel):
    lead_ids: list[str]
    agent_id: Optional[str] = None
    assigned_agent_id: Optional[str] = None
    supervisor_id: Optional[str] = None
    pool_id: Optional[str] = None


class DispositionUpdate(BaseModel):
    status: str
    sub_disposition: Optional[str] = None
    notes: Optional[str] = None
    follow_up_at: Optional[Any] = None
    follow_up_date: Optional[Any] = None
    follow_up_time: Optional[str] = None


class CallStart(BaseModel):
    lead_id: str
    direction: CallDirection


class CallEnd(BaseModel):
    call_id: str
    outcome: str
    duration_seconds: Optional[int] = 0
    notes: Optional[str] = None
    ai_summary: Optional[str] = None
    transcript: Optional[str] = None


class LeaveRequestCreate(BaseModel):
    reason: str
    start_date: datetime
    end_date: datetime


class LeaveDecision(BaseModel):
    approve: bool
    remarks: Optional[str] = None


class PoolTransferRequestPayload(BaseModel):
    agent_id: str
    target_pool_id: str
    reason: str


class PoolTransferDecisionPayload(BaseModel):
    approved: bool
    remarks: Optional[str] = None


class CallQualityEvaluation(BaseModel):
    coaching_notes: str
    ai_quality_score: int
    compliance_score: int
    sentiment: str


class AssignSupervisorPayload(BaseModel):
    supervisor_id: Optional[str] = None
    agent_ids: list[str]


class BulkAssignPoolPayload(BaseModel):
    pool_id: str
    user_ids: list[str]


class ManualDialPayload(BaseModel):
    phone: str
    name: Optional[str] = None
    pool_id: str
    language: str
    agent_assign_mode: str
    assigned_agent_id: Optional[str] = None
    priority: str
    notes: Optional[str] = None
    initiate_pstn: Optional[bool] = False
    idempotency_key: Optional[str] = None
    call_mode: Optional[str] = "human"


class VapiDialPayload(BaseModel):
    phone: str
    name: Optional[str] = None
    pool_id: Optional[str] = "general"
    assistant_id: Optional[str] = None
    phone_number_id: Optional[str] = None
    idempotency_key: Optional[str] = None


class ManualCallActionPayload(BaseModel):
    action: str


class ManualCallTransferPayload(BaseModel):
    target_agent_id: str


class ManualDTMFPayload(BaseModel):
    digit: str


class ManualConferencePayload(BaseModel):
    invitee_agent_id: str


class AIAgentCreate(BaseModel):
    name: str
    voice_model: Optional[str] = "Neural-Female-IN"
    language: Optional[str] = "English"
    status: Optional[str] = "online"
    is_active: Optional[bool] = True
    system_prompt: Optional[str] = "You are a professional customer care AI assistant for Forge India Connect."
    concurrency_limit: Optional[int] = 5
    temperature: Optional[float] = 0.7
    max_call_duration_seconds: Optional[int] = 300
    description: Optional[str] = None
    assigned_pool_id: Optional[str] = None


class AIAgentUpdate(BaseModel):
    name: Optional[str] = None
    voice_model: Optional[str] = None
    language: Optional[str] = None
    status: Optional[str] = None
    is_active: Optional[bool] = None
    system_prompt: Optional[str] = None
    concurrency_limit: Optional[int] = None
    temperature: Optional[float] = None
    max_call_duration_seconds: Optional[int] = None
    description: Optional[str] = None
    assigned_pool_id: Optional[str] = None


class InboundACDPayload(BaseModel):
    phone: str
    name: Optional[str] = None
    pool_id: Optional[str] = "banking_customer_care"
    require_agent: Optional[bool] = True
    auto_answer: Optional[bool] = True


class CallDispositionPayload(BaseModel):
    disposition: str
    notes: Optional[str] = None
    follow_up_date: Optional[str] = None
    follow_up_time: Optional[str] = None
    rating: Optional[int] = 5


class FollowUpCreate(BaseModel):
    customer_id: Optional[str] = None
    lead_id: Optional[str] = None
    customer_name: Optional[str] = None
    customer_phone: str
    agent_id: Optional[str] = None
    pool_id: Optional[str] = None
    follow_up_datetime: str  # ISO string or YYYY-MM-DD HH:MM
    reason: Optional[str] = "Customer Callback Request"
    notes: Optional[str] = None
    time_zone: Optional[str] = "Asia/Kolkata"
    priority: Optional[str] = "medium"  # low, medium, high, urgent
    call_id: Optional[str] = None


class FollowUpUpdate(BaseModel):
    follow_up_datetime: Optional[str] = None
    reason: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[str] = None  # scheduled, due, completed, missed, cancelled
    reschedule_reason: Optional[str] = None
    priority: Optional[str] = None
    agent_id: Optional[str] = None
    pool_id: Optional[str] = None


class FollowUpComplete(BaseModel):
    call_id: Optional[str] = None
    outcome: Optional[str] = "completed"
    notes: Optional[str] = None
    disposition: Optional[str] = None







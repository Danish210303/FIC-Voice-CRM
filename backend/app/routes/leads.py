import io
import math
import re
from typing import Optional
# pyrefly: ignore [missing-import]
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query, status
# pyrefly: ignore [missing-import]
from bson import ObjectId
# pyrefly: ignore [missing-import]
from pydantic import BaseModel, Field
from app.core.database import leads_col, imports_col, audit_logs_col, users_col
from app.core.utils import gen_lead_id, gen_import_id, utcnow, oid_str
from app.core.deps import require_roles, get_current_user
from app.schemas.common import LeadCreate, LeadAssign, DispositionUpdate, Role, LeadStatus
from app.services.ws_manager import ws_manager
from app.services.follow_up_service import create_or_update_lead_follow_up, parse_datetime_to_utc

router = APIRouter(prefix="/api/leads", tags=["leads"])


class LeadImportProcessPayload(BaseModel):
    pool_id: str
    campaign_id: Optional[str] = None
    supervisor_id: Optional[str] = None
    agent_id: Optional[str] = None
    mapping: dict
    rows: list[dict]
    duplicate_strategy: Optional[str] = "skip"  # "skip" or "update"


class LeadBulkStatus(BaseModel):
    lead_ids: list[str]
    status: str


def _uid(user: dict) -> str:
    return user.get("id") or str(user["_id"])


def normalize_phone(phone_str: str) -> str:
    if not phone_str:
        return ""
    cleaned = str(phone_str).strip()
    digits = re.sub(r"\D", "", cleaned)
    if not digits:
        return ""
    if len(digits) == 10 and digits[0] in "6789":
        return f"+91{digits}"
    if len(digits) == 12 and digits.startswith("91") and digits[2] in "6789":
        return f"+{digits}"
    if len(digits) == 11 and digits.startswith("0") and digits[1] in "6789":
        return f"+91{digits[1:]}"
    if cleaned.startswith("+"):
        return f"+{digits}"
    return f"+91{digits}"


def is_valid_phone(phone_str: str) -> bool:
    normalized = normalize_phone(phone_str)
    return bool(re.match(r"^\+91[6-9]\d{9}$", normalized))


def is_valid_email(email_str: str) -> bool:
    if not email_str:
        return False
    email_str = str(email_str).strip()
    pattern = r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$"
    return bool(re.match(pattern, email_str))


@router.post("", status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_roles(Role.ADMIN, Role.TEAM_LEADER, Role.AGENT))])
async def create_lead(payload: LeadCreate, user: dict = Depends(get_current_user)):
    normalized = normalize_phone(payload.phone)
    if not normalized or not is_valid_phone(normalized):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid Indian phone number. Must start with 6, 7, 8, or 9 and be 10 digits.")

    print(f"[MANUAL] phone normalized: success ({normalized})")

    existing = await leads_col.find_one({"phone": normalized})
    if existing:
        print(f"[MANUAL] lead lookup: found ({existing.get('lead_id')})")
        print(f"[MANUAL] assigned lead sync: success")
        return oid_str(existing)

    print("[MANUAL] lead lookup: not-found")

    if payload.email:
        email_clean = str(payload.email).strip().lower()
        if not is_valid_email(email_clean):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid email format")

    doc = payload.model_dump()
    doc["phone"] = normalized
    if doc.get("email"):
        doc["email"] = doc["email"].strip().lower()

    effective_pool = user.get("pool_id") or payload.pool_id or "6a6b40b7841e208e1cb69469"
    doc["pool_id"] = effective_pool
    doc["lead_id"] = gen_lead_id()
    doc["status"] = LeadStatus.NEW.value if hasattr(LeadStatus.NEW, "value") else "new"
    doc["source"] = payload.source or "Manual Dialer"
    doc["created_by"] = _uid(user)
    doc["created_at"] = utcnow()
    doc["updated_at"] = utcnow()
    doc["ai_score"] = doc.get("ai_score") or 85

    uid = _uid(user)
    doc["assigned_agent_id"] = payload.assigned_agent_id or uid
    doc["supervisor_id"] = user.get("supervisor_id") or (uid if user.get("role") == Role.TEAM_LEADER else None)
    doc["agent_id"] = uid
    doc["agent_name"] = user.get("name")
    doc["branch_id"] = user.get("branch_id") or "HQ"
    doc["role"] = user.get("role")
    doc["timestamp"] = doc["created_at"]

    actor_role = (user.get("role") or "System").replace("_", " ").title()
    actor_name = user.get("name") or user.get("email") or "System Automation"
    init_history_entry = {
        "timestamp": utcnow(),
        "action": "Created in CRM",
        "actor": f"{actor_name} ({actor_role})",
        "notes": f"Source: {payload.source or 'Manual Dialer'}"
    }
    doc["history"] = [init_history_entry]

    result = await leads_col.insert_one(doc)
    doc["_id"] = result.inserted_id

    print(f"[MANUAL] lead created: {doc['lead_id']}")
    print(f"[MANUAL] assigned lead sync: success")

    await audit_logs_col.insert_one({
        "action": "create_lead",
        "user_id": uid,
        "lead_id": doc["lead_id"],
        "lead_name": doc["name"],
        "timestamp": utcnow()
    })

    await ws_manager.broadcast("global", {
        "event": "leads_updated",
        "type": "lead_activity_updated",
        "data": {
            "lead_id": str(doc["_id"]),
            "lead_code": doc["lead_id"],
            "history_entry": init_history_entry,
            "status": LeadStatus.NEW
        }
    })
    return oid_str(doc)


@router.post("/upload-preview", dependencies=[Depends(require_roles(Role.ADMIN, Role.TEAM_LEADER))])
async def upload_preview(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No file provided for upload.")

    filename_lower = file.filename.lower()
    if not filename_lower.endswith((".csv", ".xlsx", ".xls")):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Invalid file type. Please upload a valid CSV file (.csv) or Excel spreadsheet (.xlsx, .xls)."
        )

    content = await file.read()
    if not content or len(content.strip()) == 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The uploaded file is empty. Please select a valid CSV file with data.")

    try:
        import pandas as pd
        if filename_lower.endswith(".csv"):
            df = pd.read_csv(io.BytesIO(content), dtype=str)
        else:
            df = pd.read_excel(io.BytesIO(content), dtype=str)
    except Exception as e:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Invalid CSV format or unable to parse file: {str(e)}"
        )

    if df.empty:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The uploaded file contains no data rows.")

    headers = [str(col).strip() for col in df.columns if str(col).strip() and not str(col).startswith("Unnamed:")]
    if not headers:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Missing headers in CSV file. Please upload a file with header columns.")

    # Smart header alias mapping
    suggested = {}
    for h in headers:
        hl = h.lower().replace("_", " ").replace("-", " ").strip()
        if not suggested.get("name") and any(k in hl for k in ["name", "full name", "customer name", "lead name", "client name"]):
            suggested["name"] = h
        elif not suggested.get("phone") and any(k in hl for k in ["phone", "mobile", "contact", "ph", "cell", "tel"]):
            suggested["phone"] = h
        elif not suggested.get("email") and any(k in hl for k in ["email", "mail", "e mail"]):
            suggested["email"] = h
        elif not suggested.get("location") and any(k in hl for k in ["location", "city", "state", "address", "district"]):
            suggested["location"] = h
        elif not suggested.get("language") and any(k in hl for k in ["lang", "language", "mother tongue"]):
            suggested["language"] = h

    df_clean = df.where(pd.notnull(df), None)
    all_rows = df_clean.to_dict(orient="records")

    # Evaluate validation preview on rows
    name_col = suggested.get("name")
    phone_col = suggested.get("phone")

    valid_count = 0
    invalid_count = 0
    duplicate_in_file = 0
    seen_phones = set()
    rows_with_status = []

    for idx, row in enumerate(all_rows):
        name_val = str(row.get(name_col) or "").strip() if name_col else ""
        phone_val = str(row.get(phone_col) or "").strip() if phone_col else ""
        norm_phone = normalize_phone(phone_val)

        row_errors = []
        if not name_val:
            row_errors.append("Missing Name")
        if not phone_val:
            row_errors.append("Missing Phone")
        elif not is_valid_phone(phone_val):
            row_errors.append("Invalid Indian Phone")

        status_flag = "valid"
        if row_errors:
            status_flag = "invalid"
            invalid_count += 1
        elif norm_phone in seen_phones:
            status_flag = "duplicate"
            duplicate_in_file += 1
        else:
            seen_phones.add(norm_phone)
            valid_count += 1

        rows_with_status.append({
            "index": idx + 1,
            "raw": row,
            "parsed_name": name_val,
            "parsed_phone": norm_phone or phone_val,
            "status": status_flag,
            "errors": row_errors
        })

    return {
        "headers": headers,
        "suggested_mapping": suggested,
        "total_records": len(all_rows),
        "valid_count": valid_count,
        "invalid_count": invalid_count,
        "duplicate_in_file": duplicate_in_file,
        "preview_rows": rows_with_status[:100],
        "all_rows": all_rows
    }


@router.post("/import-process", dependencies=[Depends(require_roles(Role.ADMIN, Role.TEAM_LEADER))])
async def import_process(payload: LeadImportProcessPayload, user: dict = Depends(get_current_user)):
    mapping = payload.mapping
    rows = payload.rows
    pool_id = payload.pool_id
    campaign_id = payload.campaign_id
    supervisor_id = payload.supervisor_id
    agent_id = payload.agent_id
    duplicate_strategy = (payload.duplicate_strategy or "skip").lower()

    if not pool_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Target lead pool selection is required.")

    import_id = gen_import_id()
    inserted_leads = []
    updated_leads_count = 0
    skipped_duplicates = 0
    skipped_invalid = 0
    total_processed = 0

    name_col = mapping.get("name")
    phone_col = mapping.get("phone")
    email_col = mapping.get("email")
    location_col = mapping.get("location")
    language_col = mapping.get("language")

    if not name_col or not phone_col:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "CSV mapping must assign Name and Phone columns.")

    # Deduplicate phones in batch query
    for row in rows:
        name_val = str(row.get(name_col) or "").strip()
        phone_val = str(row.get(phone_col) or "").strip()
        email_val = str(row.get(email_col) or "").strip() if email_col else ""
        location_val = str(row.get(location_col) or "").strip() if location_col else ""
        language_val = (
            str(row.get(language_col) or "").strip()
            if language_col
            else "English"
        )
        language_val = language_val or "English"

        if not name_val and not phone_val:
            continue

        total_processed += 1

        normalized_phone = normalize_phone(phone_val)
        if not name_val or not normalized_phone or not is_valid_phone(normalized_phone):
            skipped_invalid += 1
            continue

        email_clean = email_val.lower() if email_val else None
        if email_clean and not is_valid_email(email_clean):
            skipped_invalid += 1
            continue

        # Check existing lead in DB
        or_conditions = [{"phone": normalized_phone}]
        if email_clean:
            or_conditions.append({"email": email_clean})

        duplicate = await leads_col.find_one({
            "$or": or_conditions,
            "pool_id": pool_id
        })

        if duplicate:
            if duplicate_strategy == "update":
                update_doc = {
                    "name": name_val,
                    "updated_at": utcnow()
                }
                if email_clean:
                    update_doc["email"] = email_clean
                if location_val:
                    update_doc["location"] = location_val
                if language_val:
                    update_doc["language"] = language_val
                if campaign_id:
                    update_doc["campaign_id"] = campaign_id
                if supervisor_id:
                    update_doc["supervisor_id"] = supervisor_id
                if agent_id:
                    update_doc["assigned_agent_id"] = agent_id

                await leads_col.update_one({"_id": duplicate["_id"]}, {"$set": update_doc})
                updated_leads_count += 1
            else:
                skipped_duplicates += 1
            continue

        lead_doc = {
            "name": name_val,
            "phone": normalized_phone,
            "email": email_clean,
            "location": location_val or None,
            "language": language_val,
            "lead_id": gen_lead_id(),
            "pool_id": pool_id,
            "campaign_id": campaign_id or None,
            "supervisor_id": supervisor_id or None,
            "assigned_agent_id": agent_id or None,
            "source": "import",
            "status": LeadStatus.NEW,
            "created_by": _uid(user),
            "created_at": utcnow(),
            "ai_score": 85,
            "extra": {}
        }
        
        inserted_leads.append(lead_doc)

    inserted_count = 0
    if inserted_leads:
        result = await leads_col.insert_many(inserted_leads)
        inserted_count = len(result.inserted_ids)

    report_doc = {
        "import_id": import_id,
        "filename": "Imported CSV Records",
        "pool_id": pool_id,
        "campaign_id": campaign_id,
        "supervisor_id": supervisor_id,
        "agent_id": agent_id,
        "total_processed": total_processed,
        "inserted": inserted_count,
        "updated": updated_leads_count,
        "skipped_duplicates": skipped_duplicates,
        "skipped_invalid": skipped_invalid,
        "created_by": _uid(user),
        "created_at": utcnow()
    }
    await imports_col.insert_one(report_doc)

    await audit_logs_col.insert_one({
        "action": "import_leads",
        "user_id": _uid(user),
        "import_id": import_id,
        "inserted_count": inserted_count,
        "updated_count": updated_leads_count,
        "timestamp": utcnow()
    })

    await ws_manager.broadcast("global", {"event": "leads_updated"})

    return {
        "success": True,
        "import_id": import_id,
        "total": total_processed,
        "imported": inserted_count,
        "updated": updated_leads_count,
        "duplicates": skipped_duplicates,
        "failed": skipped_invalid,
        "skipped_duplicates": skipped_duplicates,
        "skipped_invalid": skipped_invalid
    }


@router.post("/assign", dependencies=[Depends(require_roles(Role.ADMIN, Role.TEAM_LEADER))])
@router.patch("/assign", dependencies=[Depends(require_roles(Role.ADMIN, Role.TEAM_LEADER))])
@router.post("/bulk-assign", dependencies=[Depends(require_roles(Role.ADMIN, Role.TEAM_LEADER))])
@router.patch("/bulk-assign", dependencies=[Depends(require_roles(Role.ADMIN, Role.TEAM_LEADER))])
async def assign_leads(payload: LeadAssign, user: dict = Depends(get_current_user)):
    lead_ids = payload.lead_ids or []
    if not lead_ids:
        return {"assigned_count": 0}

    target_agent_id = (payload.agent_id or payload.assigned_agent_id or "").strip()

    or_conditions = []
    oid_list = [ObjectId(i) for i in lead_ids if ObjectId.is_valid(i)]
    if oid_list:
        or_conditions.append({"_id": {"$in": oid_list}})
    or_conditions.append({"_id": {"$in": lead_ids}})
    or_conditions.append({"lead_id": {"$in": lead_ids}})
    or_conditions.append({"id": {"$in": lead_ids}})

    db_query = {"$or": or_conditions}

    supervisor_id = payload.supervisor_id
    agent_name = None
    if target_agent_id:
        agent_oid = ObjectId(target_agent_id) if ObjectId.is_valid(target_agent_id) else None
        agent = await users_col.find_one({"_id": agent_oid}) if agent_oid else await users_col.find_one({"id": target_agent_id}) or await users_col.find_one({"employee_id": target_agent_id})
        if agent:
            supervisor_id = supervisor_id or agent.get("supervisor_id")
            agent_name = agent.get("name")
            target_agent_id = str(agent.get("_id") or agent.get("id"))

    update_doc = {
        "assigned_agent_id": target_agent_id or None,
        "agent_id": target_agent_id or None,
        "agent_name": agent_name,
        "assigned_at": utcnow(),
        "updated_at": utcnow()
    }
    if supervisor_id:
        update_doc["supervisor_id"] = supervisor_id
    if payload.pool_id:
        update_doc["pool_id"] = payload.pool_id

    actor_role = (user.get("role") or "User").replace("_", " ").title()
    actor_name = user.get("name") or "Supervisor"
    assign_history_entry = {
        "timestamp": utcnow(),
        "action": f"Assigned to {agent_name or target_agent_id or 'Agent'}",
        "actor": f"{actor_name} ({actor_role})",
        "notes": f"Pool: {payload.pool_id}" if payload.pool_id else "Lead assignment"
    }

    result = await leads_col.update_many(
        db_query,
        {
            "$set": update_doc,
            "$push": {
                "history": {
                    "$each": [assign_history_entry],
                    "$position": 0
                }
            }
        }
    )

    updated_docs = await leads_col.find(db_query, {"_id": 1, "id": 1, "lead_id": 1}).to_list(length=2000)
    updated_id_set = set()
    for d in updated_docs:
        updated_id_set.add(str(d["_id"]))
        if d.get("id"): updated_id_set.add(str(d["id"]))
        if d.get("lead_id"): updated_id_set.add(str(d["lead_id"]))

    failed_lead_ids = [lid for lid in lead_ids if lid not in updated_id_set]

    await audit_logs_col.insert_one({
        "action": "assign_leads",
        "user_id": _uid(user),
        "agent_id": target_agent_id,
        "count": result.modified_count,
        "timestamp": utcnow()
    })

    await ws_manager.broadcast("global", {
        "event": "leads_updated",
        "type": "lead_activity_updated",
        "data": {
            "lead_ids": list(updated_id_set),
            "history_entry": assign_history_entry
        }
    })
    return {
        "status": "success",
        "assigned_count": result.modified_count,
        "success_count": len(updated_docs),
        "failed_count": len(failed_lead_ids),
        "failed_lead_ids": failed_lead_ids
    }


@router.post("/bulk-status", dependencies=[Depends(require_roles(Role.ADMIN, Role.TEAM_LEADER, Role.AGENT))])
@router.patch("/bulk-status", dependencies=[Depends(require_roles(Role.ADMIN, Role.TEAM_LEADER, Role.AGENT))])
async def bulk_status_leads(payload: LeadBulkStatus, user: dict = Depends(get_current_user)):
    lead_ids = payload.lead_ids
    if not lead_ids:
        return {"updated_count": 0}

    or_conditions = []
    oid_list = [ObjectId(i) for i in lead_ids if ObjectId.is_valid(i)]
    if oid_list:
        or_conditions.append({"_id": {"$in": oid_list}})
    or_conditions.append({"_id": {"$in": lead_ids}})
    or_conditions.append({"lead_id": {"$in": lead_ids}})
    or_conditions.append({"id": {"$in": lead_ids}})

    db_query = {"$or": or_conditions}
    if user.get("role") == Role.AGENT:
        uid = _uid(user)
        owner_condition = {"$or": [{"assigned_agent_id": uid}, {"created_by": uid}, {"assigned_agent_id": None}, {"assigned_agent_id": ""}]}
        db_query = {"$and": [db_query, owner_condition]}

    result = await leads_col.update_many(
        db_query,
        {
            "$set": {
                "status": payload.status,
                "updated_at": utcnow()
            }
        },
    )

    await audit_logs_col.insert_one({
        "action": "bulk_status_leads",
        "user_id": _uid(user),
        "status": payload.status,
        "count": result.modified_count,
        "timestamp": utcnow()
    })

    await ws_manager.broadcast("global", {"event": "leads_updated"})
    return {"updated_count": result.modified_count}

@router.get("")
async def list_leads(
    user: dict = Depends(get_current_user),
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=100),
    search: str | None = None,
    pool_id: str | None = None,
    status_filter: str | None = None,
    campaign_id: str | None = None,
    agent_id: str | None = None,
    paginate: bool = Query(True)
):
    query = {}
    uid = _uid(user)
    
    if user["role"] == Role.AGENT:
        query["$or"] = [
            {"assigned_agent_id": uid},
            {"agent_id": uid},
            {"created_by": uid}
        ]
    elif user["role"] == Role.TEAM_LEADER:
        query["$or"] = [
            {"supervisor_id": uid},
            {"pool_id": user.get("pool_id")},
            {"assigned_agent_id": uid},
            {"created_by": uid}
        ]
        
    if pool_id:
        query["pool_id"] = pool_id
    if status_filter:
        query["status"] = status_filter
    if campaign_id:
        query["campaign_id"] = campaign_id
    if agent_id:
        query["assigned_agent_id"] = agent_id

    if search and search.strip():
        search_term = search.strip()
        regex_query = {"$regex": re.escape(search_term), "$options": "i"}
        search_conditions = [
            {"name": regex_query},
            {"phone": regex_query},
            {"email": regex_query},
            {"lead_id": regex_query}
        ]
        if "$or" in query:
            query = {"$and": [query, {"$or": search_conditions}]}
        else:
            query["$or"] = search_conditions

    total = await leads_col.count_documents(query)
    skip = (page - 1) * limit
    total_pages = math.ceil(total / limit) if total > 0 else 1

    leads = []
    projection = {
        "name": 1, "phone": 1, "email": 1, "status": 1,
        "lead_id": 1, "pool_id": 1, "campaign_id": 1, "assigned_agent_id": 1,
        "location": 1, "language": 1, "created_at": 1, "last_note": 1,
        "sub_disposition": 1, "ai_score": 1
    }

    if not paginate:
        async for l in leads_col.find(query, projection).sort("created_at", -1).limit(200):
            leads.append(oid_str(l))
        return leads

    async for l in leads_col.find(query, projection).sort("created_at", -1).skip(skip).limit(limit):
        leads.append(oid_str(l))

    return {
        "items": leads,
        "page": page,
        "limit": limit,
        "total": total,
        "totalPages": total_pages
    }


@router.get("/imports", dependencies=[Depends(require_roles(Role.ADMIN, Role.TEAM_LEADER))])
async def list_imports():
    imports = []
    async for imp in imports_col.find({}).sort("created_at", -1):
        imports.append(oid_str(imp))
    return imports


@router.patch("/{lead_id}/disposition", dependencies=[Depends(require_roles(Role.AGENT, Role.TEAM_LEADER, Role.ADMIN))])
@router.patch("/{lead_id}", dependencies=[Depends(require_roles(Role.AGENT, Role.TEAM_LEADER, Role.ADMIN))])
@router.patch("/{lead_id}/status", dependencies=[Depends(require_roles(Role.AGENT, Role.TEAM_LEADER, Role.ADMIN))])
async def update_disposition(lead_id: str, payload: DispositionUpdate, user: dict = Depends(get_current_user)):
    query = {"_id": ObjectId(lead_id)} if ObjectId.is_valid(lead_id) else {"lead_id": lead_id}
    lead = await leads_col.find_one(query)
    if not lead:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Lead '{lead_id}' not found")

    uid = _uid(user)
    if user.get("role") == Role.AGENT:
        is_owner = (
            (lead.get("assigned_agent_id") == uid)
            or (lead.get("created_by") == uid)
            or (not lead.get("assigned_agent_id"))
        )
        if not is_owner:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have permission to update this lead")

    actor_role = (user.get("role") or "User").replace("_", " ").title()
    actor_name = user.get("name") or user.get("email") or "Agent"
    norm_status = (payload.status or "in_progress").lower().strip()
    status_label = norm_status.replace("_", " ").title()

    follow_up_input = payload.follow_up_date or payload.follow_up_at
    fu_time_str = None
    if follow_up_input:
        fu_date_val = str(follow_up_input).strip()
        fu_time_val = (payload.follow_up_time or "").strip()
        if fu_time_val and fu_time_val not in fu_date_val:
            fu_time_str = f"{fu_date_val} {fu_time_val}".strip()
        else:
            fu_time_str = fu_date_val
    elif norm_status in ["follow_up", "follow_up_required", "call_back"]:
        fu_time_str = (utcnow() + timedelta(hours=24)).strftime("%Y-%m-%d %H:%M")

    fu_record = None
    if fu_time_str or norm_status in ["follow_up", "follow_up_required", "call_back"]:
        try:
            fu_record = await create_or_update_lead_follow_up(
                lead_id=str(lead.get("_id")),
                phone=lead.get("phone"),
                agent_id=uid,
                follow_up_time_str=fu_time_str,
                reason=payload.notes or f"Follow-up scheduled ({status_label})",
                notes=payload.notes or "",
                current_user_id=uid
            )
        except Exception as e:
            pass

    history_entry = {
        "timestamp": utcnow(),
        "action": f"Disposition Updated to {status_label}",
        "actor": f"{actor_name} ({actor_role})",
        "notes": payload.notes or (f"Follow-up: {fu_time_str}" if fu_time_str else "Status change")
    }

    update = {"status": norm_status, "updated_at": utcnow()}
    if payload.sub_disposition:
        update["sub_disposition"] = payload.sub_disposition
    if payload.notes:
        update["last_note"] = payload.notes
    if fu_time_str:
        update["follow_up_at"] = fu_time_str
        update["follow_up_date"] = fu_time_str
    if fu_record and fu_record.get("id"):
        update["follow_up_id"] = fu_record["id"]
        
    await leads_col.update_one(
        query,
        {
            "$set": update,
            "$push": {
                "history": {
                    "$each": [history_entry],
                    "$position": 0
                }
            }
        }
    )

    await audit_logs_col.insert_one({
        "action": "update_disposition",
        "user_id": uid,
        "lead_id": lead_id,
        "status": norm_status,
        "timestamp": utcnow()
    })

    await ws_manager.broadcast("global", {
        "event": "leads_updated",
        "type": "lead_activity_updated",
        "data": {
            "lead_id": str(lead.get("_id")),
            "lead_code": lead.get("lead_id"),
            "history_entry": history_entry,
            "status": norm_status,
            "follow_up": fu_record
        }
    })
    return {"status": "updated", "lead_status": norm_status, "follow_up": fu_record}


@router.get("/{lead_id}")
async def get_lead(lead_id: str, user: dict = Depends(get_current_user)):
    query = {"_id": ObjectId(lead_id)} if ObjectId.is_valid(lead_id) else {"lead_id": lead_id}
    lead = await leads_col.find_one(query)
    if not lead:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Lead '{lead_id}' not found")
        
    if user.get("role") == Role.AGENT:
        uid = _uid(user)
        is_owner = (lead.get("assigned_agent_id") == uid) or (lead.get("created_by") == uid)
        if not is_owner:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Access to this lead is restricted")

    return oid_str(lead)


@router.delete("/{lead_id}", dependencies=[Depends(require_roles(Role.ADMIN, Role.TEAM_LEADER))])
async def delete_lead(lead_id: str, user: dict = Depends(get_current_user)):
    """Permanently delete a lead document from MongoDB by ObjectId or lead_id string."""
    if not lead_id or not lead_id.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Lead ID parameter is required."
        )

    clean_id = lead_id.strip()

    # Validate ObjectId or lead_id pattern
    query = {}
    if ObjectId.is_valid(clean_id):
        query = {"$or": [{"_id": ObjectId(clean_id)}, {"lead_id": clean_id}]}
    else:
        query = {"lead_id": clean_id}

    try:
        lead = await leads_col.find_one(query)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid lead identifier: {str(e)}"
        )

    if not lead:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Lead with ID '{clean_id}' not found in database."
        )

    try:
        result = await leads_col.delete_one({"_id": lead["_id"]})
        if result.deleted_count == 0:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to delete lead document from MongoDB."
            )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database server error while deleting lead: {str(e)}"
        )

    # Audit Log
    try:
        await audit_logs_col.insert_one({
            "action": "delete_lead",
            "user_id": _uid(user),
            "lead_id": str(lead.get("_id")),
            "lead_code": lead.get("lead_id"),
            "lead_name": lead.get("name"),
            "timestamp": utcnow()
        })
    except Exception as e:
        print(f"Warning: Audit log insertion failed: {e}")

    # Broadcast WebSocket event
    try:
        await ws_manager.broadcast("global", {"event": "leads_updated"})
    except Exception as e:
        print(f"Warning: WebSocket broadcast failed: {e}")

    return {
        "status": "success",
        "detail": "Lead deleted successfully.",
        "deleted_id": str(lead.get("_id")),
        "lead_code": lead.get("lead_id")
    }


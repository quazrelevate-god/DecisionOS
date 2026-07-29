# DecisionOS — UML & Architecture Diagrams

All diagrams are **Mermaid**. They render automatically on GitHub, VS Code (Mermaid ext),
Obsidian, or paste into <https://mermaid.live>. Companion doc: **`SYSTEM_DESIGN.md`**.

Contents:
1. System / Component Architecture (C4‑style)
2. Deployment Diagram
3. Data Model (ER Diagram) — multi‑tenant, shared collections
4. Domain Class Diagram
5. Sequence — Company Provisioning (per‑tenant "schema" creation)
6. Sequence — Multi‑input Capture → Decision → Tasks (with vision + multi‑page)
7. State — Decision & Task lifecycle
8. RBAC / Request authorization flow

---

## 1. System / Component Architecture

```mermaid
flowchart TB
  subgraph Client["Browser / Mobile Web (React SPA)"]
    UI["React + Tailwind + shadcn/ui\nDecision Desk · My Work · CEO Brief\nCompany Brain · Ledger · People · Admin"]
  end

  subgraph Edge["Kubernetes Ingress"]
    ING["/api/* -> backend:8001\n/* -> frontend:3000"]
  end

  subgraph Backend["FastAPI (async, Supervisor)"]
    API["REST API (/api)\nauth · voice-notes · decisions · tasks\nworkflows · ledger · leaves · admin"]
    BG["BackgroundTasks\nprocess_voice_note · scheduler\n(CEO brief, follow-ups, outage alerts)"]
    CORE["core.py\nRBAC · tenant contextvar\nclaude_chat resilient wrapper"]
    OBJ["obj_store.py client"]
  end

  subgraph Data["Stateful services"]
    MONGO[("MongoDB\n(Motor async)\nshared collections, tenant_id scoped")]
    OS[("Emergent Object Storage\ndecisionos/{tenant_id}/{file_id}")]
  end

  subgraph AI["AI Providers"]
    CLA["Anthropic Claude\n(reasoning/structuring)"]
    OAI["OpenAI gpt-4o-transcribe\n(speech->text)"]
    GEM["Google Gemini 2.5 Flash\n(vision: invoices + general read)"]
    EMK["Emergent Universal Key\n(auto-fallback)"]
  end

  WA["Meta / WhatsApp Cloud API\n(webhook)"]

  UI -->|HTTPS + HttpOnly cookie| ING --> API
  API --> CORE
  API <--> MONGO
  API --> OBJ --> OS
  API --> BG
  BG <--> MONGO
  API --> CLA & OAI & GEM
  CLA -. on failure .-> EMK
  GEM -. on failure .-> EMK
  WA -->|inbound msg/media| API
```

---

## 2. Deployment Diagram

```mermaid
flowchart LR
  subgraph K8s["Kubernetes Pod / Cluster"]
    subgraph FE["frontend (supervisor)"]
      R["React dev/build server :3000"]
    end
    subgraph BE["backend (supervisor)"]
      U["Uvicorn / FastAPI :8001"]
    end
    M[("MongoDB\nMONGO_URL / DB_NAME")]
  end

  USER([Founder / Team member]) -->|HTTPS| INGRESS[Ingress / REACT_APP_BACKEND_URL]
  INGRESS --> R
  INGRESS -->|/api| U
  U --> M
  U -->|HTTPS| OBJ[(Emergent Object Storage)]
  U -->|HTTPS| PROV[Anthropic / OpenAI / Gemini / Emergent]
  WA[WhatsApp Cloud API] -->|webhook /api| U
```

---

## 3. Data Model — ER Diagram (row‑level multi‑tenancy)

> No per‑company tables. All entities share collections and are linked by `tenant_id`.
> `TENANT` is the per‑company configuration ("the schema").

```mermaid
erDiagram
  TENANT ||--o{ USER : "has members"
  TENANT ||--o{ DECISION : ""
  TENANT ||--o{ TASK : ""
  TENANT ||--o{ WORKFLOW : ""
  TENANT ||--o{ CONTACT : ""
  TENANT ||--o{ FILE : ""
  TENANT ||--o{ MEMORY : ""
  TENANT ||--o{ VOICE_NOTE : ""
  TENANT ||--o{ LEDGER_RECORD : ""
  TENANT ||--o{ LEAVE : ""
  TENANT ||--o{ USAGE_EVENT : ""

  VOICE_NOTE ||--o| DECISION : "structures into"
  DECISION ||--o{ TASK : "spawns"
  DECISION ||--o{ WORKFLOW : "materializes"
  TASK ||--o{ FILE : "attachments (reference/evidence)"
  CONTACT ||--o{ WORKFLOW : "counterparty"
  USER ||--o{ TASK : "assignee"

  TENANT {
    string id PK
    string name
    string industry
    string description
    string currency
    json   roles "RBAC departments"
    json   operating_model "pipelines + task_categories"
    json   lexicon "customer/vendor vocabulary"
    json   approval_rules
    bool   suspended
  }
  USER {
    string id PK
    string tenant_id FK
    string name
    string email UK
    string role
    json   permissions
    string language
  }
  VOICE_NOTE {
    string id PK
    string tenant_id FK
    string kind "audio|text|file"
    string transcript
    json   reference_file_ids
    string status
    string decision_id FK
    json   execution_summary
  }
  DECISION {
    string id PK
    string tenant_id FK
    string title
    string status "pending_approval|approved|rejected"
    json   task_ids
    json   workflow_events
    json   timeline
  }
  TASK {
    string id PK
    string tenant_id FK
    string decision_id FK
    string title
    string assignee_id FK
    string assignee_role
    string status
    bool   evidence_required
    json   attachments
    json   reference_insights
    json   execution_plan
  }
  WORKFLOW {
    string id PK
    string tenant_id FK
    string type
    string stage
    json   stages
    number amount
    string contact_id FK
  }
  FILE {
    string id PK
    string tenant_id FK
    string task_id FK
    string storage_path
    string content_type
    string kind "reference|evidence|photo|voice"
  }
  CONTACT { string id PK
    string tenant_id FK
    string type "customer|vendor"
    string name }
  MEMORY { string id PK
    string tenant_id FK
    string text
    string tag }
  LEDGER_RECORD { string id PK
    string tenant_id FK
    string kind "expense|asset|inventory|invoice|payment" }
  LEAVE { string id PK
    string tenant_id FK
    string status }
  USAGE_EVENT { string id PK
    string tenant_id FK
    string provider
    number cost_estimate }
```

---

## 4. Domain Class Diagram

```mermaid
classDiagram
  class Tenant {
    +str id
    +str name
    +str industry
    +Role[] roles
    +OperatingModel operating_model
    +Lexicon lexicon
    +ApprovalRule[] approval_rules
    +bool suspended
  }
  class OperatingModel {
    +Pipeline[] pipelines
    +TaskCategory[] task_categories
  }
  class Pipeline {
    +str key
    +str label
    +str approval_stage
    +Stage[] stages
  }
  class User {
    +str id
    +str tenant_id
    +str role
    +str[] permissions
    +str language
    +hasPerm(key) bool
  }
  class VoiceNote {
    +str id
    +str kind
    +str transcript
    +str[] reference_file_ids
    +str status
    +process() Decision
  }
  class Decision {
    +str id
    +str status
    +str[] task_ids
    +approve()
    +reject()
  }
  class Task {
    +str id
    +str status
    +bool evidence_required
    +Attachment[] attachments
    +complete()
    +uploadEvidence()
  }
  class Attachment {
    +str kind
    +str storage_path
    +str content_type
  }
  class Workflow {
    +str type
    +str stage
    +advance()
  }
  class AIService {
    +ai_extract(transcript, extra_context) Decision
    +ai_read_image_general(file) str
    +transcribe_audio(audio) str
    +claude_chat() ResilientChat
  }

  Tenant "1" o-- "many" User
  Tenant "1" o-- "1" OperatingModel
  OperatingModel "1" o-- "many" Pipeline
  User "1" --> "many" Task : assignee
  VoiceNote "1" --> "1" Decision : structures
  Decision "1" o-- "many" Task
  Decision "1" o-- "many" Workflow
  Task "1" o-- "many" Attachment
  VoiceNote ..> AIService : uses
  Decision ..> AIService : uses
```

---

## 5. Sequence — Company Provisioning ("per‑tenant schema" creation)

```mermaid
sequenceDiagram
  autonumber
  actor Founder
  participant FE as React (Onboarding)
  participant API as FastAPI
  participant Claude
  participant Mongo as MongoDB

  Founder->>FE: Enter company, industry, description
  FE->>API: POST /api/onboarding/os-blueprint {industry, description}
  API->>Claude: generate departments / workflows / approval rules
  Claude-->>API: OS blueprint (JSON)
  API-->>FE: blueprint (editable)
  Founder->>FE: Curate departments & submit
  FE->>API: POST /api/auth/register {company, blueprint, owner creds}
  API->>Claude: ai_generate_lexicon(industry, roles, desc)
  API->>Claude: ai_generate_operating_model(industry, roles, desc)
  Claude-->>API: lexicon + operating_model
  API->>Mongo: insert tenants {roles, operating_model, lexicon, templates}
  API->>Mongo: insert users {owner, bcrypt hash, role=owner}
  API-->>FE: Set-Cookie dos_token + {tenant, os_summary}
  Note over API,Mongo: No new DB/tables created.<br/>Company config lives in the tenants document;<br/>all future rows carry tenant_id.
```

---

## 6. Sequence — Multi‑input Capture → Decision → Tasks

```mermaid
sequenceDiagram
  autonumber
  actor Owner
  participant FE as Decision Desk
  participant API as FastAPI
  participant OS as Object Storage
  participant BG as BackgroundTask (process_voice_note)
  participant OAI as OpenAI STT
  participant GEM as Gemini Vision
  participant Claude
  participant Mongo as MongoDB

  Owner->>FE: Speak/Type + attach page(s) (e.g. card front+back)
  loop each attached file
    FE->>API: POST /api/files (kind=reference)
    API->>OS: put object
    API->>Mongo: insert files {storage_path, ...}
    API-->>FE: file_id
  end
  FE->>API: POST /api/voice-notes(/text) {audio|text, file_ids[]}
  API->>Mongo: insert voice_notes {status=queued}
  API->>BG: schedule process_voice_note(note_id)
  API-->>FE: {id, status=queued}  (UI shows "Thinking…", polls)

  BG->>OAI: transcribe (if audio)
  loop each file_id
    BG->>OS: get object
    BG->>GEM: ai_read_image_general(file) [general reader, not invoice-only]
    GEM-->>BG: plain text (names, phones, emails, rows…)
  end
  BG->>Claude: ai_extract(transcript, extra_context=all files)
  Claude-->>BG: {summary, decisions, tasks, workflow_events,…}
  BG->>Mongo: insert decision (pending_approval) + tasks (blocked) + workflows
  BG->>Mongo: attach reference file(s) to ALL tasks + execution_summary
  FE->>API: GET /api/voice-notes/{id} (poll) -> done
  FE-->>Owner: Execution Summary + Review & Approve card
  Owner->>API: POST /api/decisions/{id}/approve
  API->>Mongo: unblock tasks -> appear in assignees' My Work
```

---

## 7. State Diagrams — Decision & Task lifecycle

```mermaid
stateDiagram-v2
  direction LR
  [*] --> pending_approval : AI structured
  pending_approval --> approved : owner approves (tasks unblock)
  pending_approval --> rejected : owner rejects (spawned items removed)
  approved --> [*]
  rejected --> [*]
```

```mermaid
stateDiagram-v2
  direction LR
  [*] --> blocked : created from decision
  blocked --> todo : decision approved
  [*] --> todo : manual New Task
  todo --> in_progress
  in_progress --> waiting
  waiting --> in_progress
  in_progress --> review : needs approval
  review --> in_progress : changes requested
  in_progress --> done : proof required if evidence gated
  review --> done : approver approves
  done --> in_progress : reopen
  todo --> cancelled
```

---

## 8. RBAC / Request Authorization Flow

```mermaid
flowchart TD
  A[Incoming /api request] --> B{Cookie dos_token or Bearer?}
  B -- no --> R401[401 Unauthorized]
  B -- yes --> C[Decode JWT -> user_id, tenant_id, role]
  C --> D[Load user from Mongo]
  D --> E{User or Tenant suspended?}
  E -- yes --> R403[403 Forbidden]
  E -- no --> F[Set tenant contextvar for usage attribution]
  F --> G{Endpoint guard}
  G -->|require_role owner| H{role == owner?}
  G -->|require_perm key| I{owner OR key in permissions?}
  H -- no --> R403
  I -- no --> R403
  H -- yes --> Q[Handler runs scoped to tenant_id]
  I -- yes --> Q
  Q --> Z[Response - never leaks _id, tenant-scoped]
```

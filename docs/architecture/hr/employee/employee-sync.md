# Employee Sync

> Architecture reference for the HR employee sync pipeline.
> Source files: `apps/api/src/modules/hr/employee/employee-sync.parser.ts` and `employee-sync.service.ts`

---

## Overview

The sync ingests a fixed-width text report produced by the external HR system and upserts `Employee` records for a given branch. The process runs asynchronously via `JobService`.

Entry point: `EmployeeSyncService.sync()` → creates a job → calls `execute()`.

---

## File Format

The file is a fixed-width text report encoded in `latin1`. The first non-empty line containing the known header names defines the column layout; all subsequent lines with a numeric code in the `CODFUNC` column are treated as data.

### Columns

| Header | Field | Notes |
|--------|-------|-------|
| `CODFUNC` | `code` | Employee code — leading zeros stripped |
| `NOMEFUNC` | `fullName` | Full legal name |
| `SITUACAOFUNC` | `status` | `A` → `ACTIVE`, `F` → `ON_LEAVE`, `D` → `TERMINATED` |
| `SEXOFUNC` | `gender` | `M` → `MALE`, `F` → `FEMALE` |
| `DTADMFUNC` | `hireDate` | `DD/MM/YYYY` |
| `DTNASCTOFUNC` | `dateOfBirth` | `DD/MM/YYYY` |
| `CPFNUMERO` | `taxId` | 11-digit string, formatted as `XXX.XXX.XXX-XX` |
| `DESCFUNCAO` | `jobTitle` | Job description — parsed but not currently persisted |
| `APELIDOFUNC` | `preferredName` | Preferred name / nickname |

### Column extraction

Column boundaries are derived from the header line at runtime. For each known header name:

- **left boundary** = index where the header word starts in the header line
- **right boundary** = index where the *next* header word starts (last column uses `line.length`)

Each field is extracted as `line.substring(left, right).trim()`.

This approach handles all three alignment styles found in the report without positional hardcoding:

| Alignment | Example | Effect of trim |
|-----------|---------|----------------|
| Left-aligned | `NOMEFUNC` | removes trailing spaces |
| Right-aligned | `SITUACAOFUNC` | removes leading spaces |
| Data wider than header | `CPFNUMERO` (9 chars, CPF is 11 digits) | data extends into the gap before the next column; trim still yields the full value |

Unknown or extra columns in the header are ignored. Missing expected columns cause the field to be treated as empty.

---

## Sync Logic

```
for each row:
  if employee with code exists → update
  else → create

after loop:
  employees in this branch NOT in file → set status = TERMINATED
```

The branch scope (`branchId`) is provided at upload time and stored in the job input. Only employees belonging to that branch are considered for deactivation.

---

## Output

The job's `output` field contains:

```json
{
  "created":     3,
  "updated":     41,
  "deactivated": 2,
  "errors": [
    { "line": 14, "record": "10042", "message": "Unique constraint failed on taxId" }
  ]
}
```

Errors are non-fatal — the remaining rows continue to be processed.

---

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/hr/employee/sync/fields` | Returns form field metadata (`branchId`) for the sync modal |
| `POST` | `/hr/employee/sync` | Accepts `multipart/form-data` with `file` (`.txt`, max 10 MB) and `branchId`; returns `{ jobId }` |
| `GET` | `/core/job/:id` | Polls job status and output |

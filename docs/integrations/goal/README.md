# Goal (GoalBus)

> Reference for the Goal integration: what Goal is to nyx, how to reach its API and where each piece of knowledge lives.
> Goal is the vendor's system; nyx code that talks to it is documented in `docs/architecture/`.

---

## What Goal is to nyx

Goal (GoalBus, by Goal Systems) is the scheduling system the operation uses: it builds scenarios, logical schedules and daily schedules from a timetable offer. Nyx is where the planning is done and kept, so the data flows nyx → Goal, and Goal's results come back to nyx to be checked.

| Flow | Direction | How | Status |
|---|---|---|---|
| Timetable offer (service) | nyx → Goal | GTFS file, imported by hand — [gtfs-export.md](../../architecture/transit/gtfs-export.md) | In use |
| Idle matrix (matriz de ociosos) | nyx → Goal | CSV file, imported by hand — [osrm.md](../../architecture/transit/osrm.md#idle-matrix-export) | In use |
| Scenario validation (trips, vehicles, duties, balance) | Goal → nyx | API reads | Planned |
| Daily roster adjustment (compensation day off + reserve swap) | nyx ↔ Goal | API reads + writes | Depends on write access |

Goal leaves gaps the operation has to fill outside it: it has no hour bank, doesn't balance reserves against the bank, and its scenarios need checking against what was planned. Those analyses run in nyx even if the API stays read-only: reading is enough to validate and summarize.

---

## Files

| File | Content |
|---|---|
| `README.md` | This overview: environments, authentication, access status |
| [api.md](api.md) | Curated map of the API by use case: what each call is for, what nyx uses, gaps |
| [endpoints.md](endpoints.md) | Every operation of the spec, generated — don't edit by hand |
| [behavior.md](behavior.md) | How Goal behaves, as observed and tested, with dates |
| [questions.md](questions.md) | Questions open with Goal's support and their answers |
| `openapi/ext-common.json` | The API specification, as served by Goal |
| `openapi/build-index.mjs` | Regenerates `endpoints.md` from the specification |

---

## Environments

One tenant, `1045` (MTU), in the `lat` region. It holds both operators (RAPIDO and VPAR) and is the production environment: everything there is real. A test environment was asked for (see [questions.md](questions.md)).

| What | Address |
|---|---|
| Web app | `https://managers-lat.goalbus.goalsystems.com/tenants/1045` |
| API base | `https://api-lat.goalbus.goalsystems.com/api-integration` |
| Token | `https://identity-lat.goalbus.goalsystems.com/realms/mtu/protocol/openid-connect/token` |
| Swagger UI | `https://api-comercial.goalbus.goalsystems.com/api-integration/swagger-ui/index.html`, group `ext-common` (basic auth) |
| Specification | `<host>/api-integration/v3/api-docs/ext-common` (basic auth); `api-comercial` and `api-lat` serve the same one |

---

## Authentication

OAuth 2.0 client credentials against Goal's Keycloak (realm `mtu`), client `external-client`, scope `openid`. Every call carries:

```
Authorization: Bearer <token>
X-TENANT-ID: 1045
responseMode: SYNC
```

- The token lasts **5 minutes** (`exp − iat = 300 s`). A long paged read must renew it.
- The token carries only generic Keycloak roles; nothing in it says read or write. Access is decided by the API.
- **Secrets never go in the repository.** The client secret and the Swagger login were sent by Goal and are kept outside it. When nyx calls the API, they come from the environment:

| Variable | Value |
|---|---|
| `GOAL_API_URL` | API base above |
| `GOAL_TOKEN_URL` | Token address above |
| `GOAL_CLIENT_ID` | `external-client` |
| `GOAL_CLIENT_SECRET` | from Goal |
| `GOAL_TENANT_ID` | `1045` |

---

## Access status

| Access | Status |
|---|---|
| Read | Works — scenarios, timetable, catalog and metrics were read during the GTFS validation (2026-11-04 to 2026-11-05) |
| Write | Unknown. The specification lists 115 write operations; Goal's e-mail listed only reads; none was tried. Goal is deciding whether to grant it or build the routine themselves |

Nyx code doesn't call the API yet. The reads so far were ad hoc scripts, with the user's approval each time.

---

## Updating the specification

When Goal changes the API, fetch it again and regenerate the index:

```bash
curl -u '<swagger user>:<password>' \
  https://api-lat.goalbus.goalsystems.com/api-integration/v3/api-docs/ext-common \
  | python3 -m json.tool --indent 2 > docs/integrations/goal/openapi/ext-common.json
node docs/integrations/goal/openapi/build-index.mjs
```

The pretty-printed file keeps `git diff` readable, which is how a change in the API shows up. Then review [api.md](api.md) for what changed.

# Lake Worker

![Logo Placeholder](./logo.jpg)

A NestJS worker that provisions and deletes game servers using Pterodactyl. Handles server lifecycle management including provisioning, expiry, deletion, and email notifications via scheduled jobs.

---

## API Documentation

All routes are versioned under `/v1/` by default (URI versioning).

---

### Provisioning — `/v1/queue`

#### `POST /v1/queue/provision`

Enqueues a server provisioning job for a given order. Returns `202 Accepted` immediately — provisioning happens asynchronously via the BullMQ queue.

**Request body:**

```json
{
  "orderId": "string (required)"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Provisioning job queued",
  "jobId": "string",
  "orderId": "string"
}
```

---

#### `GET /v1/queue/jobstatus/:jobId`

Returns the current state and details of a queued provisioning job.

**Path params:** `jobId` — the BullMQ job ID returned by the provision endpoint.

**Response:**

```json
{
  "success": true,
  "jobId": "string",
  "state": "waiting | active | completed | failed | delayed",
  "data": { "orderId": "string" },
  "attemptsMade": 0,
  "failedReason": "string | null",
  "progress": 0
}
```

Returns `404` if the job does not exist.

---

#### `POST /v1/queue/changeGame`

Reassigns a game on an existing server. Triggers a reinstall with the new game configuration.

**Request body:**

```json
{
  "serverId": "string (required)",
  "gameId": "integer (required, positive)",
  "userId": "string (required)",
  "gameConfig": "object (required)",
  "deleteFiles": "boolean (optional, defaults to keep files)"
}
```

---

### Ports — `/v1/ports`

#### `POST /v1/ports`

Corrects the port allocation for an existing server on Pterodactyl. Looks up the server by its Pterodactyl server ID and reassigns ports to match the expected game configuration.

**Request body:**

```json
{
  "serverId": "string (required) — Pterodactyl server ID"
}
```

Returns `400` if no matching server is found, `500` if port correction fails.

---

### Jobs — `/v1/jobs`

Monitoring and manual control of scheduled background jobs.

#### `GET /v1/jobs/status`

Returns the current status of all registered scheduled jobs (running/idle, last run time, etc.).

**Response:**

```json
{
  "timestamp": "ISO 8601",
  "jobs": { ... }
}
```

---

#### `GET /v1/jobs/runs`

Returns the 50 most recent job run records from the database.

**Response:**

```json
{
  "timestamp": "ISO 8601",
  "runs": [ ... ]
}
```

---

#### `GET /v1/jobs/runs/:id`

Returns full details of a specific job run by its database ID.

Returns `{ "error": "Job run not found" }` if the ID does not exist.

---

#### `POST /v1/jobs/trigger/:jobName`

Manually triggers a scheduled job outside its normal schedule. Only one instance of a job runs at a time — triggers are ignored if the job is already running.

**Valid `jobName` values:**

| Job Name                 | Description                                                  |
| ------------------------ | ------------------------------------------------------------ |
| `ExpireServers`          | Marks servers as expired when their subscription ends        |
| `DeleteServers`          | Deletes servers that have been expired past the grace period |
| `SendEmails`             | Dispatches queued outgoing emails                            |
| `GenerateExpiryEmails`   | Generates expiry reminder emails for servers nearing expiry  |
| `GenerateDeletionEmails` | Generates deletion warning emails for expired servers        |

**Response:**

```json
{
  "timestamp": "ISO 8601",
  "jobName": "string",
  "status": "triggered | skipped",
  ...
}
```

---

## Queues

### `provisioning` (BullMQ)

Handles asynchronous server provisioning via Pterodactyl.

| Property   | Value                                                         |
| ---------- | ------------------------------------------------------------- |
| Queue name | `provisioning`                                                |
| Job name   | `provision-server`                                            |
| Retries    | 3 attempts                                                    |
| Backoff    | Exponential, starting at 5 seconds                            |
| Job ID     | Set to `orderId` to prevent duplicate jobs for the same order |

**Job data:**

```json
{
  "orderId": "string",
  "traceparent": "string (optional — W3C trace context for distributed tracing)"
}
```

**Lifecycle:**

1. Job is enqueued via `POST /v1/queue/provision`.
2. `ProvisioningProcessor` picks up the job and calls `PterodactylService.provisionServer()`.
3. Progress is reported at 10% (start) and 99% (complete).
4. On failure the job is retried up to 3 times with exponential backoff; after all retries are exhausted the failure is logged.

Job state can be monitored in real time via `GET /v1/queue/jobstatus/:jobId`.

# Quick Grafana Configuration Guide

## 1. Configure Loki Data Source

**Navigation:** Configuration → Data Sources → Loki (or Add data source)

### Basic Settings:

```
Name: Loki
URL: http://10.1.17.5:3100
```

### Derived Fields (for Trace Correlation):

Click **"+ Add"** under Derived fields:

**Field 1 - TraceID:**

- **Name:** `TraceID`
- **Regex:** `"trace_id":"([a-f0-9]+)"`
- **Internal Link:** ✓ (checked)
- **Data source:** `Tempo` (select your Tempo data source from dropdown)
- **URL Label:** `View Trace`

Click **Save & Test**

---

## 2. Configure Tempo Data Source

**Navigation:** Configuration → Data Sources → Tempo (or Add data source)

### Basic Settings:

```
Name: Tempo
URL: http://10.1.17.5:3200
```

### Trace to Logs Configuration:

Scroll down to **"Trace to logs"** section:

```
Data source: Loki (select from dropdown)
Tags: (leave empty or add: service.name, job)
Filter by Trace ID: ✓ (checked)
Filter by Span ID: ☐ (unchecked - optional)
```

**Query Template:**

```
{job="nest-lake-worker"} |= `$${__span.traceId}`
```

Or if you want more filtering:

```
{job="nest-lake-worker", environment="development"} | json | trace_id=`$${__span.traceId}`
```

Click **Save & Test**

---

## 3. Test the Integration

### From Tempo to Logs:

1. Go to **Explore**
2. Select **Tempo** data source
3. Click **Search** (or use TraceQL)
4. Click on any trace
5. Look for **"Logs for this span"** button/section
6. Click it to see correlated logs

### From Logs to Traces:

1. Go to **Explore**
2. Select **Loki** data source
3. Query: `{job="nest-lake-worker"}`
4. In the log results, you should see a clickable link on the trace_id
5. Click it to jump to the trace in Tempo

---

## 4. Useful Loki Queries

### All logs from your service:

```
{job="nest-lake-worker"}
```

### Logs for a specific trace:

```
{job="nest-lake-worker"} | json | trace_id="YOUR_TRACE_ID_HERE"
```

### Error logs only:

```
{job="nest-lake-worker"} | json | level="error"
```

### Logs with specific message pattern:

```
{job="nest-lake-worker"} |~ "complex operation"
```

### Logs for a specific user:

```
{job="nest-lake-worker"} | json | userId="123"
```

---

## 5. Useful Tempo Queries (TraceQL)

### All traces:

```
{}
```

### Traces with errors:

```
{status=error}
```

### Traces for specific operation:

```
{name="service.complex-operation"}
```

### Traces longer than 200ms:

```
{duration>200ms}
```

---

## 6. Expected Log Format in Loki

Your logs will appear in Loki like this:

```json
{
  "timestamp": "2026-01-07T10:30:45.123Z",
  "level": "info",
  "message": "User validated: user_123",
  "trace_id": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
  "span_id": "q1r2s3t4u5v6w7x8",
  "trace_flags": 1,
  "service": "NEST-LAKE-WORKER",
  "userId": 123,
  "username": "user_123"
}
```

---

## 7. Troubleshooting

### Can't see logs in Loki?

```bash
# Check Loki is accessible
curl http://10.1.17.5:3100/ready

# Check available labels
curl http://10.1.17.5:3100/loki/api/v1/labels

# Check log streams
curl http://10.1.17.5:3100/loki/api/v1/label/job/values
```

### Trace ID links not appearing?

- Verify the regex pattern in Derived Fields matches your log format
- Check that trace_id appears in your logs (query Loki and inspect log line)
- Ensure Tempo data source is selected in the Derived Field configuration

### Can't jump from Tempo to Logs?

- Verify the Query Template in Tempo's "Trace to logs" section
- Check that the job label matches what you're using in Loki
- Test the query manually in Loki Explore with a known trace_id

---

## 8. Dashboard Ideas

### Create a Dashboard Panel:

**Panel 1: Trace Volume**

- Data source: Tempo
- Visualization: Time series
- Query: `{}`

**Panel 2: Error Logs**

- Data source: Loki
- Visualization: Logs
- Query: `{job="nest-lake-worker"} | json | level="error"`

**Panel 3: Latency Heatmap**

- Data source: Tempo
- Visualization: Heatmap
- Query: TraceQL with duration metrics

---

## Configuration File URLs (if needed)

If you need to configure data sources via file:

**loki-datasource.yaml:**

```yaml
apiVersion: 1
datasources:
  - name: Loki
    type: loki
    url: http://10.1.17.5:3100
    jsonData:
      derivedFields:
        - datasourceUid: tempo
          matcherRegex: 'trace_id":"([a-f0-9]+)'
          name: TraceID
          url: '$${__value.raw}'
```

**tempo-datasource.yaml:**

```yaml
apiVersion: 1
datasources:
  - name: Tempo
    type: tempo
    url: http://10.1.17.5:3200
    jsonData:
      tracesToLogs:
        datasourceUid: loki
        filterByTraceID: true
        tags: ['job']
      lokiSearch:
        datasourceUid: loki
```

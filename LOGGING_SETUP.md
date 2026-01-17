# Log-Trace Correlation Setup Guide

## What's Configured

Your NestJS application now sends:
- **Traces** to Tempo via OTLP HTTP (port 4318)
- **Logs** to Loki via HTTP (port 3100)
- All logs automatically include `trace_id` and `span_id` from OpenTelemetry

## Architecture

```
NestJS App → Tempo (traces with trace_id)
          → Loki (logs with trace_id & span_id)
          
Grafana → Reads from both Tempo & Loki
       → Correlates them using trace_id
```

## Configuration Files Changed

1. **src/core/logger.service.ts** - New Winston logger with:
   - Automatic trace context injection
   - Loki transport
   - Console output for development

2. **src/tracing.ts** - Added:
   - WinstonInstrumentation for automatic correlation

3. **src/app.service.ts** - Added logging statements throughout

## Grafana Configuration

### Step 1: Configure Loki Data Source

In Grafana, go to **Configuration → Data Sources → Loki**:

```yaml
URL: http://10.1.17.5:3100
```

### Step 2: Enable Derived Fields for Trace Correlation

In your Loki data source settings, add a **Derived Field**:

**For trace_id:**
- **Name**: `trace_id`
- **Regex**: `"trace_id":"(\w+)"`
- **Internal Link**: `true`
- **Data source**: `Tempo` (select your Tempo data source)
- **URL**: Leave default or use `$${__value.raw}`

This tells Grafana to extract the trace_id from logs and create a clickable link to the trace in Tempo.

### Step 3: Configure Tempo Data Source

In Grafana, go to **Configuration → Data Sources → Tempo**:

```yaml
URL: http://10.1.17.5:3200

# Under "Trace to logs" section:
Data source: Loki
Tags: Leave empty or add custom tags
Filter by Trace ID: true
Filter by Span ID: false (optional)

# Query format:
{job="nest-lake-worker"} |= `$${__span.traceId}`
```

This tells Tempo how to find related logs in Loki when viewing a trace.

## Testing the Integration

### 1. Start your application:
```bash
pnpm start:dev
```

### 2. Generate some traffic:
```bash
curl http://localhost:3000/complex/123/process
```

### 3. View in Grafana:

**Option A: Start from Trace (Tempo)**
1. Go to Explore → Select Tempo
2. Search for recent traces
3. Click on a trace
4. You should see a **"Logs for this span"** button/section
5. Click it to see correlated logs from Loki

**Option B: Start from Logs (Loki)**
1. Go to Explore → Select Loki
2. Query: `{job="nest-lake-worker"}`
3. Find a log line with a trace_id
4. Click the trace_id link to jump to the trace in Tempo

## Logger Usage in Your Code

```typescript
import { LoggerService } from './core/logger.service';

@Injectable()
export class YourService {
  constructor(private readonly logger: LoggerService) {}

  async yourMethod() {
    // Simple logging
    this.logger.log('Something happened');
    this.logger.error('An error occurred');
    this.logger.warn('Warning message');
    
    // Structured logging with context
    this.logger.logWithContext('info', 'User action', {
      userId: 123,
      action: 'purchase',
      amount: 99.99
    });
    
    // Within a traced span, logs will automatically include:
    // - trace_id
    // - span_id
    // - trace_flags
  }
}
```

## Customization

### Change Loki URL

Edit [src/core/logger.service.ts](src/core/logger.service.ts):

```typescript
new LokiTransport({
  host: 'http://YOUR_LOKI_HOST:3100',
  labels: { 
    job: 'nest-lake-worker',
    environment: 'production' // Change as needed
  },
  // ... other options
}),
```

### Add More Labels

```typescript
labels: { 
  job: 'nest-lake-worker',
  environment: process.env.NODE_ENV || 'development',
  hostname: require('os').hostname(),
  version: '1.0.0'
}
```

### Adjust Log Levels

In the logger constructor:

```typescript
this.logger = createLogger({
  level: process.env.LOG_LEVEL || 'info', // debug, info, warn, error
  // ...
});
```

## Troubleshooting

### Logs not appearing in Loki

1. Check Loki is accessible:
```bash
curl http://10.1.17.5:3100/ready
```

2. Check Winston-Loki connection errors in console

3. Verify labels are correct in Loki:
```bash
curl http://10.1.17.5:3100/loki/api/v1/labels
```

### Traces not linked to logs

1. Verify trace_id appears in logs (check console output)
2. Check Derived Fields configuration in Grafana Loki data source
3. Verify the regex pattern matches your log format

### Performance Considerations

For production:
- Consider batching logs before sending to Loki
- Adjust `winston-loki` batch settings:
```typescript
new LokiTransport({
  host: 'http://10.1.17.5:3100',
  batching: true,
  interval: 5, // seconds
  // ...
})
```

## What You Get in Grafana

When viewing a trace in Tempo, you'll see:
- Complete trace tree with all spans
- Timing information
- **"Logs for this span"** section showing:
  - All logs that occurred during the trace
  - Logs from specific spans
  - Full context of what happened

This makes debugging much easier because you can:
- See the execution flow (trace)
- See what was logged during each step (logs)
- Jump between traces and logs seamlessly

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { WinstonInstrumentation } from '@opentelemetry/instrumentation-winston';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

const traceExporter = new OTLPTraceExporter({
  url: 'http://10.1.17.5:4318/v1/traces', // Tempo OTLP HTTP
});

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: 'nest-lake-worker',
    [ATTR_SERVICE_VERSION]: '1.0',
  }),

  traceExporter: traceExporter,
  // metricReader: new PeriodicExportingMetricReader({
  //   exporter: new ConsoleMetricExporter(), // TODO: Change to OTLPMetricExporter for production
  // }),
  instrumentations: [
    getNodeAutoInstrumentations(),
    new WinstonInstrumentation({
      // This ensures Winston logs are automatically linked to traces
      enabled: true,
    }),
  ],
});

sdk.start();

/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import {
  PeriodicExportingMetricReader,
  ConsoleMetricExporter,
} from '@opentelemetry/sdk-metrics';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

const traceExporter = new OTLPTraceExporter({
  url: 'http://10.1.17.5:4318/v1/traces', // Tempo OTLP HTTP
});

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: 'NEST-LAKE-WORKER',
    [ATTR_SERVICE_VERSION]: '1.0',
  }),

  traceExporter: traceExporter,
  // metricReader: new PeriodicExportingMetricReader({
  //   exporter: new ConsoleMetricExporter(), // TODO: Change to OTLPMetricExporter for production
  // }),
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();

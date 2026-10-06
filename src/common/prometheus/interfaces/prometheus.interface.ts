import { Metrics } from '@willsoto/nestjs-prometheus';
import * as client from 'prom-client';
export { Metrics } from '@willsoto/nestjs-prometheus';

export type Options<T extends string> = (
  | client.GaugeConfiguration<T>
  | client.SummaryConfiguration<T>
  | client.CounterConfiguration<T>
  | client.HistogramConfiguration<T>
) & {
  /** False keeps the metric out of the app's own namespace — for names shared across services. */
  prefix?: boolean;
};

export type Metric<T extends Metrics, S extends string> = T extends 'Gauge'
  ? client.Gauge<S>
  : T extends 'Summary'
  ? client.Summary<S>
  : T extends 'Counter'
  ? client.Counter<S>
  : T extends 'Histogram'
  ? client.Histogram<S>
  : never;

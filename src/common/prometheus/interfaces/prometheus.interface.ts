import * as client from 'prom-client';
import { Metrics } from '@willsoto/nestjs-prometheus';
export { Metrics } from '@willsoto/nestjs-prometheus';

export type Options<T extends string> =
  | client.GaugeConfiguration<T>
  | client.SummaryConfiguration<T>
  | client.CounterConfiguration<T>
  | client.HistogramConfiguration<T>;

export type Metric<T extends Metrics, S extends string> = T extends 'Gauge'
  ? client.Gauge<S>
  : T extends 'Summary'
  ? client.Summary<S>
  : T extends 'Counter'
  ? client.Counter<S>
  : T extends 'Histogram'
  ? client.Histogram<S>
  : never;

import { Controller } from '@nestjs/common';
import { PrometheusController as PrometheusControllerSource } from '@willsoto/nestjs-prometheus';

@Controller()
export class PrometheusController extends PrometheusControllerSource {}

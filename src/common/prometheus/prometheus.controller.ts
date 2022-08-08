import { PrometheusController as PrometheusControllerSource } from '@willsoto/nestjs-prometheus';
import { Controller } from '@nestjs/common';

@Controller()
export class PrometheusController extends PrometheusControllerSource {}

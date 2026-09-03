import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { EnvelopeInterceptor } from './envelope.interceptor.js';

@Module({
  providers: [{ provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor }],
})
export class EnvelopeModule {}

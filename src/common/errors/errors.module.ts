import { HttpStatus, Module, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { AllExceptionsFilter } from './all-exceptions.filter.js';
import { AppError } from './app-error.js';
import { ErrorCode } from './error-code.enum.js';
import { formatValidationErrors } from './format-validation-errors.js';

@Module({
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        transform: true,
        exceptionFactory: (errors) =>
          new AppError(
            ErrorCode.VALIDATION_FAILED,
            'Validation failed',
            HttpStatus.BAD_REQUEST,
            formatValidationErrors(errors),
          ),
      }),
    },
  ],
})
export class ErrorsModule {}

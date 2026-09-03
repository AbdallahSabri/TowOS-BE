import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'node:http';
import { AppModule } from '../src/app.module.js';

describe('AppModule (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('wraps a successful response in the { data, meta, request_id } envelope', async () => {
    const response = await request(app.getHttpServer() as Server).get('/health').expect(200);
    const body: unknown = response.body;

    expect(body).toEqual({
      data: { status: 'ok' },
      meta: {},
      request_id: expect.stringMatching(/^req_[0-9A-Z]{26}$/),
    });
  });

  it('shapes a 404 as { error: { code, message, details, request_id } }', async () => {
    const response = await request(app.getHttpServer() as Server).get('/nonexistent').expect(404);
    const body: unknown = response.body;

    expect(body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: expect.any(String),
        details: null,
        request_id: expect.stringMatching(/^req_[0-9A-Z]{26}$/),
      },
    });
  });
});

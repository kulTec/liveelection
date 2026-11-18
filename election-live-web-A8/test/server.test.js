const test = require('node:test');
const assert = require('node:assert/strict');
const { handle } = require('../lib/server');

function request({ method = 'POST', name = 'unknown', origin, host = 'liveelection.vercel.app', body = {} } = {}) {
  return {
    method,
    query: { name },
    headers: { host, ...(origin ? { origin } : {}) },
    body
  };
}

function response() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; }
  };
}

test('requires POST for API calls', async () => {
  const res = response();
  await handle(request({ method: 'GET' }), res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.body.error.code, 'functions/invalid-argument');
});

test('rejects unknown API functions', async () => {
  const res = response();
  await handle(request({ name: 'missingFunction' }), res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error.code, 'functions/not-found');
});

test('rejects cross-origin API calls', async () => {
  const res = response();
  await handle(request({ origin: 'https://attacker.example' }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error.code, 'functions/permission-denied');
});

test('signup OTP verifies an account with the Firebase emulators', {
  skip: !process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST
}, async () => {
  process.env.OTP_SALT = 'test-only-otp-salt-long-enough-123456';
  process.env.OTP_LOG_TO_CONSOLE = 'true';
  process.env.NODE_ENV = 'test';
  const email = `signup-${Date.now()}@example.com`;
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    const requestResponse = response();
    await handle(request({ name: 'requestSignupOtp', body: { email } }), requestResponse);
    assert.equal(requestResponse.statusCode, 200);
    const match = logs.join('\n').match(/code is (\d{6})/);
    assert.ok(match, 'emulator email log should include the test code');

    const verifyResponse = response();
    await handle(request({
      name: 'verifySignupOtp',
      body: { email, partyName: 'Test Party', password: 'valid-test-password', code: match[1] }
    }), verifyResponse);
    assert.equal(verifyResponse.statusCode, 200);
    assert.match(verifyResponse.body.data.regNumber, /^TES-\d{4}-\d{6}$/);
    assert.ok(verifyResponse.body.data.partyId);
  } finally {
    console.log = originalLog;
  }
});

const crypto = require('node:crypto');
const nodemailer = require('nodemailer');
const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { FieldValue, Timestamp, getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const firebaseProjectId = process.env.FIREBASE_PROJECT_ID || 'accord-party-live-election';
let services;

class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function getServices() {
  if (services) return services;
  const rawAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const usingEmulators = Boolean(process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST);
  const options = { projectId: firebaseProjectId };

  if (rawAccount) {
    try {
      const account = JSON.parse(rawAccount);
      if (account.project_id && account.project_id !== firebaseProjectId) {
        throw new Error('Project ID mismatch.');
      }
      options.credential = cert(account);
    } catch {
      throw new ApiError('failed-precondition', 'Firebase service-account configuration is invalid.');
    }
  } else if (!usingEmulators) {
    throw new ApiError('failed-precondition', 'Firebase backend credentials are not configured.');
  }

  const app = getApps().find(candidate => candidate.name === 'liveelection-api')
    || initializeApp(options, 'liveelection-api');
  services = {
    auth: getAuth(app),
    db: getFirestore(app),
    messaging: getMessaging(app)
  };
  return services;
}

function getSalt() {
  const salt = process.env.OTP_SALT;
  if (!salt || salt.length < 32) {
    throw new ApiError('failed-precondition', 'The backend OTP secret is not configured.');
  }
  return salt;
}

const hash = value => crypto.createHash('sha256').update(`${value}${getSalt()}`).digest('hex');
const normalizeEmail = value => String(value || '').trim().toLowerCase();
const now = () => Date.now();

function requireRole(identity, roles) {
  const token = identity && identity.token;
  if (!token || !roles.includes(token.role)) throw new ApiError('permission-denied', 'Not allowed.');
  return token;
}

async function authenticate(req) {
  const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  if (!match) throw new ApiError('unauthenticated', 'Sign in and try again.');
  try {
    const token = await getServices().auth.verifyIdToken(match[1]);
    return { uid: token.uid, token };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('unauthenticated', 'Your session has expired. Sign in again.');
  }
}

async function sendMail(to, subject, text) {
  const from = process.env.MAIL_FROM || 'Election Live <no-reply@accord.ng>';
  if (process.env.NODE_ENV !== 'production' && process.env.OTP_LOG_TO_CONSOLE === 'true') {
    console.log('[DEV EMAIL]', to, subject, text);
    return;
  }

  if (process.env.RESEND_API_KEY) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from, to: [to], subject, text })
    });
    if (!response.ok) {
      console.error('[email] provider rejected message', response.status);
      throw new ApiError('internal', 'Email delivery failed. Please try again later.');
    }
    return;
  }

  if (process.env.SMTP_URL) {
    await nodemailer.createTransport(process.env.SMTP_URL).sendMail({ from, to, subject, text });
    return;
  }
  throw new ApiError('failed-precondition', 'Email delivery is not configured for this app.');
}

async function issueOtp(purpose, email, subject) {
  const { db } = getServices();
  const ref = db.doc(`otps/${purpose}_${hash(email)}`);
  const sentAt = now();
  const code = await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists && sentAt - snapshot.data().sentAt < 60000) {
      throw new ApiError('resource-exhausted', 'Wait 60 seconds before asking for a new code.');
    }
    const code = String(crypto.randomInt(100000, 1000000));
    transaction.set(ref, {
      hash: hash(code),
      expires: sentAt + 600000,
      tries: 0,
      sentAt
    });
    return code;
  });
  try {
    await sendMail(email, subject, `Your Election Live code is ${code}. It expires in 10 minutes. If you did not ask for it, ignore this email.`);
  } catch (error) {
    await ref.delete();
    throw error;
  }
}

async function checkOtp(purpose, email, code) {
  const { db } = getServices();
  const ref = db.doc(`otps/${purpose}_${hash(email)}`);
  const supplied = Buffer.from(hash(String(code || '')));
  const wrongCode = await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const otp = snapshot.data();
    if (!otp || now() > otp.expires) throw new ApiError('deadline-exceeded', 'Code expired. Request a new one.');
    if (otp.tries >= 5) throw new ApiError('resource-exhausted', 'Too many wrong codes. Request a new one.');
    const expected = Buffer.from(otp.hash || '');
    if (expected.length !== supplied.length || !crypto.timingSafeEqual(supplied, expected)) {
      transaction.update(ref, { tries: FieldValue.increment(1) });
      return true;
    }
    transaction.delete(ref);
    return false;
  });
  if (wrongCode) throw new ApiError('permission-denied', 'Wrong code.');
}

async function requestSignupOtp(data) {
  const email = normalizeEmail(data.email);
  if (!EMAIL.test(email)) throw new ApiError('invalid-argument', 'Enter a valid email.');
  const { auth } = getServices();
  try {
    await auth.getUserByEmail(email);
    throw new ApiError('already-exists', 'This email is already registered.');
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error.code !== 'auth/user-not-found') throw error;
  }
  await issueOtp('signup', email, 'Your Election Live sign-up code');
  return { ok: true };
}

async function verifySignupOtp(data) {
  const email = normalizeEmail(data.email);
  const name = String(data.partyName || '').trim();
  const password = String(data.password || '');
  if (!EMAIL.test(email) || name.length < 3 || password.length < 8) {
    throw new ApiError('invalid-argument', 'Check the party name, email and password.');
  }
  await checkOtp('signup', email, data.code);
  const { auth, db } = getServices();
  const prefix = name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'PTY';
  let user;
  try {
    user = await auth.createUser({ email, password, emailVerified: true, displayName: name });
  } catch (error) {
    if (error.code === 'auth/email-already-exists') {
      throw new ApiError('already-exists', 'This email is already registered.');
    }
    throw error;
  }
  const partyRef = db.collection('parties').doc();
  let regNumber;
  try {
    regNumber = await db.runTransaction(async transaction => {
      const counterRef = db.doc('counters/party');
      const counter = (await transaction.get(counterRef)).data() || {};
      const sequence = (counter.seq || 0) + 1;
      const registration = `${prefix}-${new Date().getFullYear()}-${String(sequence).padStart(6, '0')}`;
      transaction.set(counterRef, { seq: sequence });
      transaction.set(partyRef, {
        name, prefix, regNumber: registration, ownerUid: user.uid, email,
        createdAt: FieldValue.serverTimestamp()
      });
      transaction.set(db.doc(`users/${user.uid}`), { role: 'owner', partyId: partyRef.id, email });
      return registration;
    });
    await auth.setCustomUserClaims(user.uid, { role: 'owner', partyId: partyRef.id });
  } catch (error) {
    try {
      await auth.deleteUser(user.uid);
    } catch (cleanupError) {
      console.error('[signup] failed to remove incomplete user', cleanupError.code || 'unknown');
    }
    throw error;
  }
  try {
    await sendMail(email, 'Your party registration number', `${name} is registered. Registration number: ${regNumber}`);
  } catch (error) {
    console.error('[email] registration notice failed', error.code || 'unknown');
  }
  return { regNumber, partyId: partyRef.id };
}

async function createAgents(identity, data) {
  const token = requireRole(identity, ['owner', 'admin']);
  const { auth, db } = getServices();
  const partyId = token.partyId;
  const rows = Array.isArray(data.agents) ? data.agents.slice(0, 200) : [];
  const partySnapshot = await db.doc(`parties/${partyId}`).get();
  const party = partySnapshot.data();
  if (!party) throw new ApiError('not-found', 'Party not found.');
  const results = [];

  for (const [index, row] of rows.entries()) {
    try {
      const email = normalizeEmail(row.email);
      const name = String(row.name || '').trim();
      const puCode = String(row.puCode || '').trim();
      if (!EMAIL.test(email) || name.length < 2) throw new Error('Invalid name or email');
      const puSnapshot = await db.doc(`polling_units/${puCode}`).get();
      if (!puSnapshot.exists) throw new Error('Polling unit code not found');
      const pu = puSnapshot.data();
      const agentRef = db.collection(`parties/${partyId}/agents`).doc();
      const code = await db.runTransaction(async transaction => {
        const emailRef = db.doc(`agent_emails/${hash(email)}`);
        const counterRef = db.doc(`counters/ward_${pu.stateCode}_${pu.wardCode}`);
        const unitRef = db.doc(`parties/${partyId}/units/${puCode}`);
        const [emailSnapshot, counterSnapshot, unitSnapshot] = await Promise.all([
          transaction.get(emailRef), transaction.get(counterRef), transaction.get(unitRef)
        ]);
        if (emailSnapshot.exists) throw new Error('Email already used by another agent');
        if (unitSnapshot.exists && unitSnapshot.data().agentId) throw new Error('Polling unit already has an agent');
        const sequence = ((counterSnapshot.data() || {}).seq || 0) + 1;
        const agentCode = `${party.prefix}-${pu.stateCode}-${pu.wardCode}-${String(sequence).padStart(3, '0')}`;
        transaction.set(counterRef, { seq: sequence });
        transaction.set(emailRef, { agentId: agentRef.id });
        transaction.set(agentRef, {
          agentCode, name, email, puCode, stateCode: pu.stateCode, lgaCode: pu.lgaCode,
          wardCode: pu.wardCode, status: 'active', deviceId: null, createdAt: FieldValue.serverTimestamp()
        });
        transaction.set(unitRef, {
          puCode, name: pu.name, lat: pu.lat, lng: pu.lng, stateCode: pu.stateCode,
          stateName: pu.stateName || pu.stateCode, lgaCode: pu.lgaCode,
          lgaName: pu.lgaName || pu.lgaCode, wardCode: pu.wardCode,
          agentId: agentRef.id, agentName: name, accredited: 0, incidents: 0,
          resultStatus: 'none', lastSeen: null
        }, { merge: true });
        return agentCode;
      });
      await sendMail(email, 'Your Election Live agent ID', `Hello ${name}, your agent ID is ${code}. Open the Election Live app and log in with this ID. We will email you a code each time.`);
      results.push({ row: index, ok: true, agentCode: code });
    } catch (error) {
      results.push({ row: index, ok: false, error: error.message || 'Could not create agent.' });
    }
  }
  await audit(db, partyId, 'agents_created', { by: identity.uid, count: results.filter(result => result.ok).length });
  return { results };
}

async function removeAgent(identity, data) {
  const token = requireRole(identity, ['owner', 'admin']);
  const { auth, db } = getServices();
  const agentRef = db.doc(`parties/${token.partyId}/agents/${data.agentId}`);
  const snapshot = await agentRef.get();
  if (!snapshot.exists) throw new ApiError('not-found', 'Agent not found.');
  const agent = snapshot.data();
  await agentRef.update({ status: 'revoked', deviceId: null, revokedAt: FieldValue.serverTimestamp() });
  await db.doc(`parties/${token.partyId}/units/${agent.puCode}`).set({
    agentId: FieldValue.delete(), agentName: FieldValue.delete()
  }, { merge: true });
  await db.doc(`agent_emails/${hash(agent.email)}`).delete().catch(error => {
    if (error.code !== 5 && error.code !== 'not-found') throw error;
  });
  try {
    await auth.updateUser(`agent_${data.agentId}`, { disabled: true });
    await auth.revokeRefreshTokens(`agent_${data.agentId}`);
  } catch (error) {
    if (error.code !== 'auth/user-not-found') throw error;
  }
  await audit(db, token.partyId, 'agent_removed', { by: identity.uid, agentId: data.agentId });
  return { ok: true };
}

async function resetAgentDevice(identity, data) {
  const token = requireRole(identity, ['owner', 'admin']);
  const { db } = getServices();
  await db.doc(`parties/${token.partyId}/agents/${data.agentId}`).update({ deviceId: null });
  await audit(db, token.partyId, 'device_reset', { by: identity.uid, agentId: data.agentId });
  return { ok: true };
}

async function findAgent(code) {
  const { db } = getServices();
  const result = await db.collectionGroup('agents')
    .where('agentCode', '==', String(code || '').trim().toUpperCase()).limit(1).get();
  return result.empty ? null : result.docs[0];
}

async function requestAgentOtp(data) {
  const agent = await findAgent(data.agentCode);
  if (agent && agent.data().status === 'active') {
    await issueOtp('agent', agent.data().email, 'Your Election Live login code');
  }
  return { ok: true };
}

async function verifyAgentLogin(data) {
  const agent = await findAgent(data.agentCode);
  if (!agent || agent.data().status !== 'active') {
    throw new ApiError('permission-denied', 'Wrong agent ID or code.');
  }
  const record = agent.data();
  const partyId = agent.ref.parent.parent.id;
  const deviceId = String(data.deviceId || '');
  if (deviceId.length < 8) throw new ApiError('invalid-argument', 'Device ID missing.');
  await checkOtp('agent', record.email, data.code);
  if (record.deviceId && record.deviceId !== deviceId) {
    await raise(partyId, {
      kind: 'device_mismatch', puCode: record.puCode,
      title: 'Agent login from a new phone',
      body: `${record.name} (${record.agentCode}) tried to log in on another device.`
    });
    throw new ApiError('failed-precondition', 'This ID is bound to another phone. Ask your admin to reset it.');
  }
  if (!record.deviceId) {
    await agent.ref.update({ deviceId, deviceBoundAt: FieldValue.serverTimestamp() });
  }
  await audit(getServices().db, partyId, 'agent_login', { agentId: agent.id });
  const token = await getServices().auth.createCustomToken(`agent_${agent.id}`, {
    role: 'agent', partyId, agentId: agent.id, puCode: record.puCode
  });
  return { token, partyId, puCode: record.puCode };
}

async function subscribeStaffPush(identity, data) {
  const token = requireRole(identity, ['owner', 'admin', 'coordinator']);
  await getServices().messaging.subscribeToTopic(String(data.token || ''), `party_${token.partyId}_staff`);
  return { ok: true };
}

async function createCoordinator(identity, data) {
  const token = requireRole(identity, ['owner', 'admin']);
  const { auth, db } = getServices();
  const email = normalizeEmail(data.email);
  const name = String(data.name || '').trim();
  const level = data.level;
  if (!EMAIL.test(email) || name.length < 2 || !['state', 'lga', 'ward'].includes(level)) {
    throw new ApiError('invalid-argument', 'Check name, email and level.');
  }
  const stateCode = String(data.stateCode || '').trim();
  const lgaCode = String(data.lgaCode || '').trim();
  const wardCode = String(data.wardCode || '').trim();
  if (!stateCode || (level !== 'state' && !lgaCode) || (level === 'ward' && !wardCode)) {
    throw new ApiError('invalid-argument', 'Area codes are missing for this level.');
  }
  let user;
  try {
    user = await auth.createUser({ email, displayName: name, emailVerified: true });
  } catch (error) {
    if (error.code === 'auth/email-already-exists') {
      throw new ApiError('already-exists', 'This email is already in use.');
    }
    throw error;
  }
  const claims = {
    role: 'coordinator', partyId: token.partyId, scopeLevel: level, stateCode,
    ...(level !== 'state' ? { lgaCode } : {}),
    ...(level === 'ward' ? { wardCode } : {})
  };
  await auth.setCustomUserClaims(user.uid, claims);
  await db.doc(`users/${user.uid}`).set({ ...claims, email, name });
  await db.doc(`parties/${token.partyId}/coordinators/${user.uid}`).set({
    ...claims, email, name, level, createdAt: FieldValue.serverTimestamp()
  });
  const link = await auth.generatePasswordResetLink(email);
  await sendMail(email, 'Your Election Live coordinator account', `Hello ${name}, set your password here: ${link}`);
  await audit(db, token.partyId, 'coordinator_created', { by: identity.uid, email, level });
  return { ok: true };
}

function radians(value) {
  return value * Math.PI / 180;
}

function distanceMeters(lat1, lng1, lat2, lng2) {
  const earthRadius = 6371000;
  const deltaLat = radians(lat2 - lat1);
  const deltaLng = radians(lng2 - lng1);
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(deltaLng / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.sqrt(a));
}

async function submitReport(identity, data) {
  const claims = requireRole(identity, ['agent']);
  const { db } = getServices();
  const clientUuid = String(data.clientUuid || '');
  const lat = Number(data.lat);
  const lng = Number(data.lng);
  const clientTime = Number(data.clientTime);
  const type = data.type;
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(clientUuid)
    || !['accreditation', 'incident', 'result'].includes(type)
    || !Number.isFinite(lat) || lat < -90 || lat > 90
    || !Number.isFinite(lng) || lng < -180 || lng > 180
    || !Number.isFinite(clientTime) || !data.data || typeof data.data !== 'object') {
    throw new ApiError('invalid-argument', 'Report details are invalid.');
  }
  const agentRef = db.doc(`parties/${claims.partyId}/agents/${claims.agentId}`);
  const agent = await agentRef.get();
  if (!agent.exists || agent.data().status !== 'active' || agent.data().puCode !== claims.puCode) {
    throw new ApiError('permission-denied', 'This agent can no longer submit reports.');
  }
  const reportRef = db.doc(`parties/${claims.partyId}/reports/${clientUuid}`);
  const existing = await reportRef.get();
  if (!existing.exists) {
    await reportRef.create({
      type, puCode: claims.puCode, agentId: claims.agentId, partyId: claims.partyId,
      data: data.data, lat, lng, clientTime: Timestamp.fromMillis(clientTime),
      clientUuid, serverTime: Timestamp.now()
    });
  } else if (existing.data().agentId !== claims.agentId || existing.data().clientUuid !== clientUuid) {
    throw new ApiError('already-exists', 'Report identifier has already been used.');
  }
  await processReport(claims.partyId, clientUuid);
  return { ok: true };
}

async function processReport(partyId, reportId) {
  const { db } = getServices();
  const reportRef = db.doc(`parties/${partyId}/reports/${reportId}`);
  const notification = await db.runTransaction(async transaction => {
    const reportSnapshot = await transaction.get(reportRef);
    if (!reportSnapshot.exists || reportSnapshot.data().processedAt) return null;
    const report = reportSnapshot.data();
    const pollingUnitRef = db.doc(`polling_units/${report.puCode}`);
    const unitRef = db.doc(`parties/${partyId}/units/${report.puCode}`);
    const pollingUnitSnapshot = await transaction.get(pollingUnitRef);
    const unitSnapshot = await transaction.get(unitRef);
    const unit = unitSnapshot.data() || {};
    const pu = pollingUnitSnapshot.data();
    const flags = [];
    if (pu && distanceMeters(report.lat, report.lng, pu.lat, pu.lng) > 300) flags.push('gps_mismatch');
    const clientMillis = report.clientTime.toMillis();
    const serverMillis = report.serverTime.toMillis();
    if (clientMillis > serverMillis + 300000) flags.push('clock_ahead');
    if (serverMillis - clientMillis > 6 * 3600000) flags.push('late_sync');
    const update = { lastSeen: serverMillis };
    if (report.type === 'accreditation') update.accredited = Number(report.data.count) || 0;
    if (report.type === 'incident') update.incidents = FieldValue.increment(1);
    if (report.type === 'result') {
      const votes = report.data.votes || {};
      const totalVotes = Object.values(votes).reduce((sum, value) => sum + (Number(value) || 0), 0);
      if (totalVotes > (unit.accredited || 0)) flags.push('over_voting');
      if (!report.data.sheetPath) flags.push('no_sheet_photo');
      if (unit.resultStatus && unit.resultStatus !== 'none') flags.push('duplicate_result');
      update.votes = votes;
      update.totalVotes = totalVotes;
      update.resultStatus = flags.some(flag => flag !== 'late_sync') ? 'flagged' : 'submitted';
    }
    const severe = flags.some(flag => ['gps_mismatch', 'over_voting', 'clock_ahead', 'duplicate_result'].includes(flag))
      || (report.type === 'incident' && report.data.severity === 'high');
    transaction.update(reportRef, {
      flags, processedAt: FieldValue.serverTimestamp(),
      ...(pu ? { stateCode: pu.stateCode, lgaCode: pu.lgaCode, wardCode: pu.wardCode } : {})
    });
    transaction.set(unitRef, update, { merge: true });
    if (!severe) return null;
    const alert = {
      kind: flags[0] || 'high_incident',
      puCode: report.puCode,
      reportId,
      title: report.type === 'incident' ? 'High-severity incident' : 'Report flagged',
      body: `PU ${report.puCode}: ${flags.join(', ') || report.data.category || 'check now'}`,
      ...(pu ? { stateCode: pu.stateCode, lgaCode: pu.lgaCode, wardCode: pu.wardCode } : {}),
      createdAt: FieldValue.serverTimestamp(),
      acknowledgedBy: null
    };
    transaction.set(db.doc(`parties/${partyId}/alerts/report_${reportId}`), alert, { merge: true });
    return alert;
  });
  if (notification) await sendPush(partyId, notification);
}

async function raise(partyId, alert, alertId) {
  const { db } = getServices();
  const pu = alert.puCode ? await db.doc(`polling_units/${alert.puCode}`).get() : null;
  const area = pu && pu.exists
    ? { stateCode: pu.data().stateCode, lgaCode: pu.data().lgaCode, wardCode: pu.data().wardCode }
    : {};
  const alerts = db.collection(`parties/${partyId}/alerts`);
  const ref = alertId ? alerts.doc(alertId) : alerts.doc();
  await ref.set({
    ...alert, ...area, createdAt: FieldValue.serverTimestamp(), acknowledgedBy: null
  }, { merge: true });
  await sendPush(partyId, alert);
}

async function sendPush(partyId, alert) {
  const { messaging } = getServices();
  try {
    await messaging.send({
      topic: `party_${partyId}_staff`,
      notification: { title: alert.title, body: alert.body },
      data: { puCode: String(alert.puCode || ''), kind: String(alert.kind || '') }
    });
  } catch (error) {
    console.error('[push] notification failed', error.code || 'unknown');
  }
}

async function audit(db, partyId, action, metadata) {
  await db.collection(`parties/${partyId}/audit`).add({
    action, ...metadata, at: FieldValue.serverTimestamp()
  });
}

const handlers = {
  requestSignupOtp: data => requestSignupOtp(data),
  verifySignupOtp: data => verifySignupOtp(data),
  requestAgentOtp: data => requestAgentOtp(data),
  verifyAgentLogin: data => verifyAgentLogin(data),
  createAgents: (data, identity) => createAgents(identity, data),
  removeAgent: (data, identity) => removeAgent(identity, data),
  resetAgentDevice: (data, identity) => resetAgentDevice(identity, data),
  createCoordinator: (data, identity) => createCoordinator(identity, data),
  subscribeStaffPush: (data, identity) => subscribeStaffPush(identity, data),
  submitReport: (data, identity) => submitReport(identity, data)
};

const statusByCode = {
  'invalid-argument': 400,
  unauthenticated: 401,
  'permission-denied': 403,
  'not-found': 404,
  'already-exists': 409,
  'resource-exhausted': 429,
  'failed-precondition': 412,
  'deadline-exceeded': 400,
  unavailable: 503,
  internal: 500
};

function sendError(res, error) {
  const code = error instanceof ApiError ? error.code : 'internal';
  const status = statusByCode[code] || 500;
  if (!(error instanceof ApiError)) console.error('[api] request failed', error.code || 'unknown');
  res.status(status).json({
    error: {
      code: `functions/${code}`,
      message: error instanceof ApiError ? error.message : 'The server could not complete this request. Please try again later.'
    }
  });
}

async function handle(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: { code: 'functions/invalid-argument', message: 'Use POST for this request.' } });
  }
  const origin = req.headers.origin;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const allowedOrigins = new Set([`https://${host}`, `http://${host}`, process.env.APP_ORIGIN].filter(Boolean));
  if (origin && !allowedOrigins.has(origin)) {
    return sendError(res, new ApiError('permission-denied', 'Request origin is not allowed.'));
  }
  if (Number(req.headers['content-length'] || 0) > 1024 * 1024) {
    return sendError(res, new ApiError('invalid-argument', 'Request is too large.'));
  }
  const name = Array.isArray(req.query.name) ? req.query.name[0] : req.query.name;
  const action = handlers[name];
  if (!action) return res.status(404).json({ error: { code: 'functions/not-found', message: 'Server function not found.' } });
  try {
    const data = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new ApiError('invalid-argument', 'Request data is invalid.');
    }
    const identity = ['requestSignupOtp', 'verifySignupOtp', 'requestAgentOtp', 'verifyAgentLogin'].includes(name)
      ? null
      : await authenticate(req);
    const result = await action(data, identity);
    return res.status(200).json({ data: result });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return sendError(res, new ApiError('invalid-argument', 'Request data is invalid.'));
    }
    return sendError(res, error);
  }
}

module.exports = { handle };

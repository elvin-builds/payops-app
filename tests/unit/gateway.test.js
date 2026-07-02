const jwt = require('jsonwebtoken');

const JWT_SECRET = 'test-secret';

describe('API Gateway - JWT Auth Middleware', () => {
  // Simulate the jwtAuth middleware from api-gateway
  function jwtAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    try {
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, JWT_SECRET);
      req.headers['x-user-id'] = decoded.userId;
      req.headers['x-user-email'] = decoded.email;
      req.headers['x-user-role'] = decoded.role;
      next();
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  }

  function mockRes() {
    const res = { statusCode: null, body: null };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (data) => { res.body = data; return res; };
    return res;
  }

  test('should reject request with no Authorization header', () => {
    const req = { headers: {} };
    const res = mockRes();
    let nextCalled = false;

    jwtAuth(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('Authentication required');
  });

  test('should reject request with malformed Authorization header', () => {
    const req = { headers: { authorization: 'Basic abc123' } };
    const res = mockRes();
    let nextCalled = false;

    jwtAuth(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  test('should reject request with invalid token', () => {
    const req = { headers: { authorization: 'Bearer invalid.token.here' } };
    const res = mockRes();
    let nextCalled = false;

    jwtAuth(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('Invalid or expired token');
  });

  test('should reject expired token', () => {
    const token = jwt.sign(
      { userId: '123', email: 'test@payops.local', role: 'user' },
      JWT_SECRET,
      { expiresIn: '0s' }
    );
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = mockRes();
    let nextCalled = false;

    jwtAuth(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  test('should accept valid token and set user headers', () => {
    const token = jwt.sign(
      { userId: 'abc-123', email: 'user@test.com', role: 'admin' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = mockRes();
    let nextCalled = false;

    jwtAuth(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(true);
    expect(req.headers['x-user-id']).toBe('abc-123');
    expect(req.headers['x-user-email']).toBe('user@test.com');
    expect(req.headers['x-user-role']).toBe('admin');
  });
});

describe('API Gateway - Path Normalization', () => {
  function normalizePath(req) {
    const path = req.originalUrl.split('?')[0];
    if (path === '/health') return '/health';
    if (path === '/metrics') return '/metrics';
    if (path.startsWith('/api/auth')) return '/api/auth';
    if (path.startsWith('/api/transactions')) return '/api/transactions';
    if (path.startsWith('/api/notifications')) return '/api/notifications';
    return path;
  }

  test('should normalize auth paths', () => {
    expect(normalizePath({ originalUrl: '/api/auth/login' })).toBe('/api/auth');
    expect(normalizePath({ originalUrl: '/api/auth/register?foo=bar' })).toBe('/api/auth');
  });

  test('should normalize transaction paths', () => {
    expect(normalizePath({ originalUrl: '/api/transactions' })).toBe('/api/transactions');
    expect(normalizePath({ originalUrl: '/api/transactions/abc-123' })).toBe('/api/transactions');
  });

  test('should preserve health and metrics paths', () => {
    expect(normalizePath({ originalUrl: '/health' })).toBe('/health');
    expect(normalizePath({ originalUrl: '/metrics' })).toBe('/metrics');
  });

  test('should strip query parameters', () => {
    expect(normalizePath({ originalUrl: '/api/transactions?limit=10&offset=20' })).toBe('/api/transactions');
  });
});

describe('API Gateway - CORS Validation', () => {
  test('should allow listed origin', () => {
    const ALLOWED_ORIGINS = ['http://localhost:3000', 'https://app.payops.com'];
    const origin = 'http://localhost:3000';
    expect(ALLOWED_ORIGINS.includes(origin)).toBe(true);
  });

  test('should reject unlisted origin', () => {
    const ALLOWED_ORIGINS = ['http://localhost:3000', 'https://app.payops.com'];
    const origin = 'https://evil.com';
    expect(ALLOWED_ORIGINS.includes(origin)).toBe(false);
  });

  test('should allow no origin (curl/server-to-server)', () => {
    const ALLOWED_ORIGINS = ['http://localhost:3000'];
    const origin = undefined;
    expect(!origin || ALLOWED_ORIGINS.includes(origin)).toBe(true);
  });
});

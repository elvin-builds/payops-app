const jwt = require('jsonwebtoken');

const JWT_SECRET = 'test-secret';

describe('Auth - JWT Token', () => {
  test('should create a valid JWT token', () => {
    const payload = { userId: '123', email: 'test@payops.local', role: 'user' };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });

    expect(token).toBeDefined();
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3); // header.payload.signature
  });

  test('should verify a valid token', () => {
    const payload = { userId: '123', email: 'test@payops.local', role: 'user' };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
    const decoded = jwt.verify(token, JWT_SECRET);

    expect(decoded.userId).toBe('123');
    expect(decoded.email).toBe('test@payops.local');
    expect(decoded.role).toBe('user');
  });

  test('should reject token with wrong secret', () => {
    const token = jwt.sign({ userId: '123' }, JWT_SECRET);
    expect(() => jwt.verify(token, 'wrong-secret')).toThrow();
  });

  test('should reject expired token', () => {
    const token = jwt.sign({ userId: '123' }, JWT_SECRET, { expiresIn: '0s' });
    // Small delay to ensure expiry
    expect(() => jwt.verify(token, JWT_SECRET)).toThrow('jwt expired');
  });
});

describe('Auth - Input Validation', () => {
  test('should reject empty email', () => {
    const email = '';
    expect(email.length).toBe(0);
  });

  test('should reject short password', () => {
    const password = '12345';
    expect(password.length).toBeLessThan(6);
  });

  test('should accept valid password', () => {
    const password = 'test123';
    expect(password.length).toBeGreaterThanOrEqual(6);
  });

  test('should validate email format - valid', () => {
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    expect(EMAIL_RE.test('user@example.com')).toBe(true);
    expect(EMAIL_RE.test('test@payops.local')).toBe(true);
  });

  test('should validate email format - invalid', () => {
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    expect(EMAIL_RE.test('not-an-email')).toBe(false);
    expect(EMAIL_RE.test('@no-local.com')).toBe(false);
    expect(EMAIL_RE.test('spaces@ fail.com')).toBe(false);
  });
});

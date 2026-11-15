import { ConfigService } from '@nestjs/config';
import { RocketChatService } from './rocketchat.service';

function buildService(values: Record<string, string>): RocketChatService {
  const config = {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
  return new RocketChatService(config);
}

const ENABLED = {
  ROCKETCHAT_URL: 'http://chat.local/',
  ROCKETCHAT_BOT_USER_ID: 'bot',
  ROCKETCHAT_BOT_TOKEN: 'bot-token',
};

function mockFetch(status: number, body: unknown): jest.Mock {
  const fn = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
  global.fetch = fn;
  return fn;
}

describe('RocketChatService password and session calls', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('login', () => {
    it('returns the session on success without sending the bot headers', async () => {
      const fetchMock = mockFetch(200, {
        status: 'success',
        data: { userId: 'rc-1', authToken: 'tok' },
      });

      const result = await buildService(ENABLED).login('a@b.com', 'secret1');

      expect(result).toEqual({
        status: 'ok',
        session: { user_id: 'rc-1', auth_token: 'tok' },
      });
      const [url, init] = fetchMock.mock.calls[0] as [
        string,
        { headers: Record<string, string> },
      ];
      expect(url).toBe('http://chat.local/api/v1/login');
      expect(init.headers['X-Auth-Token']).toBeUndefined();
    });

    it('reports a rejection for wrong credentials', async () => {
      mockFetch(401, { status: 'error', message: 'Unauthorized' });

      await expect(
        buildService(ENABLED).login('a@b.com', 'wrong'),
      ).resolves.toEqual({ status: 'rejected' });
    });

    it('reports unavailable when the server errors', async () => {
      mockFetch(500, { status: 'error' });

      await expect(
        buildService(ENABLED).login('a@b.com', 'secret1'),
      ).resolves.toEqual({ status: 'unavailable' });
    });

    it('reports unavailable when the server cannot be reached', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(
        buildService(ENABLED).login('a@b.com', 'secret1'),
      ).resolves.toEqual({ status: 'unavailable' });
    });

    it('reports unavailable when the integration is not configured', async () => {
      const fetchMock = mockFetch(200, {});

      await expect(buildService({}).login('a@b.com', 'x')).resolves.toEqual({
        status: 'unavailable',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('setUserPassword', () => {
    it('updates the user through the admin endpoint', async () => {
      const fetchMock = mockFetch(200, { success: true });

      await expect(
        buildService(ENABLED).setUserPassword('rc-1', 'newSecret1'),
      ).resolves.toBe(true);
      const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }];
      expect(url).toBe('http://chat.local/api/v1/users.update');
      expect(JSON.parse(init.body)).toEqual({
        userId: 'rc-1',
        data: { password: 'newSecret1' },
      });
    });

    it('returns false when Rocket.Chat refuses the password', async () => {
      mockFetch(400, { success: false, error: 'Password too short' });

      await expect(
        buildService(ENABLED).setUserPassword('rc-1', 'abc'),
      ).resolves.toBe(false);
    });
  });

  describe('createUserToken', () => {
    const WITH_SECRET = { ...ENABLED, ROCKETCHAT_TOKEN_SECRET: 'shared' };

    it('returns the generated session and sends the shared secret', async () => {
      const fetchMock = mockFetch(200, {
        success: true,
        data: { userId: 'rc-1', authToken: 'fresh' },
      });

      await expect(
        buildService(WITH_SECRET).createUserToken('rc-1'),
      ).resolves.toEqual({ user_id: 'rc-1', auth_token: 'fresh' });
      const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
      expect(JSON.parse(init.body)).toEqual({
        userId: 'rc-1',
        secret: 'shared',
      });
    });

    it('does nothing when no token secret is configured', async () => {
      const fetchMock = mockFetch(200, {});

      await expect(
        buildService(ENABLED).createUserToken('rc-1'),
      ).resolves.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns null when the request fails', async () => {
      mockFetch(403, { success: false });

      await expect(
        buildService(WITH_SECRET).createUserToken('rc-1'),
      ).resolves.toBeNull();
    });
  });
});

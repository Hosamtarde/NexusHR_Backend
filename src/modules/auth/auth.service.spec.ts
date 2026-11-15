import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';

const SESSION = { user_id: 'rc-1', auth_token: 'chat-token' };

describe('AuthService chat session', () => {
  let usersService: {
    findByEmailWithPassword: jest.Mock;
    findByIdWithChat: jest.Mock;
  };
  let jwt: { signAsync: jest.Mock; decode: jest.Mock; verifyAsync: jest.Mock };
  let refreshRepo: {
    save: jest.Mock;
    create: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
  };
  let chat: { loginWithSync: jest.Mock; renewSession: jest.Mock };
  let service: AuthService;
  let user: Record<string, unknown>;

  beforeEach(async () => {
    user = {
      user_id: 7,
      first_name: 'Ahmad',
      last_name: 'Ali',
      email: 'ahmad@example.com',
      role: 'employee',
      status: true,
      chat_user_id: 'rc-1',
      password: await bcrypt.hash('secret123', 4),
    };
    usersService = {
      findByEmailWithPassword: jest.fn().mockResolvedValue(user),
      findByIdWithChat: jest.fn().mockResolvedValue(user),
    };
    jwt = {
      signAsync: jest.fn().mockResolvedValue('jwt'),
      decode: jest.fn().mockReturnValue({ exp: 4102444800 }),
      verifyAsync: jest.fn().mockResolvedValue({ sub: 7 }),
    };
    refreshRepo = {
      save: jest.fn().mockImplementation((value: unknown) => value),
      create: jest.fn().mockImplementation((value: unknown) => value),
      findOne: jest.fn().mockResolvedValue({
        revoked_at: null,
        expires_at: new Date(Date.now() + 60_000),
      }),
      update: jest.fn(),
    };
    chat = {
      loginWithSync: jest.fn().mockResolvedValue(SESSION),
      renewSession: jest.fn().mockResolvedValue(SESSION),
    };
    const config = { getOrThrow: jest.fn().mockReturnValue('x') };
    service = new AuthService(
      usersService as never,
      jwt as never,
      config as never,
      chat as never,
      refreshRepo as never,
    );
  });

  describe('login', () => {
    it('adds the chat session and keeps the existing fields', async () => {
      const result = await service.login({
        email: 'ahmad@example.com',
        password: 'secret123',
      });

      expect(result.chat).toEqual(SESSION);
      expect(result.access_token).toBe('jwt');
      expect(result.refresh_token).toBe('jwt');
      expect(result.user).toEqual({
        user_id: 7,
        first_name: 'Ahmad',
        last_name: 'Ali',
        email: 'ahmad@example.com',
        role: 'employee',
      });
      expect(chat.loginWithSync).toHaveBeenCalledWith(user, 'secret123');
    });

    it('still logs in with chat null when Rocket.Chat is down', async () => {
      chat.loginWithSync.mockResolvedValue(null);

      const result = await service.login({
        email: 'ahmad@example.com',
        password: 'secret123',
      });

      expect(result.chat).toBeNull();
      expect(result.access_token).toBe('jwt');
    });

    it('does not contact the chat when the system password is wrong', async () => {
      await expect(
        service.login({ email: 'ahmad@example.com', password: 'wrong-pass' }),
      ).rejects.toThrow('Invalid email or password');
      expect(chat.loginWithSync).not.toHaveBeenCalled();
    });
  });

  describe('refreshToken', () => {
    it('adds a renewed chat session to the new tokens', async () => {
      const result = await service.refreshToken('old-refresh');

      expect(result.chat).toEqual(SESSION);
      expect(result.access_token).toBe('jwt');
      expect(chat.renewSession).toHaveBeenCalledWith(user);
    });

    it('still refreshes with chat null when Rocket.Chat is down', async () => {
      chat.renewSession.mockResolvedValue(null);

      const result = await service.refreshToken('old-refresh');

      expect(result.chat).toBeNull();
      expect(result.refresh_token).toBe('jwt');
    });
  });
});

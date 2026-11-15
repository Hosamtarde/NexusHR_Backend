import { Logger } from '@nestjs/common';
import { ChatCredentialsService } from './chat-credentials.service';
import { RocketChatService } from './rocketchat.service';

const SESSION = { user_id: 'rc-1', auth_token: 'token-1' };
const USER = { user_id: 7, email: 'ahmad@example.com', chat_user_id: 'rc-1' };

describe('ChatCredentialsService', () => {
  let rocketChat: {
    isEnabled: jest.Mock;
    login: jest.Mock;
    setUserPassword: jest.Mock;
    createUserToken: jest.Mock;
    findUser: jest.Mock;
  };
  let provisioning: { provisionEmployee: jest.Mock };
  let query: jest.Mock;
  let service: ChatCredentialsService;

  beforeEach(() => {
    rocketChat = {
      isEnabled: jest.fn().mockReturnValue(true),
      login: jest.fn(),
      setUserPassword: jest.fn(),
      createUserToken: jest.fn(),
      findUser: jest.fn(),
    };
    provisioning = { provisionEmployee: jest.fn() };
    query = jest.fn();
    service = new ChatCredentialsService(
      { manager: { query } } as never,
      rocketChat as unknown as RocketChatService,
      provisioning as never,
    );
  });

  describe('loginWithSync', () => {
    it('returns the session when the passwords already match', async () => {
      rocketChat.login.mockResolvedValue({ status: 'ok', session: SESSION });

      await expect(service.loginWithSync(USER, 'secret123')).resolves.toEqual(
        SESSION,
      );
      expect(rocketChat.login).toHaveBeenCalledWith(USER.email, 'secret123');
      expect(rocketChat.setUserPassword).not.toHaveBeenCalled();
    });

    it('resets the chat password and retries when the login is rejected', async () => {
      rocketChat.login
        .mockResolvedValueOnce({ status: 'rejected' })
        .mockResolvedValueOnce({ status: 'ok', session: SESSION });
      rocketChat.setUserPassword.mockResolvedValue(true);

      await expect(service.loginWithSync(USER, 'secret123')).resolves.toEqual(
        SESSION,
      );
      expect(rocketChat.setUserPassword).toHaveBeenCalledWith(
        'rc-1',
        'secret123',
      );
      expect(rocketChat.login).toHaveBeenCalledTimes(2);
    });

    it('returns null when the password reset fails', async () => {
      rocketChat.login.mockResolvedValue({ status: 'rejected' });
      rocketChat.setUserPassword.mockResolvedValue(false);

      await expect(
        service.loginWithSync(USER, 'secret123'),
      ).resolves.toBeNull();
      expect(rocketChat.login).toHaveBeenCalledTimes(1);
    });

    it('returns null when the login still fails after the reset', async () => {
      rocketChat.login.mockResolvedValue({ status: 'rejected' });
      rocketChat.setUserPassword.mockResolvedValue(true);

      await expect(
        service.loginWithSync(USER, 'secret123'),
      ).resolves.toBeNull();
    });

    it('does not try to heal when Rocket.Chat is down', async () => {
      rocketChat.login.mockResolvedValue({ status: 'unavailable' });

      await expect(
        service.loginWithSync(USER, 'secret123'),
      ).resolves.toBeNull();
      expect(rocketChat.setUserPassword).not.toHaveBeenCalled();
    });

    describe('legacy account without a chat user id', () => {
      const LEGACY = { ...USER, chat_user_id: null };

      it('links an existing chat account, resets its password and logs in', async () => {
        rocketChat.findUser.mockResolvedValue({
          user: { _id: 'rc-9', username: 'ahmad' },
        });
        rocketChat.setUserPassword.mockResolvedValue(true);
        rocketChat.login.mockResolvedValue({ status: 'ok', session: SESSION });
        query.mockResolvedValue([]);

        await expect(
          service.loginWithSync(LEGACY, 'secret123'),
        ).resolves.toEqual(SESSION);
        expect(rocketChat.findUser).toHaveBeenCalledWith(
          'ahmad@example.com',
          'ahmad',
        );
        expect(query).toHaveBeenCalledWith(
          expect.stringContaining('UPDATE users SET chat_user_id'),
          ['rc-9', 7],
        );
        expect(rocketChat.setUserPassword).toHaveBeenCalledWith(
          'rc-9',
          'secret123',
        );
        expect(provisioning.provisionEmployee).not.toHaveBeenCalled();
      });

      it('creates the chat account when none exists', async () => {
        rocketChat.findUser.mockResolvedValue({ user: null });
        provisioning.provisionEmployee.mockResolvedValue(undefined);
        query.mockResolvedValue([{ chat_user_id: 'rc-new' }]);
        rocketChat.login.mockResolvedValue({ status: 'ok', session: SESSION });

        await expect(
          service.loginWithSync(LEGACY, 'secret123'),
        ).resolves.toEqual(SESSION);
        expect(provisioning.provisionEmployee).toHaveBeenCalledWith(
          7,
          'secret123',
        );
        expect(rocketChat.setUserPassword).not.toHaveBeenCalled();
      });

      it('returns null when creation did not store an id', async () => {
        rocketChat.findUser.mockResolvedValue({ user: null });
        query.mockResolvedValue([{ chat_user_id: null }]);

        await expect(
          service.loginWithSync(LEGACY, 'secret123'),
        ).resolves.toBeNull();
        expect(rocketChat.login).not.toHaveBeenCalled();
      });

      it('returns null without creating anything when Rocket.Chat is down', async () => {
        rocketChat.findUser.mockResolvedValue(null);

        await expect(
          service.loginWithSync(LEGACY, 'secret123'),
        ).resolves.toBeNull();
        expect(provisioning.provisionEmployee).not.toHaveBeenCalled();
        expect(rocketChat.setUserPassword).not.toHaveBeenCalled();
      });

      it('never throws and does not log the password', async () => {
        rocketChat.findUser.mockRejectedValue(new Error('boom'));
        const spy = jest
          .spyOn(Logger.prototype, 'error')
          .mockImplementation(() => undefined);

        await expect(
          service.loginWithSync(LEGACY, 'secret123'),
        ).resolves.toBeNull();
        expect(JSON.stringify(spy.mock.calls)).not.toContain('secret123');
        spy.mockRestore();
      });
    });

    it('returns null without calling Rocket.Chat when the integration is off', async () => {
      rocketChat.isEnabled.mockReturnValue(false);

      await expect(
        service.loginWithSync(USER, 'secret123'),
      ).resolves.toBeNull();
      expect(rocketChat.login).not.toHaveBeenCalled();
    });

    it('never throws when Rocket.Chat errors out', async () => {
      rocketChat.login.mockRejectedValue(new Error('boom'));

      await expect(
        service.loginWithSync(USER, 'secret123'),
      ).resolves.toBeNull();
    });
  });

  describe('renewSession', () => {
    it('asks Rocket.Chat for a fresh token for the chat user', async () => {
      rocketChat.createUserToken.mockResolvedValue(SESSION);

      await expect(service.renewSession(USER)).resolves.toEqual(SESSION);
      expect(rocketChat.createUserToken).toHaveBeenCalledWith('rc-1');
    });

    it('returns null for an account without a chat user id', async () => {
      await expect(
        service.renewSession({ ...USER, chat_user_id: null }),
      ).resolves.toBeNull();
      expect(rocketChat.createUserToken).not.toHaveBeenCalled();
    });

    it('never throws when Rocket.Chat errors out', async () => {
      rocketChat.createUserToken.mockRejectedValue(new Error('boom'));

      await expect(service.renewSession(USER)).resolves.toBeNull();
    });
  });

  describe('syncPassword', () => {
    it('sets the chat password of the stored chat user', async () => {
      query.mockResolvedValue([{ chat_user_id: 'rc-1' }]);
      rocketChat.setUserPassword.mockResolvedValue(true);

      await expect(service.syncPassword(7, 'newSecret1')).resolves.toBe(true);
      expect(rocketChat.setUserPassword).toHaveBeenCalledWith(
        'rc-1',
        'newSecret1',
      );
    });

    it('returns false when Rocket.Chat refuses the change', async () => {
      query.mockResolvedValue([{ chat_user_id: 'rc-1' }]);
      rocketChat.setUserPassword.mockResolvedValue(false);

      await expect(service.syncPassword(7, 'newSecret1')).resolves.toBe(false);
    });

    it('returns false when the user has no chat account', async () => {
      query.mockResolvedValue([{ chat_user_id: null }]);

      await expect(service.syncPassword(7, 'newSecret1')).resolves.toBe(false);
      expect(rocketChat.setUserPassword).not.toHaveBeenCalled();
    });

    it('never throws when the lookup fails', async () => {
      query.mockRejectedValue(new Error('db down'));

      await expect(service.syncPassword(7, 'newSecret1')).resolves.toBe(false);
    });
  });
});

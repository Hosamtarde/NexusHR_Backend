import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UsersService } from './users.service';
import { ChatCredentialsService } from '../rocketchat/chat-credentials.service';

describe('UsersService password changes', () => {
  let repository: {
    findOne: jest.Mock;
    update: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let chat: { syncPassword: jest.Mock };
  let service: UsersService;

  beforeEach(() => {
    repository = {
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
      createQueryBuilder: jest.fn(),
    };
    chat = { syncPassword: jest.fn().mockResolvedValue(true) };
    service = new UsersService(
      repository as never,
      chat as unknown as ChatCredentialsService,
    );
  });

  describe('setPassword (HR)', () => {
    it('hashes the password, updates the same account and syncs the chat', async () => {
      repository.findOne.mockResolvedValue({ user_id: 5, status: true });

      const result = await service.setPassword(5, 'brandNew123', 1);

      expect(result).toEqual({ message: 'Password updated successfully' });
      const [id, changes] = repository.update.mock.calls[0] as [
        number,
        { password: string },
      ];
      expect(id).toBe(5);
      expect(changes.password).not.toBe('brandNew123');
      await expect(
        bcrypt.compare('brandNew123', changes.password),
      ).resolves.toBe(true);
      expect(chat.syncPassword).toHaveBeenCalledWith(5, 'brandNew123');
    });

    it('rejects an unknown user', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.setPassword(99, 'brandNew123', 1)).rejects.toThrow(
        NotFoundException,
      );
      expect(repository.update).not.toHaveBeenCalled();
      expect(chat.syncPassword).not.toHaveBeenCalled();
    });

    it('rejects an inactive user', async () => {
      repository.findOne.mockResolvedValue({ user_id: 5, status: false });

      await expect(service.setPassword(5, 'brandNew123', 1)).rejects.toThrow(
        NotFoundException,
      );
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('still succeeds when the chat sync fails', async () => {
      repository.findOne.mockResolvedValue({ user_id: 5, status: true });
      chat.syncPassword.mockResolvedValue(false);

      await expect(service.setPassword(5, 'brandNew123', 1)).resolves.toEqual({
        message: 'Password updated successfully',
      });
      expect(repository.update).toHaveBeenCalledTimes(1);
    });
  });

  describe('changePassword (self)', () => {
    function mockStoredUser(hash: string): void {
      const builder = {
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({ user_id: 3, password: hash }),
      };
      repository.createQueryBuilder.mockReturnValue(builder);
    }

    it('syncs the new password to the chat after saving it', async () => {
      mockStoredUser(await bcrypt.hash('oldPassword1', 4));

      await service.changePassword(3, {
        current_password: 'oldPassword1',
        new_password: 'newPassword2',
      });

      expect(repository.update).toHaveBeenCalledTimes(1);
      expect(chat.syncPassword).toHaveBeenCalledWith(3, 'newPassword2');
    });

    it('still succeeds when the chat sync fails', async () => {
      mockStoredUser(await bcrypt.hash('oldPassword1', 4));
      chat.syncPassword.mockResolvedValue(false);

      await expect(
        service.changePassword(3, {
          current_password: 'oldPassword1',
          new_password: 'newPassword2',
        }),
      ).resolves.toEqual({ message: 'Password changed successfully' });
    });

    it('does not touch the chat when the current password is wrong', async () => {
      mockStoredUser(await bcrypt.hash('oldPassword1', 4));

      await expect(
        service.changePassword(3, {
          current_password: 'nope',
          new_password: 'newPassword2',
        }),
      ).rejects.toThrow(UnauthorizedException);
      expect(chat.syncPassword).not.toHaveBeenCalled();
    });
  });
});

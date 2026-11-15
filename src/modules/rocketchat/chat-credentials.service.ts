import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ChatSession, RocketChatService } from './rocketchat.service';
import { ChatProvisioningService } from './chat-provisioning.service';
import { buildChatUsername } from './chat-provisioning.helper';

export interface ChatAccountRef {
  user_id: number;
  email: string;
  chat_user_id: string | null;
}

@Injectable()
export class ChatCredentialsService {
  private readonly logger = new Logger(ChatCredentialsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly rocketChat: RocketChatService,
    private readonly provisioning: ChatProvisioningService,
  ) {}

  /**
   * Logs the user in to Rocket.Chat with the system password. When the chat
   * account has a different password (legacy account), the password is reset
   * to the system one and the login is retried. Never throws.
   */
  async loginWithSync(
    user: ChatAccountRef,
    password: string,
  ): Promise<ChatSession | null> {
    if (!this.rocketChat.isEnabled()) {
      return null;
    }

    try {
      if (!user.chat_user_id) {
        return await this.healLegacyAccount(user, password);
      }

      const first = await this.rocketChat.login(user.email, password);
      if (first.status === 'ok') {
        return first.session;
      }
      if (first.status === 'unavailable') {
        return null;
      }

      const reset = await this.rocketChat.setUserPassword(
        user.chat_user_id,
        password,
      );
      if (!reset) {
        this.logger.warn(
          `Chat password sync failed for user #${user.user_id}, it will be retried on the next login`,
        );
        return null;
      }

      const retry = await this.rocketChat.login(user.email, password);
      if (retry.status !== 'ok') {
        this.logger.warn(
          `Chat login still failing after the password sync for user #${user.user_id}`,
        );
        return null;
      }

      this.logger.log(`Chat password re-synced for user #${user.user_id}`);
      return retry.session;
    } catch (error) {
      this.logger.error(
        `Chat login failed for user #${user.user_id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  /**
   * Accounts created before the chat integration have no chat_user_id.
   * Finds the Rocket.Chat account (or creates it), stores its id, sets the
   * system password and logs in.
   */
  private async healLegacyAccount(
    user: ChatAccountRef,
    password: string,
  ): Promise<ChatSession | null> {
    const found = await this.rocketChat.findUser(
      user.email,
      buildChatUsername(user.email),
    );
    if (!found) {
      this.logger.warn(
        `Chat account lookup failed for user #${user.user_id}, it will be retried on the next login`,
      );
      return null;
    }

    if (found.user) {
      await this.dataSource.manager.query(
        `UPDATE users SET chat_user_id = ? WHERE user_id = ? AND chat_user_id IS NULL`,
        [found.user._id, user.user_id],
      );
      const reset = await this.rocketChat.setUserPassword(
        found.user._id,
        password,
      );
      if (!reset) {
        this.logger.warn(
          `Chat password sync failed for user #${user.user_id}, it will be retried on the next login`,
        );
        return null;
      }
      this.logger.log(`Chat account linked for user #${user.user_id}`);
    } else {
      await this.provisioning.provisionEmployee(user.user_id, password);
      const rows = await this.dataSource.manager.query<
        { chat_user_id: string | null }[]
      >(`SELECT chat_user_id FROM users WHERE user_id = ?`, [user.user_id]);
      if (!rows[0]?.chat_user_id) {
        return null;
      }
    }

    const result = await this.rocketChat.login(user.email, password);
    return result.status === 'ok' ? result.session : null;
  }

  /**
   * Issues a fresh Rocket.Chat token for the user without needing the
   * password (used on token refresh). Never throws.
   */
  async renewSession(user: ChatAccountRef): Promise<ChatSession | null> {
    if (!this.rocketChat.isEnabled() || !user.chat_user_id) {
      return null;
    }

    try {
      return await this.rocketChat.createUserToken(user.chat_user_id);
    } catch (error) {
      this.logger.error(
        `Chat token renewal failed for user #${user.user_id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  /**
   * Sets the chat password of a user to the given system password.
   * Returns false when the sync could not be done. Never throws.
   */
  async syncPassword(userId: number, password: string): Promise<boolean> {
    if (!this.rocketChat.isEnabled()) {
      return false;
    }

    try {
      const rows = await this.dataSource.manager.query<
        { chat_user_id: string | null }[]
      >(`SELECT chat_user_id FROM users WHERE user_id = ?`, [userId]);
      const chatUserId = rows[0]?.chat_user_id;
      if (!chatUserId) {
        return false;
      }

      const done = await this.rocketChat.setUserPassword(chatUserId, password);
      if (!done) {
        this.logger.warn(
          `Chat password sync failed for user #${userId}, it will be retried on the next login`,
        );
      }
      return done;
    } catch (error) {
      this.logger.error(
        `Chat password sync failed for user #${userId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ChatSession, RocketChatService } from './rocketchat.service';

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
      const first = await this.rocketChat.login(user.email, password);
      if (first.status === 'ok') {
        return first.session;
      }
      if (first.status === 'unavailable' || !user.chat_user_id) {
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

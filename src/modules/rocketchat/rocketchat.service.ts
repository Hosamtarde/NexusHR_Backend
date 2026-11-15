import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface RocketChatUser {
  _id: string;
  username: string;
}

export interface RocketChatChannel {
  _id: string;
  name: string;
}

export interface ChatSession {
  user_id: string;
  auth_token: string;
}

export type ChatLoginResult =
  | { status: 'ok'; session: ChatSession }
  | { status: 'rejected' }
  | { status: 'unavailable' };

export interface CreateChatUserInput {
  username: string;
  name: string;
  email: string;
  password: string;
}

@Injectable()
export class RocketChatService {
  private readonly logger = new Logger(RocketChatService.name);
  private readonly baseUrl: string;
  private readonly botUserId: string;
  private readonly botToken: string;
  private readonly tokenSecret: string;
  private readonly enabled: boolean;
  private readonly timeoutMs = 5000;
  private readonly usernames = new Map<string, string>();

  constructor(config: ConfigService) {
    this.baseUrl = (config.get<string>('ROCKETCHAT_URL') ?? '').replace(
      /\/+$/,
      '',
    );
    this.botUserId = config.get<string>('ROCKETCHAT_BOT_USER_ID') ?? '';
    this.botToken = config.get<string>('ROCKETCHAT_BOT_TOKEN') ?? '';
    this.tokenSecret = config.get<string>('ROCKETCHAT_TOKEN_SECRET') ?? '';
    this.enabled = Boolean(this.baseUrl && this.botUserId && this.botToken);

    if (!this.enabled) {
      this.logger.warn(
        'Rocket.Chat credentials are missing, chat integration is disabled',
      );
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async createUser(input: CreateChatUserInput): Promise<RocketChatUser | null> {
    const result = await this.request<{ user: RocketChatUser }>(
      'POST',
      'users.create',
      {
        username: input.username,
        name: input.name,
        email: input.email,
        password: input.password,
        verified: true,
        requirePasswordChange: false,
        sendWelcomeEmail: false,
        joinDefaultChannels: false,
      },
    );
    return result?.user ?? null;
  }

  async setUserPassword(
    chatUserId: string,
    password: string,
  ): Promise<boolean> {
    const result = await this.request('POST', 'users.update', {
      userId: chatUserId,
      data: { password },
    });
    return result !== null;
  }

  async createUserToken(chatUserId: string): Promise<ChatSession | null> {
    if (!this.tokenSecret) {
      return null;
    }

    const result = await this.request<{
      data: { userId: string; authToken: string };
    }>('POST', 'users.createToken', {
      userId: chatUserId,
      secret: this.tokenSecret,
    });
    if (!result?.data?.userId || !result.data.authToken) {
      return null;
    }
    return { user_id: result.data.userId, auth_token: result.data.authToken };
  }

  async login(identifier: string, password: string): Promise<ChatLoginResult> {
    if (!this.enabled) {
      return { status: 'unavailable' };
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/v1/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: identifier, password }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      const payload = (await response.json().catch(() => null)) as {
        data?: { userId?: string; authToken?: string };
      } | null;

      if (response.ok && payload?.data?.userId && payload.data.authToken) {
        return {
          status: 'ok',
          session: {
            user_id: payload.data.userId,
            auth_token: payload.data.authToken,
          },
        };
      }

      if (response.status === 401 || response.status === 403) {
        this.logger.debug('Rocket.Chat rejected the login credentials');
        return { status: 'rejected' };
      }

      this.logger.error(
        `Rocket.Chat POST login failed with status ${response.status}`,
      );
      return { status: 'unavailable' };
    } catch (error) {
      this.logger.error(
        `Rocket.Chat POST login could not be reached: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { status: 'unavailable' };
    }
  }

  async getUsername(chatUserId: string): Promise<string | null> {
    const cached = this.usernames.get(chatUserId);
    if (cached) {
      return cached;
    }

    const result = await this.request<{ user: { username: string } }>(
      'GET',
      `users.info?userId=${encodeURIComponent(chatUserId)}`,
    );
    const username = result?.user?.username ?? null;
    if (username) {
      this.usernames.set(chatUserId, username);
    }
    return username;
  }

  async setUserActive(userId: string, active: boolean): Promise<boolean> {
    const result = await this.request('POST', 'users.update', {
      userId,
      data: { active },
    });
    return result !== null;
  }

  async getChannelByName(name: string): Promise<RocketChatChannel | null> {
    const result = await this.request<{ channel: RocketChatChannel }>(
      'GET',
      `channels.info?roomName=${encodeURIComponent(name)}`,
      undefined,
      true,
    );
    return result?.channel ?? null;
  }

  async createChannel(name: string): Promise<RocketChatChannel | null> {
    const result = await this.request<{ channel: RocketChatChannel }>(
      'POST',
      'channels.create',
      { name },
    );
    return result?.channel ?? null;
  }

  async ensureChannel(name: string): Promise<RocketChatChannel | null> {
    const existing = await this.getChannelByName(name);
    if (existing) {
      return existing;
    }
    return this.createChannel(name);
  }

  async addToChannel(roomId: string, userId: string): Promise<boolean> {
    const result = await this.request('POST', 'channels.invite', {
      roomId,
      userId,
    });
    return result !== null;
  }

  async removeFromChannel(roomId: string, userId: string): Promise<boolean> {
    const result = await this.request('POST', 'channels.kick', {
      roomId,
      userId,
    });
    return result !== null;
  }

  async sendDirectMessage(username: string, text: string): Promise<boolean> {
    const result = await this.request('POST', 'chat.postMessage', {
      channel: `@${username}`,
      text,
    });
    return result !== null;
  }

  async sendDirectMessageToUserId(
    chatUserId: string,
    text: string,
  ): Promise<boolean> {
    const username = await this.getUsername(chatUserId);
    if (!username) {
      return false;
    }
    return this.sendDirectMessage(username, text);
  }

  async sendToChannel(channelName: string, text: string): Promise<boolean> {
    const result = await this.request('POST', 'chat.postMessage', {
      channel: `#${channelName}`,
      text,
    });
    return result !== null;
  }

  private async request<T = Record<string, unknown>>(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
    quietWhenMissing = false,
  ): Promise<T | null> {
    if (!this.enabled) {
      return null;
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/v1/${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': this.botUserId,
          'X-Auth-Token': this.botToken,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      const payload = (await response.json().catch(() => null)) as
        | (Record<string, unknown> & { success?: boolean; error?: string })
        | null;

      if (!response.ok || !payload || payload.success === false) {
        const message = `Rocket.Chat ${method} ${path} failed with status ${response.status}${
          payload?.error ? `: ${payload.error}` : ''
        }`;
        if (
          quietWhenMissing &&
          (response.status === 400 || response.status === 404)
        ) {
          this.logger.debug(message);
        } else {
          this.logger.error(message);
        }
        return null;
      }

      return payload as T;
    } catch (error) {
      this.logger.error(
        `Rocket.Chat ${method} ${path} could not be reached: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }
}

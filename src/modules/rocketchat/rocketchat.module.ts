import { Module } from '@nestjs/common';
import { RocketChatService } from './rocketchat.service';
import { ChatProvisioningService } from './chat-provisioning.service';
import { ChatNotificationService } from './chat-notification.service';
import { ChatCredentialsService } from './chat-credentials.service';

@Module({
  providers: [
    RocketChatService,
    ChatProvisioningService,
    ChatNotificationService,
    ChatCredentialsService,
  ],
  exports: [
    RocketChatService,
    ChatProvisioningService,
    ChatNotificationService,
    ChatCredentialsService,
  ],
})
export class RocketChatModule {}

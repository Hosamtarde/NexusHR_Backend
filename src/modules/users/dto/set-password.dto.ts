import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class SetPasswordDto {
  @ApiProperty({
    example: 'newPassword456',
    minLength: 8,
    description: 'The new password for the account, set by HR',
  })
  @IsString()
  @MinLength(8, { message: 'new_password must be at least 8 characters' })
  new_password!: string;
}

import {
  IsEmail,
  IsNotEmpty,
  IsString,
  IsOptional,
  MaxLength,
} from 'class-validator';

export class ApplyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  applicant_name!: string;

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone_number?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  applied_position!: string;
}

import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UsersController } from './users.controller';
import { SetPasswordDto } from './dto/set-password.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Role } from '../../common/enums/enums';

const handler = Object.getOwnPropertyDescriptor(
  UsersController.prototype,
  'setPassword',
)?.value as () => void;

function contextFor(role: Role): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => UsersController,
    switchToHttp: () => ({
      getRequest: () => ({ user: { user_id: 1, role } }),
    }),
  } as unknown as ExecutionContext;
}

describe('PATCH /users/:id/password access', () => {
  const guard = new RolesGuard(new Reflector());

  it('lets an HR admin through', () => {
    expect(guard.canActivate(contextFor(Role.HR_ADMIN))).toBe(true);
  });

  it('blocks managers', () => {
    expect(() => guard.canActivate(contextFor(Role.MANAGER))).toThrow(
      ForbiddenException,
    );
  });

  it('blocks employees', () => {
    expect(() => guard.canActivate(contextFor(Role.EMPLOYEE))).toThrow(
      ForbiddenException,
    );
  });
});

describe('SetPasswordDto', () => {
  async function errorsFor(value: unknown): Promise<string[]> {
    const dto = plainToInstance(SetPasswordDto, { new_password: value });
    const errors = await validate(dto);
    return errors.map((error) => error.property);
  }

  it('accepts a password of 8 characters', async () => {
    await expect(errorsFor('12345678')).resolves.toEqual([]);
  });

  it('rejects a password shorter than 8 characters', async () => {
    await expect(errorsFor('1234567')).resolves.toEqual(['new_password']);
  });

  it('rejects a missing or non-string password', async () => {
    await expect(errorsFor(undefined)).resolves.toEqual(['new_password']);
    await expect(errorsFor(12345678)).resolves.toEqual(['new_password']);
  });
});

import { getMetadataArgsStorage } from 'typeorm';
import { UserEntity } from './user.entity';

describe('UserEntity', () => {
  function column(name: string) {
    return getMetadataArgsStorage().columns.find(
      (item) => item.target === UserEntity && item.propertyName === name,
    );
  }

  it('does not select the chat account id unless a query asks for it', () => {
    expect(column('chat_user_id')?.options.select).toBe(false);
  });

  it('keeps the password hidden as well', () => {
    expect(column('password')?.options.select).toBe(false);
  });
});

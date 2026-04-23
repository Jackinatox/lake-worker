import { IsBoolean, IsObject, IsOptional, IsString } from 'class-validator';
import type { GameConfigBase } from '../services/order.service';

export class ChangeGameDto {
  @IsString({ message: 'gameSlug must be a string' })
  gameSlug: string;

  @IsString({ message: 'serverId must be a string' })
  ptServerId: string;

  @IsString({ message: 'userId must be a string' })
  userId: string;

  @IsBoolean({ message: 'deleteFiles must be a boolean' })
  @IsOptional()
  deleteFiles?: boolean;

  @IsObject({ message: 'gameConfig must be an object' })
  gameConfig: GameConfigBase;
}

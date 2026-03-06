import {
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
} from 'class-validator';
import type { GameConfigBase } from '../services/order.service';

export class ChangeGameDto {
  @IsInt({ message: 'gameId must be an integer' })
  @IsPositive({ message: 'gameId must be a positive number' })
  gameId: number;

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

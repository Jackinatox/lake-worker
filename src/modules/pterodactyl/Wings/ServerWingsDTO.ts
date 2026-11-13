import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsPositive,
} from 'class-validator';

/** Lake's admin list never shows more than 200 rows; the cap keeps the IN() bounded. */
export const MAX_SERVER_WING_LOOKUP = 500;

export class ServerWingsDTO {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_SERVER_WING_LOOKUP)
  @Type(() => Number)
  @IsInt({ each: true })
  @IsPositive({ each: true })
  ptAdminIds: number[];
}

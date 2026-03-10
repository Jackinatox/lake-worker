import { IsNotEmpty } from 'class-validator';

export class ReassignPortsDTO {
  @IsNotEmpty()
  ptServerId: string;
}

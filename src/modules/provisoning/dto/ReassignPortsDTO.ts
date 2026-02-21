import { IsNotEmpty } from 'class-validator';

export class ReassignPortsDTO {
  @IsNotEmpty()
  serverId: string;
}

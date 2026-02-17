import { IsNotEmpty } from 'class-validator';

export class CreateProvisioningJobDto {
  @IsNotEmpty()
  orderId: string;
}

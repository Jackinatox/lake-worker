import { IsInt, IsPositive } from 'class-validator';

export class CreateProvisioningJobDto {
  @IsInt({ message: 'orderId must be an integer' })
  @IsPositive({ message: 'orderId must be a positive number' })
  orderId: number;
}

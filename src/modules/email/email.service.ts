import { Injectable } from '@nestjs/common';
import { render } from '@react-email/render';
import { LoggerService } from 'src/core/logger.service';
import { EmailType } from 'src/generated/prisma/enums';
import ServerBookingConfirmationTemplate, {
  ServerBookingConfirmationTemplateProps,
} from '../jobs/templates/ServerBookingConfirmation';
import { EmailTransportService } from '../jobs/services/emailTransport.service';

@Injectable()
export class EmailService {
  constructor(
    private readonly emailService: EmailTransportService,
    private readonly logger: LoggerService,
  ) {}

  async sendServerBookingConfirmationEmail(
    recipientEmail: string,
    params: ServerBookingConfirmationTemplateProps,
  ): Promise<void> {
    try {
      const html = await this.renderServerBookinConfirmation(params);

      await this.createAndSend(
        recipientEmail,
        `Dein ${params.gameName} Server ist bereit!`,
        html,
        EmailType.SERVER_BOOKING_CONFIRMATION,
      );
    } catch (error) {
      this.logger.error(
        'Failed to send server booking confirmation email',
        error,
      );
    }
  }

  private async renderServerBookinConfirmation(
    params: ServerBookingConfirmationTemplateProps,
  ): Promise<string> {
    const html = await render(ServerBookingConfirmationTemplate(params));
    return html;
  }

  private async createAndSend(
    recipient: string,
    subject: string,
    html: string,
    type: EmailType,
  ): Promise<void> {
    const mail = await this.emailService.createEmail({
      recipient: recipient,
      subject: subject,
      html,
      type,
    });

    await this.emailService.sendEmail(mail);
  }
}

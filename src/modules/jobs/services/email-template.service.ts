import { Injectable } from '@nestjs/common';
import { render } from '@react-email/render';
import {
  APP_URL,
  DELETE_GAMESERVER_AFTER_DAYS,
} from '../constants/worker.constants';

// Email template components will be created as React components
import ExpiresInXDaysTemplate from '../templates/ExpiresInXDays';
import DeleteInXDaysTemplate from '../templates/DeleteInXDays';
import ServerExpiredTemplate from '../templates/ServerExpired';

@Injectable()
export class EmailTemplateService {
  /**
   * Render expiry reminder email
   */
  async renderExpiryEmail(params: {
    username: string;
    serverName: string;
    expirationDate: Date;
    deleteDate: Date;
    expirationDays: 7 | 1;
    serverId: string;
    isFreeServer: boolean;
  }): Promise<string> {
    const html = await render(
      ExpiresInXDaysTemplate({
        username: params.username,
        serverName: params.serverName,
        expirationDate: params.expirationDate,
        deleteDate: params.deleteDate,
        expirationDays: params.expirationDays,
        serverId: params.serverId,
        isFreeServer: params.isFreeServer,
      }),
    );
    return html;
  }

  /**
   * Render deletion reminder email
   */
  async renderDeletionEmail(params: {
    username: string;
    serverName: string;
    expirationDate: Date;
    deletionDate: Date;
    deletionDays: 7 | 1;
    serverId: string;
  }): Promise<string> {
    const html = await render(
      DeleteInXDaysTemplate({
        username: params.username,
        serverName: params.serverName,
        expirationDate: params.expirationDate,
        deletionDate: params.deletionDate,
        deletionDays: params.deletionDays,
        serverId: params.serverId,
      }),
    );
    return html;
  }

  /**
   * Render server expired email
   */
  async renderServerExpiredEmail(params: {
    username: string;
    serverName: string;
    expiredAt: Date;
    deleteDate: Date;
    serverId: string;
    isFreeServer: boolean;
  }): Promise<string> {
    const html = await render(
      ServerExpiredTemplate({
        username: params.username,
        serverName: params.serverName,
        expiredAt: params.expiredAt,
        deleteDate: params.deleteDate,
        serverId: params.serverId,
        isFreeServer: params.isFreeServer,
      }),
    );
    return html;
  }
}

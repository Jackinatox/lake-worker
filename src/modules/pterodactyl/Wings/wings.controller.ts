import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ServerWingsDTO } from './ServerWingsDTO';
import { WingsService } from './wings.service';

@Controller('servers')
export class WingsController {
  constructor(private readonly wingsService: WingsService) {}

  /**
   * Read-only lookup for lake's admin gameserver list. A POST only because the
   * id list can be long; nothing is changed.
   */
  @Post('wings')
  @HttpCode(200)
  async serverWings(@Body() body: ServerWingsDTO) {
    return { wings: await this.wingsService.wingsForServers(body.ptAdminIds) };
  }
}

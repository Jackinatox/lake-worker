import { NewServerOptions } from '@avionrx/pterodactyl-js';
import {
  calcBackups,
  calcDiskSize,
} from 'src/lib/pterodactyl/provision/ptResourceLogic';

export interface ServerLimits {
  cpu: number;
  disk: number;
  memory: number;
  io: number;
  swap: number;
}

export interface FeatureLimits {
  allocations: number;
  backups: number;
  databases: number;
  split_limit: number;
}

export interface DeployConfig {
  dedicatedIp: boolean;
  locations: number[];
  portRange: string[];
}

export interface EnvironmentConfig {
  environment: Record<string, string>;
  startup: string;
}

export class ServerOptionsBuilder {
  private name: string = '';
  private user: number = 0;
  private egg: number = 0;
  private image: string = '';
  private limits: ServerLimits = {
    cpu: 0,
    disk: 0,
    memory: 0,
    io: 500,
    swap: 512,
  };
  private featureLimits: FeatureLimits = {
    allocations: 2,
    backups: 0,
    databases: 0,
    split_limit: 0,
  };
  private deploy: DeployConfig = {
    dedicatedIp: false,
    locations: [],
    portRange: [],
  };
  private environmentConfig: EnvironmentConfig = {
    environment: {},
    startup: '',
  };
  private startWhenInstalled: boolean = false;
  private outOfMemoryKiller: boolean = false;

  setName(name: string): this {
    this.name = name;
    return this;
  }

  setUser(ptUserId: number): this {
    this.user = ptUserId;
    return this;
  }

  setEgg(eggId: number): this {
    this.egg = eggId;
    return this;
  }

  setDockerImage(image: string): this {
    this.image = image;
    return this;
  }

  setResources(cpuPercent: number, ramMB: number): this {
    this.limits = {
      cpu: cpuPercent,
      disk: calcDiskSize(cpuPercent, ramMB),
      memory: ramMB,
      io: 500,
      swap: 512,
    };
    this.featureLimits.backups = calcBackups(cpuPercent, ramMB);
    return this;
  }

  setLocation(ptLocationId: number): this {
    this.deploy.locations = [ptLocationId];
    return this;
  }

  setEnvironment(config: EnvironmentConfig): this {
    this.environmentConfig = config;
    return this;
  }

  setStartWhenInstalled(value: boolean): this {
    this.startWhenInstalled = value;
    return this;
  }

  build(): NewServerOptions {
    this.validate();

    return {
      name: this.name,
      user: this.user,
      egg: this.egg,
      image: this.image,
      limits: this.limits,
      featureLimits: this.featureLimits,
      deploy: this.deploy,
      startWhenInstalled: this.startWhenInstalled,
      outOfMemoryKiller: this.outOfMemoryKiller,
      ...this.environmentConfig,
    } as NewServerOptions;
  }

  private validate(): void {
    if (!this.name) throw new Error('Server name is required');
    if (!this.user) throw new Error('User ID is required');
    if (!this.egg) throw new Error('Egg ID is required');
    if (!this.image) throw new Error('Docker image is required');
    if (this.deploy.locations.length === 0)
      throw new Error('At least one location is required');
    if (!this.environmentConfig.startup)
      throw new Error('Startup command is required');
  }
}
